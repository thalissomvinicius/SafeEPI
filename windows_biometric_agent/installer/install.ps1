param(
  [string]$Executable = (Join-Path (Split-Path -Parent $PSScriptRoot) "dist\SafeEPI-Leitor.exe")
)

$ErrorActionPreference = "Stop"
$InstallDirectory = Join-Path $env:ProgramFiles "SafeEPI\Leitor"
$TargetExecutable = Join-Path $InstallDirectory "SafeEPI-Leitor.exe"
$PoolScript = Join-Path $PSScriptRoot "setup-private-pool.ps1"

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Execute install.ps1 como Administrador."
}
if (-not (Test-Path -LiteralPath $Executable)) {
  throw "Executavel nao encontrado em: $Executable"
}
if (-not (Test-Path -LiteralPath $PoolScript)) {
  throw "Script de configuracao biometrica nao encontrado."
}

New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
Copy-Item -LiteralPath $Executable -Destination $TargetExecutable -Force
Copy-Item -LiteralPath $PoolScript -Destination (Join-Path $InstallDirectory "setup-private-pool.ps1") -Force

& $PoolScript -Install

$HealthCheck = Start-Process -FilePath $TargetExecutable -ArgumentList "--health-check" -Wait -PassThru
if ($HealthCheck.ExitCode -ne 0) {
  throw "O leitor foi detectado, mas o driver nao permite uma sessao biometrica privada do SafeEPI. Este modelo funciona somente com Windows Hello ou exige um SDK do fabricante."
}

$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
New-ItemProperty -LiteralPath $RunKey -Name "SafeEPI Leitor" -PropertyType String -Value ('"' + $TargetExecutable + '"') -Force | Out-Null

$Shell = New-Object -ComObject WScript.Shell
$ShortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "SafeEPI Leitor.lnk"
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetExecutable
$Shortcut.WorkingDirectory = $InstallDirectory
$Shortcut.Description = "Terminal de confirmacao por impressao digital SafeEPI"
$Shortcut.Save()

Start-Process -FilePath $TargetExecutable
Write-Host "SafeEPI Leitor instalado em $InstallDirectory"
