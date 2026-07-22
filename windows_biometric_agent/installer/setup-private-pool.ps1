param(
  [Parameter(Mandatory = $true, ParameterSetName = "Install")][switch]$Install,
  [Parameter(Mandatory = $true, ParameterSetName = "Uninstall")][switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$DatabaseId = "E5975B98-141F-4D9C-BB5A-D1F62A1DFA44"
$DatabaseRegistryRoot = "Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\WbioSrvc\Databases"

function Assert-Administrator {
  $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
  if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute este instalador como Administrador."
  }
}

function Get-SafeEpiBiometricDevice {
  $Devices = @(Get-PnpDevice -Class Biometric -PresentOnly | Where-Object Status -eq "OK")
  if ($Devices.Count -eq 0) {
    throw "Nenhum leitor biometrico ativo foi encontrado pelo Windows."
  }
  $Preferred = $Devices | Where-Object { $_.FriendlyName -match "ChipSailing|Fingerprint" } | Select-Object -First 1
  if ($Preferred) { return $Preferred }
  return $Devices[0]
}

function Get-ConfigurationRoot([string]$InstanceId) {
  return "Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Enum\$InstanceId\Device Parameters\WinBio\Configurations"
}

function Restart-BiometricService {
  Restart-Service -Name "WbioSrvc" -Force
  Start-Sleep -Seconds 2
}

Assert-Administrator
$Device = Get-SafeEpiBiometricDevice
$ConfigurationRoot = Get-ConfigurationRoot $Device.InstanceId
if (-not (Test-Path -LiteralPath $ConfigurationRoot)) {
  throw "O driver do leitor nao expoe configuracao compativel com o Windows Biometric Framework."
}

if ($Install) {
  $SystemConfiguration = Get-ChildItem -LiteralPath $ConfigurationRoot |
    Where-Object { (Get-ItemProperty -LiteralPath $_.PSPath).SystemSensor -eq 1 } |
    Select-Object -First 1
  if (-not $SystemConfiguration) {
    throw "Configuracao original do Windows Hello nao encontrada."
  }
  $SystemValues = Get-ItemProperty -LiteralPath $SystemConfiguration.PSPath
  $SystemDatabasePath = Join-Path $DatabaseRegistryRoot ("{" + $SystemValues.DatabaseId + "}")
  if (-not (Test-Path -LiteralPath $SystemDatabasePath)) {
    throw "Banco biometrico original do Windows nao encontrado."
  }
  $SystemDatabase = Get-ItemProperty -LiteralPath $SystemDatabasePath

  $PrivateDatabasePath = Join-Path $DatabaseRegistryRoot ("{" + $DatabaseId + "}")
  if (-not (Test-Path -LiteralPath $PrivateDatabasePath)) {
    New-Item -Path $PrivateDatabasePath -Force | Out-Null
    New-ItemProperty -LiteralPath $PrivateDatabasePath -Name "Attributes" -PropertyType DWord -Value ([int]$SystemDatabase.Attributes) -Force | Out-Null
    New-ItemProperty -LiteralPath $PrivateDatabasePath -Name "AutoCreate" -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -LiteralPath $PrivateDatabasePath -Name "AutoName" -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -LiteralPath $PrivateDatabasePath -Name "BiometricType" -PropertyType DWord -Value 8 -Force | Out-Null
    New-ItemProperty -LiteralPath $PrivateDatabasePath -Name "ConnectionString" -PropertyType String -Value "" -Force | Out-Null
    New-ItemProperty -LiteralPath $PrivateDatabasePath -Name "FilePath" -PropertyType String -Value "" -Force | Out-Null
    New-ItemProperty -LiteralPath $PrivateDatabasePath -Name "Format" -PropertyType String -Value ([string]$SystemDatabase.Format) -Force | Out-Null
    New-ItemProperty -LiteralPath $PrivateDatabasePath -Name "InitialSize" -PropertyType DWord -Value 32 -Force | Out-Null
  }

  $ExistingPrivate = Get-ChildItem -LiteralPath $ConfigurationRoot | Where-Object {
    (Get-ItemProperty -LiteralPath $_.PSPath).DatabaseId -eq $DatabaseId
  } | Select-Object -First 1
  if (-not $ExistingPrivate) {
    $NumericKeys = @(Get-ChildItem -LiteralPath $ConfigurationRoot | Where-Object PSChildName -match '^\d+$' | ForEach-Object { [int]$_.PSChildName })
    $NextKey = if ($NumericKeys.Count -eq 0) { 0 } else { ($NumericKeys | Measure-Object -Maximum).Maximum + 1 }
    $PrivateConfigurationPath = Join-Path $ConfigurationRoot ([string]$NextKey)
    New-Item -Path $PrivateConfigurationPath -Force | Out-Null
    New-ItemProperty -LiteralPath $PrivateConfigurationPath -Name "SensorMode" -PropertyType DWord -Value ([int]$SystemValues.SensorMode) -Force | Out-Null
    New-ItemProperty -LiteralPath $PrivateConfigurationPath -Name "SystemSensor" -PropertyType DWord -Value 0 -Force | Out-Null
    New-ItemProperty -LiteralPath $PrivateConfigurationPath -Name "SensorAdapterBinary" -PropertyType String -Value ([string]$SystemValues.SensorAdapterBinary) -Force | Out-Null
    New-ItemProperty -LiteralPath $PrivateConfigurationPath -Name "EngineAdapterBinary" -PropertyType String -Value ([string]$SystemValues.EngineAdapterBinary) -Force | Out-Null
    New-ItemProperty -LiteralPath $PrivateConfigurationPath -Name "StorageAdapterBinary" -PropertyType String -Value ([string]$SystemValues.StorageAdapterBinary) -Force | Out-Null
    New-ItemProperty -LiteralPath $PrivateConfigurationPath -Name "DatabaseId" -PropertyType String -Value $DatabaseId -Force | Out-Null
  }

  Restart-BiometricService
  Write-Host "Pool biometrico privado do SafeEPI configurado para: $($Device.FriendlyName)"
}

if ($Uninstall) {
  $PrivateConfigurations = @(Get-ChildItem -LiteralPath $ConfigurationRoot | Where-Object {
    (Get-ItemProperty -LiteralPath $_.PSPath).DatabaseId -eq $DatabaseId
  })
  foreach ($Configuration in $PrivateConfigurations) {
    Remove-Item -LiteralPath $Configuration.PSPath -Recurse -Force
  }

  $PrivateDatabasePath = Join-Path $DatabaseRegistryRoot ("{" + $DatabaseId + "}")
  if (Test-Path -LiteralPath $PrivateDatabasePath) {
    $Database = Get-ItemProperty -LiteralPath $PrivateDatabasePath
    $DatabaseFile = [string]$Database.FilePath
    Remove-Item -LiteralPath $PrivateDatabasePath -Recurse -Force
    if ($DatabaseFile) {
      $ResolvedDatabaseDirectory = [IO.Path]::GetFullPath((Join-Path $env:WINDIR "System32\WinBioDatabase"))
      $ResolvedDatabaseFile = [IO.Path]::GetFullPath($DatabaseFile)
      if ($ResolvedDatabaseFile.StartsWith($ResolvedDatabaseDirectory, [StringComparison]::OrdinalIgnoreCase) -and
          [IO.Path]::GetFileNameWithoutExtension($ResolvedDatabaseFile).Equals($DatabaseId, [StringComparison]::OrdinalIgnoreCase) -and
          (Test-Path -LiteralPath $ResolvedDatabaseFile)) {
        Remove-Item -LiteralPath $ResolvedDatabaseFile -Force
      }
    }
  }
  Restart-BiometricService
  Write-Host "Pool privado SafeEPI removido. O leitor continua disponivel para o Windows Hello."
}
