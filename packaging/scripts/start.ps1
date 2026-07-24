$ErrorActionPreference = "Stop"

$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$nodePath = Join-Path $packageRoot "runtime\node.exe"
$serverPath = Join-Path $packageRoot "server.js"
$pidFile = Join-Path $packageRoot "server.pid"
$baseUrl = "http://127.0.0.1:4173/"
$demoUrl = "http://127.0.0.1:4173/?demo=1"

if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
  throw "Portable Node.js runtime is missing."
}
if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
  throw "server.js is missing."
}

function Get-DemoServerState {
  try {
    $response = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 1
    if ($response.StatusCode -eq 200 -and $response.Content.Contains("GOLD INTELLIGENCE")) {
      return "ready"
    }
    return "occupied"
  } catch {
    return "offline"
  }
}

$state = Get-DemoServerState
if ($state -eq "occupied") {
  throw "Port 4173 is already used by another application. Close it and try again."
}

if ($state -eq "offline") {
  $serverProcess = Start-Process `
    -FilePath $nodePath `
    -ArgumentList @("`"$serverPath`"") `
    -WorkingDirectory $packageRoot `
    -WindowStyle Hidden `
    -PassThru
  [System.IO.File]::WriteAllText($pidFile, [string]$serverProcess.Id, [System.Text.Encoding]::ASCII)

  $state = "offline"
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    $serverProcess.Refresh()
    if ($serverProcess.HasExited) {
      break
    }
    $state = Get-DemoServerState
    if ($state -eq "ready") {
      break
    }
  }

  if ($state -ne "ready") {
    if (-not $serverProcess.HasExited) {
      Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    throw "The local demo server did not start successfully."
  }
}

Start-Process $demoUrl
