$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$nodePath = Join-Path $packageRoot "runtime\node.exe"
$chainScript = Join-Path $packageRoot "scripts\web3-local-chain.js"
$deployScript = Join-Path $packageRoot "scripts\web3-deploy-registry.js"
$serviceManager = Join-Path $packageRoot "service-manager.js"
$evmPidPath = Join-Path $packageRoot ".gold-demo-evm.pid"
$evmStdoutPath = Join-Path $packageRoot ".gold-demo-evm.stdout.log"
$evmStderrPath = Join-Path $packageRoot ".gold-demo-evm.stderr.log"
$expectedChainIdHex = "0x7a69"
$evmRpcUrl = "http://127.0.0.1:8545"
$portableEnvironment = [ordered]@{
  LOCAL_EVM_PORT = "8545"
  LOCAL_EVM_CHAIN_ID = "31337"
  LOCAL_EVM_RPC_URL = $evmRpcUrl
  GOLD_WEB3_STATE_PATH = (Join-Path $packageRoot "data\web3-backend-state.json")
  GOLD_WEB3_RUNTIME_PATH = (Join-Path $packageRoot "data\web3-local-runtime.json")
  GOLD_WEB3_ARTIFACT_PATH = (Join-Path $packageRoot "contracts\artifacts\DesignRegistry.json")
  PORT = "4173"
}

foreach ($requiredFile in @($nodePath, $chainScript, $deployScript, $serviceManager)) {
  if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
    throw "Portable package is incomplete: $requiredFile"
  }
}

function Read-ProcessIdFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $null
  }
  $value = (Get-Content -LiteralPath $Path -Raw -Encoding ASCII).Trim()
  $processId = 0
  if (-not [int]::TryParse($value, [ref]$processId) -or $processId -le 0) {
    throw "The local EVM PID file is invalid."
  }
  return $processId
}

function Test-LocalEvm {
  try {
    $body = '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
    $response = Invoke-RestMethod `
      -Uri $evmRpcUrl `
      -Method Post `
      -ContentType "application/json" `
      -Body $body `
      -TimeoutSec 1
    return ([string]$response.result).ToLowerInvariant() -eq $expectedChainIdHex
  } catch {
    return $false
  }
}

function Assert-OwnedEvmProcess {
  param([int]$ProcessId)
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    return $false
  }
  $actualNodePath = [System.IO.Path]::GetFullPath($process.Path)
  $expectedNodePath = [System.IO.Path]::GetFullPath($nodePath)
  if (-not $actualNodePath.Equals($expectedNodePath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use a local EVM process that is not owned by this package."
  }
  $details = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
  if ($null -eq $details -or -not ([string]$details.CommandLine).Contains($chainScript)) {
    throw "Refusing to use a process that is not the package local-EVM command."
  }
  return $true
}

function Get-GuardedEnvironmentSnapshot {
  $snapshot = [ordered]@{}
  $current = [Environment]::GetEnvironmentVariables("Process")
  foreach ($name in @($current.Keys)) {
    $normalized = [string]$name
    if (
      ($normalized -eq "PORT") -or
      $normalized.StartsWith("LOCAL_EVM_", [StringComparison]::OrdinalIgnoreCase) -or
      $normalized.StartsWith("GOLD_WEB3_", [StringComparison]::OrdinalIgnoreCase)
    ) {
      $snapshot[$normalized] = [string]$current[$name]
    }
  }
  return $snapshot
}

function Clear-GuardedEnvironment {
  $current = [Environment]::GetEnvironmentVariables("Process")
  foreach ($name in @($current.Keys)) {
    $normalized = [string]$name
    if (
      ($normalized -eq "PORT") -or
      $normalized.StartsWith("LOCAL_EVM_", [StringComparison]::OrdinalIgnoreCase) -or
      $normalized.StartsWith("GOLD_WEB3_", [StringComparison]::OrdinalIgnoreCase)
    ) {
      [Environment]::SetEnvironmentVariable($normalized, $null, "Process")
    }
  }
}

function Set-PortableEnvironment {
  Clear-GuardedEnvironment
  foreach ($entry in $portableEnvironment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "Process")
  }
}

function Restore-GuardedEnvironment {
  param([System.Collections.IDictionary]$Snapshot)
  Clear-GuardedEnvironment
  foreach ($entry in $Snapshot.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "Process")
  }
}

$guardedEnvironmentSnapshot = Get-GuardedEnvironmentSnapshot
Set-PortableEnvironment

try {
  $startedEvmThisRun = $false
  $savedEvmProcessId = Read-ProcessIdFile -Path $evmPidPath

  if (Test-LocalEvm) {
    if ($null -eq $savedEvmProcessId -or -not (Assert-OwnedEvmProcess -ProcessId $savedEvmProcessId)) {
      throw "Port 8545 is already occupied by a local EVM that does not belong to this package."
    }
  } else {
    if ($null -ne $savedEvmProcessId) {
      if (Assert-OwnedEvmProcess -ProcessId $savedEvmProcessId) {
        throw "The recorded package EVM process is running but its RPC is not healthy."
      }
      Remove-Item -LiteralPath $evmPidPath -Force
    }

    $chainProcess = Start-Process `
      -FilePath $nodePath `
      -ArgumentList @("`"$chainScript`"") `
      -WorkingDirectory $packageRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $evmStdoutPath `
      -RedirectStandardError $evmStderrPath `
      -PassThru
    [System.IO.File]::WriteAllText(
      $evmPidPath,
      [string]$chainProcess.Id,
      [System.Text.Encoding]::ASCII
    )
    $savedEvmProcessId = $chainProcess.Id
    $startedEvmThisRun = $true

    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
      Start-Sleep -Milliseconds 250
      $chainProcess.Refresh()
      if ($chainProcess.HasExited) {
        break
      }
      if (Test-LocalEvm) {
        break
      }
    }
    if (-not (Test-LocalEvm)) {
      if (-not $chainProcess.HasExited) {
        Stop-Process -Id $chainProcess.Id -Force -ErrorAction SilentlyContinue
      }
      Remove-Item -LiteralPath $evmPidPath -Force -ErrorAction SilentlyContinue
      throw "The package local EVM did not become ready. See .gold-demo-evm.stderr.log."
    }

    & $nodePath $deployScript
    if ($LASTEXITCODE -ne 0) {
      Stop-Process -Id $chainProcess.Id -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $evmPidPath -Force -ErrorAction SilentlyContinue
      throw "DesignRegistry deployment failed."
    }
  }

  try {
    & $nodePath $serviceManager start
    if ($LASTEXITCODE -ne 0) {
      throw "The local application server did not start."
    }
    Write-Host ""
    Write-Host "V0.6.0 is ready: http://127.0.0.1:4173/?demo=1"
    Write-Host "Local Registry: loopback-only development EVM."
    Write-Host "Monad Testnet: read-only network access only when its page is opened."
  } catch {
    if ($startedEvmThisRun -and $null -ne $savedEvmProcessId) {
      Stop-Process -Id $savedEvmProcessId -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $evmPidPath -Force -ErrorAction SilentlyContinue
    }
    throw
  }
} finally {
  Restore-GuardedEnvironment -Snapshot $guardedEnvironmentSnapshot
}
