$ErrorActionPreference = "Stop"

$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$nodePath = [System.IO.Path]::GetFullPath((Join-Path $packageRoot "runtime\node.exe"))
$pidFile = Join-Path $packageRoot "server.pid"

if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
  Write-Host "No package-owned demo server is running."
  exit 0
}

$serverProcessIdText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
$serverProcessId = 0
if (-not [int]::TryParse($serverProcessIdText, [ref]$serverProcessId)) {
  throw "The server PID file is invalid."
}

$serverProcess = Get-Process -Id $serverProcessId -ErrorAction SilentlyContinue
if ($null -eq $serverProcess) {
  Remove-Item -LiteralPath $pidFile -Force
  Write-Host "The demo server had already stopped."
  exit 0
}

$actualPath = [System.IO.Path]::GetFullPath($serverProcess.Path)
if (-not $actualPath.Equals($nodePath, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to stop a process that does not belong to this package."
}

Stop-Process -Id $serverProcessId -Force
Remove-Item -LiteralPath $pidFile -Force
Write-Host "The demo server has stopped."
