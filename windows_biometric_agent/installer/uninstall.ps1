$ErrorActionPreference = "Stop"
$InstallDirectory = Join-Path $env:ProgramFiles "SafeEPI\Leitor"
$PoolScript = Join-Path $InstallDirectory "setup-private-pool.ps1"

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Execute uninstall.ps1 como Administrador."
}

Get-Process -Name "SafeEPI-Leitor" -ErrorAction SilentlyContinue | Stop-Process -Force
if (Test-Path -LiteralPath $PoolScript) {
  & $PoolScript -Uninstall
}
Remove-ItemProperty -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SafeEPI Leitor" -ErrorAction SilentlyContinue
$ShortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "SafeEPI Leitor.lnk"
if (Test-Path -LiteralPath $ShortcutPath) {
  Remove-Item -LiteralPath $ShortcutPath -Force
}

$ResolvedInstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$ExpectedRoot = [IO.Path]::GetFullPath((Join-Path $env:ProgramFiles "SafeEPI"))
if ($ResolvedInstallDirectory.StartsWith($ExpectedRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $ResolvedInstallDirectory)) {
  Remove-Item -LiteralPath $ResolvedInstallDirectory -Recurse -Force
}
$DataDirectory = Join-Path $env:LOCALAPPDATA "SafeEPI\FingerprintAgent"
$ResolvedDataDirectory = [IO.Path]::GetFullPath($DataDirectory)
$ExpectedDataRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "SafeEPI"))
if ($ResolvedDataDirectory.StartsWith($ExpectedDataRoot, [StringComparison]::OrdinalIgnoreCase) -and
    [IO.Path]::GetFileName($ResolvedDataDirectory).Equals("FingerprintAgent", [StringComparison]::OrdinalIgnoreCase) -and
    (Test-Path -LiteralPath $ResolvedDataDirectory)) {
  Remove-Item -LiteralPath $ResolvedDataDirectory -Recurse -Force
}
Write-Host "SafeEPI Leitor removido."
