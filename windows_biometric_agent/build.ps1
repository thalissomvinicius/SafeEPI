param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPath = Join-Path $AgentRoot ".venv-build"
$VenvPython = Join-Path $VenvPath "Scripts\python.exe"

if (-not (Test-Path -LiteralPath $VenvPython)) {
  & $Python -m venv $VenvPath
}

& $VenvPython -m pip install --disable-pip-version-check --requirement (Join-Path $AgentRoot "requirements-dev.txt")
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar as dependencias de build." }
& $VenvPython -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --windowed `
  --name "SafeEPI-Leitor" `
  --distpath (Join-Path $AgentRoot "dist") `
  --workpath (Join-Path $AgentRoot "build") `
  --specpath (Join-Path $AgentRoot "build") `
  --paths $AgentRoot `
  (Join-Path $AgentRoot "run_agent.py")
if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o executavel SafeEPI Leitor." }

$ReleaseRoot = Join-Path $AgentRoot "release"
$ReleaseDist = Join-Path $ReleaseRoot "dist"
$ReleaseInstaller = Join-Path $ReleaseRoot "installer"
New-Item -ItemType Directory -Path $ReleaseDist -Force | Out-Null
New-Item -ItemType Directory -Path $ReleaseInstaller -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $AgentRoot "dist\SafeEPI-Leitor.exe") -Destination (Join-Path $ReleaseDist "SafeEPI-Leitor.exe") -Force
Copy-Item -LiteralPath (Join-Path $AgentRoot "installer\install.ps1") -Destination (Join-Path $ReleaseInstaller "install.ps1") -Force
Copy-Item -LiteralPath (Join-Path $AgentRoot "installer\uninstall.ps1") -Destination (Join-Path $ReleaseInstaller "uninstall.ps1") -Force
Copy-Item -LiteralPath (Join-Path $AgentRoot "installer\setup-private-pool.ps1") -Destination (Join-Path $ReleaseInstaller "setup-private-pool.ps1") -Force
Copy-Item -LiteralPath (Join-Path $AgentRoot "README.md") -Destination (Join-Path $ReleaseRoot "LEIA-ME.md") -Force

$ReleaseZip = Join-Path $AgentRoot "SafeEPI-Leitor-Windows.zip"
Compress-Archive -Path (Join-Path $ReleaseRoot "*") -DestinationPath $ReleaseZip -CompressionLevel Optimal -Force

Write-Host "Executavel gerado em: $AgentRoot\dist\SafeEPI-Leitor.exe"
Write-Host "Pacote de instalacao gerado em: $ReleaseZip"
