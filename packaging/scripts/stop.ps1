$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$nodePath = Join-Path $packageRoot "runtime\node.exe"
$chainScript = Join-Path $packageRoot "scripts\web3-local-chain.js"
$serviceManager = Join-Path $packageRoot "service-manager.js"
$evmPidPath = Join-Path $packageRoot ".gold-demo-evm.pid"

foreach ($requiredFile in @($nodePath, $chainScript, $serviceManager)) {
  if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
    throw "Portable package is incomplete: $requiredFile"
  }
}

& $nodePath $serviceManager stop
if ($LASTEXITCODE -ne 0) {
  throw "The application server could not be stopped safely."
}

if (-not (Test-Path -LiteralPath $evmPidPath -PathType Leaf)) {
  Write-Host "No package-owned local EVM is running."
  exit 0
}

$value = (Get-Content -LiteralPath $evmPidPath -Raw -Encoding ASCII).Trim()
$evmProcessId = 0
if (-not [int]::TryParse($value, [ref]$evmProcessId) -or $evmProcessId -le 0) {
  throw "The local EVM PID file is invalid."
}

$process = Get-Process -Id $evmProcessId -ErrorAction SilentlyContinue
if ($null -eq $process) {
  Remove-Item -LiteralPath $evmPidPath -Force
  Write-Host "The package local EVM had already stopped."
  exit 0
}

$actualNodePath = [System.IO.Path]::GetFullPath($process.Path)
$expectedNodePath = [System.IO.Path]::GetFullPath($nodePath)
if (-not $actualNodePath.Equals($expectedNodePath, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to stop a process that does not use this package's Node.js runtime."
}

$details = Get-CimInstance Win32_Process -Filter "ProcessId = $evmProcessId" -ErrorAction Stop
if ($null -eq $details -or -not ([string]$details.CommandLine).Contains($chainScript)) {
  throw "Refusing to stop a process that is not the package local-EVM command."
}

Stop-Process -Id $evmProcessId -Force
Remove-Item -LiteralPath $evmPidPath -Force
Write-Host "The V0.6.0 application server and local EVM have stopped."
