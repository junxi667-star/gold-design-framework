[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RuntimeDir,

  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$productVersion = "0.6.0"
$packageName = "gold-ai-demo-win-x64-v$productVersion"
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $sourceRoot "dist"
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$packagePath = Join-Path $OutputRoot $packageName
$zipPath = Join-Path $OutputRoot "$packageName.zip"
$zipSidecarPath = "$zipPath.sha256.txt"

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,

    [Parameter(Mandatory = $true)]
    [scriptblock]$Action
  )
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Content
  )
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Get-TextSha256 {
  param([Parameter(Mandatory = $true)][string]$Text)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Copy-ProjectFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$MaterializedSourceRoot,

    [Parameter(Mandatory = $true)]
    [string]$RelativeSource,

    [Parameter(Mandatory = $true)]
    [string]$RelativeDestination,

    [Parameter(Mandatory = $true)]
    [string]$DestinationRoot
  )
  $sourcePath = Join-Path $MaterializedSourceRoot ($RelativeSource.Replace("/", "\"))
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Whitelisted Git-tree source file is missing: $RelativeSource"
  }
  $destinationPath = Join-Path $DestinationRoot ($RelativeDestination.Replace("/", "\"))
  $destinationParent = Split-Path -Parent $destinationPath
  if (-not (Test-Path -LiteralPath $destinationParent)) {
    New-Item -ItemType Directory -Path $destinationParent | Out-Null
  }
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath
}

function Assert-NoForbiddenProjectPath {
  param([Parameter(Mandatory = $true)][string]$RelativePath)
  $normalized = $RelativePath.Replace("\", "/")
  $forbidden = @(
    "(^|/)\.git(?:hub)?(?:/|$)",
    "(^|/)\.codex(?:[-_][^/]*)?(?:/|$)",
    "(^|/)交付(?:/|$)",
    "(^|/)(?:test|screenshots|captures|runtime|dist)(?:/|$)",
    "(^|/)(?:customer|client)[-_ ]?attachments?(?:/|$)",
    "(^|/)(?:secret|secrets|keystore)(?:/|$)",
    "(^|/)\.env$",
    "(^|/)[^/]*(?:state|evidence)[^/]*\.json$",
    "\.(?:docx|pptx|xlsx|xls|pdf)$",
    "\.(?:zip|7z|rar|tar|tgz|gz)$",
    "\.(?:pem|key|p12|pfx|cer|crt|keystore\.json|dpapi|log)$",
    "\.(?:exe|dll|node|msi|com|scr|cmd)$"
  )
  foreach ($pattern in $forbidden) {
    if ($normalized -match $pattern) {
      throw "Forbidden project path selected for packaging: $RelativePath"
    }
  }
}

function Assert-ProjectPayload {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PayloadRoot,

    [Parameter(Mandatory = $true)]
    [string[]]$ExpectedRelativeFiles
  )
  $actualFiles = @(
    Get-ChildItem -LiteralPath $PayloadRoot -File -Recurse -Force |
      ForEach-Object {
        $_.FullName.Substring($PayloadRoot.Length + 1).Replace("\", "/")
      } |
      Sort-Object -Unique
  )
  $expectedFiles = @($ExpectedRelativeFiles | Sort-Object -Unique)
  $differences = @(Compare-Object -ReferenceObject $expectedFiles -DifferenceObject $actualFiles)
  if ($differences.Count -gt 0) {
    $detail = ($differences | ForEach-Object { "$($_.SideIndicator) $($_.InputObject)" }) -join "; "
    throw "Project payload does not match the explicit whitelist: $detail"
  }

  $teamCollaborationKeywords = @(
    "团队架构"
    "岗位协作"
    "协作系统"
    "第一大脑"
    "第二大脑"
    "夜间做梦"
    "XIAOFANZI"
    "PROJECT_INITIALIZATION"
    "collaboration-os"
    "AGENTS.md"
    "创建者项目"
  )
  $textExtensions = @(
    ".bat"
    ".css"
    ".example"
    ".html"
    ".js"
    ".json"
    ".md"
    ".ps1"
    ".sol"
    ".svg"
    ".txt"
    ".yaml"
    ".yml"
  )

  foreach ($relativePath in $actualFiles) {
    Assert-NoForbiddenProjectPath -RelativePath $relativePath
    if ($relativePath -match "(^|/)node_modules(?:/|$)") {
      throw "Project payload scan must run before third-party node_modules are installed."
    }
    $extension = [System.IO.Path]::GetExtension($relativePath).ToLowerInvariant()
    if ($textExtensions -notcontains $extension) {
      continue
    }
    $absolutePath = Join-Path $PayloadRoot ($relativePath.Replace("/", "\"))
    $content = Get-Content -LiteralPath $absolutePath -Raw -Encoding UTF8
    foreach ($keyword in $teamCollaborationKeywords) {
      if ($content.IndexOf($keyword, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw "Team-collaboration material is forbidden in the project payload: $relativePath ($keyword)"
      }
    }
    if ($content -match "-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----") {
      throw "Private-key material detected in project payload: $relativePath"
    }
    $containsAccessToken = (
      ($content -match "(?i)\bgh[pousr]_[A-Za-z0-9]{30,}\b") -or
      ($content -match "(?i)\bsk-[A-Za-z0-9_-]{20,}\b") -or
      ($content -match "\bAKIA[0-9A-Z]{16}\b")
    )
    if ($containsAccessToken) {
      throw "High-confidence access token detected in project payload: $relativePath"
    }
    $secretAssignments = [regex]::Matches(
      $content,
      '(?im)(?:^|[^A-Za-z0-9])["'']?(?:api[_-]?key|private[_-]?key|mnemonic|secret|password)["'']?\s*[:=]\s*["'']?([^"''\r\n]{8,})'
    )
    foreach ($assignment in $secretAssignments) {
      $value = $assignment.Groups[1].Value.Trim()
      if (
        $value -and
        ($value -notmatch "^(?:<.*>|example|sample|changeme|replace[_ -]?me|your[_ -].*|not[_ -]?set|null|undefined)$")
      ) {
        throw "High-confidence assigned secret detected in project payload: $relativePath"
      }
    }
  }
}

function Convert-BatToCrlf {
  param([Parameter(Mandatory = $true)][string]$Path)
  $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  $normalized = ($content -replace "`r`n?", "`n") -replace "`n", "`r`n"
  Write-Utf8NoBom -Path $Path -Content $normalized
}

function Assert-BatCrlf {
  param([Parameter(Mandatory = $true)][string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  for ($index = 0; $index -lt $bytes.Length; $index += 1) {
    if ($bytes[$index] -eq 10 -and ($index -eq 0 -or $bytes[$index - 1] -ne 13)) {
      throw "BAT file contains a naked LF instead of CRLF: $Path"
    }
  }
}

function Assert-ReparseTargetsContained {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RootPath,

    [Parameter(Mandatory = $true)]
    [string]$ContainmentRoot
  )
  $resolvedRoot = [System.IO.Path]::GetFullPath($RootPath)
  $resolvedContainmentRoot = [System.IO.Path]::GetFullPath($ContainmentRoot)
  $containmentPrefix = $resolvedContainmentRoot.TrimEnd("\") + "\"
  if (-not $resolvedRoot.StartsWith(
    $containmentPrefix,
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Reparse audit root escaped its containment boundary: $resolvedRoot"
  }
  $rootItem = Get-Item -LiteralPath $resolvedRoot -Force
  if ($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw "Refusing to remove a pnpm virtual-store root that is itself a reparse point."
  }
  $rootPrefix = $resolvedRoot.TrimEnd("\") + "\"
  $reparsePoints = @(
    Get-ChildItem -LiteralPath $resolvedRoot -Recurse -Force |
      Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint }
  )
  foreach ($reparsePoint in $reparsePoints) {
    $targets = @($reparsePoint.Target)
    if ($targets.Count -eq 0) {
      throw "Reparse point has no inspectable target: $($reparsePoint.FullName)"
    }
    foreach ($target in $targets) {
      if ([string]::IsNullOrWhiteSpace([string]$target)) {
        throw "Reparse point has an empty target: $($reparsePoint.FullName)"
      }
      $targetPath = if ([System.IO.Path]::IsPathRooted([string]$target)) {
        [string]$target
      } else {
        Join-Path $reparsePoint.Parent.FullName ([string]$target)
      }
      $resolvedTarget = [System.IO.Path]::GetFullPath($targetPath)
      if (
        -not $resolvedTarget.Equals(
          $resolvedRoot,
          [System.StringComparison]::OrdinalIgnoreCase
        ) -and
        -not $resolvedTarget.StartsWith(
          $rootPrefix,
          [System.StringComparison]::OrdinalIgnoreCase
        )
      ) {
        throw "Reparse target escaped the pnpm virtual store: $($reparsePoint.FullName) -> $resolvedTarget"
      }
    }
  }
}

function Invoke-BatSyntaxSmoke {
  param(
    [Parameter(Mandatory = $true)]
    [string]$CmdPath,

    [Parameter(Mandatory = $true)]
    [string]$BatPath,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedMarker
  )
  $output = @(& $CmdPath /d /s /c "call `"$BatPath`" --syntax-smoke" 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "cmd.exe BAT syntax smoke failed for $BatPath with exit code $LASTEXITCODE."
  }
  if (($output -join "`n") -notmatch [regex]::Escape($ExpectedMarker)) {
    throw "cmd.exe BAT syntax smoke did not emit $ExpectedMarker for $BatPath."
  }
}

foreach ($requiredCommand in @("git", "tar.exe", "cmd.exe")) {
  if (-not (Get-Command $requiredCommand -ErrorAction SilentlyContinue)) {
    throw "$requiredCommand is required to prepare the Windows package."
  }
}
$tarCommand = Get-Command tar.exe -ErrorAction Stop
$cmdCommand = Get-Command cmd.exe -ErrorAction Stop
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
if ($null -eq $pnpmCommand) {
  throw "pnpm is required to install locked dependencies."
}

$repositoryRoot = (& git -C $sourceRoot rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "Source root is not a Git worktree."
}
$repositoryRoot = [System.IO.Path]::GetFullPath($repositoryRoot)
if (-not $repositoryRoot.Equals($sourceRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Packaging must run from the repository root: $sourceRoot"
}

$startStatus = @(& git -C $sourceRoot status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect Git worktree status."
}
$cleanAtStart = $startStatus.Count -eq 0
if (-not $cleanAtStart) {
  throw "Refusing to package a dirty Git worktree. Commit or remove all source changes first."
}

$commitSha = (& git -C $sourceRoot rev-parse HEAD).Trim()
$treeSha = (& git -C $sourceRoot rev-parse "HEAD^{tree}").Trim()
$branchName = (& git -C $sourceRoot branch --show-current).Trim()
$commitAuthorTimestamp = (& git -C $sourceRoot show -s --format=%aI $commitSha).Trim()
$commitTimestamp = (& git -C $sourceRoot show -s --format=%cI $commitSha).Trim()
if (
  ($LASTEXITCODE -ne 0) -or
  (-not $commitSha) -or
  (-not $treeSha) -or
  (-not $commitAuthorTimestamp) -or
  (-not $commitTimestamp)
) {
  throw "Unable to resolve Git build identity."
}
$commitAuthorAtUtc = [DateTimeOffset]::Parse($commitAuthorTimestamp).UtcDateTime.ToString("o")
$commitCommittedAtUtc = [DateTimeOffset]::Parse($commitTimestamp).UtcDateTime.ToString("o")

$RuntimeDir = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $RuntimeDir).Path)
$nodePath = Join-Path $RuntimeDir "node.exe"
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
  throw "RuntimeDir must contain node.exe."
}
$runtimeLicenseFiles = @(
  Get-ChildItem -LiteralPath $RuntimeDir -File |
    Where-Object { $_.Name -match "^(?:NODE-)?LICENSE(?:\..+)?$" }
)
if ($runtimeLicenseFiles.Count -eq 0) {
  throw "RuntimeDir must contain a Node.js LICENSE or NODE-LICENSE file."
}

$runtimeIdentityText = (& $nodePath -p "JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})")
if ($LASTEXITCODE -ne 0) {
  throw "The supplied Node.js runtime could not be executed."
}
$runtimeIdentity = $runtimeIdentityText | ConvertFrom-Json
$runtimeMajor = [int](([string]$runtimeIdentity.version).TrimStart("v").Split(".")[0])
if ($runtimeIdentity.platform -ne "win32" -or $runtimeIdentity.arch -ne "x64" -or $runtimeMajor -lt 20) {
  throw "Runtime must be Windows x64 Node.js 20 or newer; received $runtimeIdentityText."
}

foreach ($existingOutput in @($packagePath, $zipPath, $zipSidecarPath)) {
  if (Test-Path -LiteralPath $existingOutput) {
    throw "Refusing to overwrite existing release output: $existingOutput"
  }
}
if (-not (Test-Path -LiteralPath $OutputRoot)) {
  New-Item -ItemType Directory -Path $OutputRoot | Out-Null
}

$trackedFiles = @(& git -C $sourceRoot -c core.quotepath=false ls-tree -r --name-only $commitSha)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to enumerate files from the bound Git tree."
}

$directFiles = @(
  ".env.example",
  "LICENSE",
  "PRIVATE_DISTRIBUTION.md",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "server.js",
  "service-manager.js"
)
$runtimeScriptFiles = @(
  "scripts/check-comfyui.js",
  "scripts/web3-deploy-registry.js",
  "scripts/web3-local-chain.js"
)
$buildOnlySourceFiles = @(
  "scripts/generate-production-license-manifest.js",
  "scripts/web3-build.js",
  "scripts/web3-contract.js"
)
$manualNoticeFiles = @(
  "third_party/manual-licenses/async-eventemitter@0.2.4.txt"
)
$templateMappings = [ordered]@{
  "packaging/START_DEMO.bat" = "START_DEMO.bat"
  "packaging/STOP_DEMO.bat" = "STOP_DEMO.bat"
  "packaging/启动演示.bat" = "启动演示.bat"
  "packaging/关闭演示.bat" = "关闭演示.bat"
  "packaging/使用说明.txt" = "使用说明.txt"
  "packaging/scripts/start.ps1" = "scripts/start.ps1"
  "packaging/scripts/stop.ps1" = "scripts/stop.ps1"
}

$selectedFiles = @(
  $trackedFiles | Where-Object {
    $relative = $_.Replace("\", "/")
    $directFiles -contains $relative -or
    $runtimeScriptFiles -contains $relative -or
    $manualNoticeFiles -contains $relative -or
    $relative -match "^backend/[^/]+\.js$" -or
    $relative -match "^contracts/(?:DesignRegistry\.sol|README\.md)$" -or
    $relative -eq "contracts/deployments/monad-testnet-10143.json" -or
    $relative -match "^data/training/[^/]+\.(?:json|md)$" -or
    $relative -match "^public/" -or
    $relative -match "^workflows/[^/]+\.json$"
  }
)
$requiredTrackedSources = @(
  $directFiles
  $runtimeScriptFiles
  $buildOnlySourceFiles
  $manualNoticeFiles
  @($templateMappings.Keys)
)
foreach ($requiredSource in $requiredTrackedSources) {
  if ($trackedFiles -notcontains $requiredSource) {
    throw "Required Git-tree source is missing: $requiredSource"
  }
}
foreach ($relativePath in $selectedFiles) {
  Assert-NoForbiddenProjectPath -RelativePath $relativePath
}
foreach ($relativePath in $templateMappings.Keys) {
  Assert-NoForbiddenProjectPath -RelativePath $relativePath
}

$expectedPayloadDestinations = @(
  $selectedFiles
  @($templateMappings.Values)
)
$stagingRoot = Join-Path $OutputRoot ".$packageName.build-$([guid]::NewGuid().ToString('N'))"
$stagedPackagePath = Join-Path $stagingRoot $packageName
$stagedZipPath = Join-Path $stagingRoot "$packageName.zip"
$stagedArtifactPath = Join-Path $stagingRoot "DesignRegistry.json"
$gitArchivePath = Join-Path $stagingRoot "source-$commitSha.tar"
$gitMaterializedRoot = Join-Path $stagingRoot "git-tree"

try {
  New-Item -ItemType Directory -Path $stagedPackagePath | Out-Null
  New-Item -ItemType Directory -Path $gitMaterializedRoot | Out-Null

  Invoke-Checked -Label "Git-tree archive materialization" -Action {
    & git -C $sourceRoot archive --format=tar --output=$gitArchivePath $commitSha
  }
  Invoke-Checked -Label "Git-tree archive extraction" -Action {
    & $tarCommand.Source -xf $gitArchivePath -C $gitMaterializedRoot
  }

  $packageMetadata = Get-Content -LiteralPath (Join-Path $gitMaterializedRoot "package.json") -Raw -Encoding UTF8 |
    ConvertFrom-Json
  if ([string]$packageMetadata.version -ne $productVersion) {
    throw "Git-tree package.json version must be $productVersion."
  }

  foreach ($relativePath in $selectedFiles) {
    Copy-ProjectFile `
      -MaterializedSourceRoot $gitMaterializedRoot `
      -RelativeSource $relativePath `
      -RelativeDestination $relativePath `
      -DestinationRoot $stagedPackagePath
  }
  foreach ($mapping in $templateMappings.GetEnumerator()) {
    Copy-ProjectFile `
      -MaterializedSourceRoot $gitMaterializedRoot `
      -RelativeSource $mapping.Key `
      -RelativeDestination $mapping.Value `
      -DestinationRoot $stagedPackagePath
  }

  $batSmokeCases = [ordered]@{
    "START_DEMO.bat" = "GOLD_START_CMD_SMOKE_OK"
    "STOP_DEMO.bat" = "GOLD_STOP_CMD_SMOKE_OK"
    "启动演示.bat" = "GOLD_START_CMD_SMOKE_OK"
    "关闭演示.bat" = "GOLD_STOP_CMD_SMOKE_OK"
  }
  foreach ($batRelativePath in $batSmokeCases.Keys) {
    $batPath = Join-Path $stagedPackagePath $batRelativePath
    Convert-BatToCrlf -Path $batPath
    Assert-BatCrlf -Path $batPath
  }

  Assert-ProjectPayload `
    -PayloadRoot $stagedPackagePath `
    -ExpectedRelativeFiles $expectedPayloadDestinations

  foreach ($batCase in $batSmokeCases.GetEnumerator()) {
    Invoke-BatSyntaxSmoke `
      -CmdPath $cmdCommand.Source `
      -BatPath (Join-Path $stagedPackagePath $batCase.Key) `
      -ExpectedMarker $batCase.Value
  }

  Invoke-Checked -Label "Locked Git-tree dependency install" -Action {
    & $pnpmCommand.Source `
      --dir $gitMaterializedRoot `
      install `
      --frozen-lockfile `
      --ignore-scripts `
      --config.node-linker=hoisted
  }

  $previousArtifactOutput = $env:GOLD_WEB3_ARTIFACT_OUT
  try {
    $env:GOLD_WEB3_ARTIFACT_OUT = $stagedArtifactPath
    Invoke-Checked -Label "DesignRegistry Git-tree compilation" -Action {
      & $nodePath (Join-Path $gitMaterializedRoot "scripts\web3-build.js")
    }
  } finally {
    $env:GOLD_WEB3_ARTIFACT_OUT = $previousArtifactOutput
  }

  $artifactDestination = Join-Path $stagedPackagePath "contracts\artifacts\DesignRegistry.json"
  New-Item -ItemType Directory -Path (Split-Path -Parent $artifactDestination) | Out-Null
  Copy-Item -LiteralPath $stagedArtifactPath -Destination $artifactDestination

  $stagedRuntimePath = Join-Path $stagedPackagePath "runtime"
  New-Item -ItemType Directory -Path $stagedRuntimePath | Out-Null
  Copy-Item -LiteralPath $nodePath -Destination (Join-Path $stagedRuntimePath "node.exe")
  foreach ($licenseFile in $runtimeLicenseFiles) {
    Copy-Item -LiteralPath $licenseFile.FullName -Destination (Join-Path $stagedRuntimePath $licenseFile.Name)
  }

  Invoke-Checked -Label "Locked production dependency install" -Action {
    & $pnpmCommand.Source `
      --dir $stagedPackagePath `
      install `
      --prod `
      --frozen-lockfile `
      --ignore-scripts `
      --config.node-linker=hoisted
  }

  foreach ($requiredDependency in @("ethers", "ganache")) {
    if (-not (Test-Path -LiteralPath (Join-Path $stagedPackagePath "node_modules\$requiredDependency\package.json") -PathType Leaf)) {
      throw "Production dependency is missing from package: $requiredDependency"
    }
  }
  if (Test-Path -LiteralPath (Join-Path $stagedPackagePath "node_modules\solc")) {
    throw "Development-only solc must not be installed in the portable package."
  }

  $ecosystemLicenseOutput = @(
    & $pnpmCommand.Source --dir $stagedPackagePath licenses list --prod --json
  )
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm informational license view failed with exit code $LASTEXITCODE."
  }
  $ecosystemLicenseData = ($ecosystemLicenseOutput -join "`n") | ConvertFrom-Json
  $ecosystemLicensePackageCount = 0
  foreach ($licenseGroup in $ecosystemLicenseData.PSObject.Properties) {
    foreach ($component in @($licenseGroup.Value)) {
      $ecosystemLicensePackageCount += @($component.versions).Count
    }
  }

  $pnpmVirtualStorePath = Join-Path $stagedPackagePath "node_modules\.pnpm"
  if (Test-Path -LiteralPath $pnpmVirtualStorePath -PathType Container) {
    $resolvedVirtualStorePath = [System.IO.Path]::GetFullPath($pnpmVirtualStorePath)
    $expectedVirtualStorePath = [System.IO.Path]::GetFullPath(
      (Join-Path $stagedPackagePath "node_modules\.pnpm")
    )
    $stagedPackagePrefix = $stagedPackagePath.TrimEnd("\") + "\"
    if (
      -not $resolvedVirtualStorePath.Equals(
        $expectedVirtualStorePath,
        [System.StringComparison]::OrdinalIgnoreCase
      ) -or
      (-not $resolvedVirtualStorePath.StartsWith(
        $stagedPackagePrefix,
        [System.StringComparison]::OrdinalIgnoreCase
      ))
    ) {
      throw "Refusing unsafe pnpm virtual-store cleanup: $resolvedVirtualStorePath"
    }
    Assert-ReparseTargetsContained `
      -RootPath $resolvedVirtualStorePath `
      -ContainmentRoot (Join-Path $stagedPackagePath "node_modules")
    Remove-Item -LiteralPath $resolvedVirtualStorePath -Recurse -Force
  }

  Invoke-Checked -Label "Production dependency license closure" -Action {
    & $nodePath `
      (Join-Path $gitMaterializedRoot "scripts\generate-production-license-manifest.js") `
      --package-root $stagedPackagePath `
      --manual-root (Join-Path $stagedPackagePath "third_party\manual-licenses") `
      --output (Join-Path $stagedPackagePath "THIRD_PARTY_LICENSE_MANIFEST.json") `
      --ecosystem-tool-count $ecosystemLicensePackageCount
  }

  $reparsePoints = @(
    Get-ChildItem -LiteralPath $stagedPackagePath -Recurse -Force |
      Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint }
  )
  if ($reparsePoints.Count -gt 0) {
    throw "Portable package contains reparse points and would not extract reliably."
  }

  Push-Location $stagedPackagePath
  try {
    Invoke-Checked -Label "Portable server import check" -Action {
      & (Join-Path $stagedRuntimePath "node.exe") -e "await import('./server.js')"
    }
    Invoke-Checked -Label "Portable local-chain import check" -Action {
      & (Join-Path $stagedRuntimePath "node.exe") -e "await import('ethers'); await import('ganache')"
    }
  } finally {
    Pop-Location
  }

  $endStatus = @(& git -C $sourceRoot status --porcelain=v1 --untracked-files=all)
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to re-inspect Git worktree status after the build lifecycle."
  }
  $endClean = $endStatus.Count -eq 0
  if (-not $endClean) {
    throw "Source worktree changed during the build lifecycle; refusing to write release metadata."
  }

  $sourceManifestEntries = @(
    foreach ($relativePath in ($selectedFiles | Sort-Object)) {
      $sourcePath = Join-Path $gitMaterializedRoot ($relativePath.Replace("/", "\"))
      $hash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
      [pscustomobject]@{
        Source = $relativePath
        Line = "$relativePath`t$hash"
      }
    }
    foreach ($mapping in ($templateMappings.GetEnumerator() | Sort-Object Key)) {
      $sourcePath = Join-Path $gitMaterializedRoot ($mapping.Key.Replace("/", "\"))
      $hash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
      [pscustomobject]@{
        Source = $mapping.Key
        Line = "$($mapping.Key)->$($mapping.Value)`t$hash"
      }
    }
  )
  $sourceManifestLines = @(
    $sourceManifestEntries |
      Sort-Object Source |
      ForEach-Object { $_.Line }
  )
  $sourceManifestText = ($sourceManifestLines -join "`n") + "`n"
  $artifactMetadata = Get-Content -LiteralPath $stagedArtifactPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $buildInfo = [ordered]@{
    schemaVersion = "gold-windows-portable-build/v2"
    product = "gold-design-framework"
    version = $productVersion
    packageName = $packageName
    packagedAtUtc = [DateTime]::UtcNow.ToString("o")
    source = [ordered]@{
      commit = $commitSha
      tree = $treeSha
      branch = $branchName
      commitAuthorAtUtc = $commitAuthorAtUtc
      commitCommittedAtUtc = $commitCommittedAtUtc
      cleanAtStart = $cleanAtStart
      sourceFromGitTree = $true
      endClean = $endClean
      selectedTrackedFileCount = $selectedFiles.Count + $templateMappings.Count
      manifestAlgorithm = "UTF-8 path<TAB>sha256<LF>, sorted by source path"
      manifestSha256 = Get-TextSha256 -Text $sourceManifestText
      batLineEndings = "CRLF-normalized and cmd.exe smoke-tested"
    }
    traceability = [ordered]@{
      dependencyLockEnforced = $true
      bitReproducibleClaim = $false
      note = "Source-bound and traceable build; package timestamps and ZIP metadata are not normalized."
    }
    runtime = [ordered]@{
      node = $runtimeIdentity.version
      platform = $runtimeIdentity.platform
      architecture = $runtimeIdentity.arch
    }
    registryArtifact = [ordered]@{
      compilerVersion = $artifactMetadata.compilerVersion
      sha256 = (Get-FileHash -LiteralPath $artifactDestination -Algorithm SHA256).Hash.ToLowerInvariant()
      productionCompilerBundled = $false
    }
    boundaries = @(
      "default AI output is explicit placeholder/demo output",
      "no OCR, model training, or automatic knowledge collection",
      "local Registry is loopback-only development infrastructure",
      "Monad Testnet access is read-only and may require network access",
      "on-chain evidence is not copyright registration"
    )
  }
  Write-Utf8NoBom `
    -Path (Join-Path $stagedPackagePath "BUILD_INFO.json") `
    -Content (($buildInfo | ConvertTo-Json -Depth 8) + "`n")

  $checksumLines = @(
    Get-ChildItem -LiteralPath $stagedPackagePath -File -Recurse |
      Where-Object { $_.Name -ne "SHA256SUMS.txt" } |
      ForEach-Object {
        $relativePath = $_.FullName.Substring($stagedPackagePath.Length + 1).Replace("\", "/")
        [pscustomobject]@{
          Path = $relativePath
          Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
      } |
      Sort-Object Path |
      ForEach-Object { "$($_.Hash)  $($_.Path)" }
  )
  Write-Utf8NoBom `
    -Path (Join-Path $stagedPackagePath "SHA256SUMS.txt") `
    -Content (($checksumLines -join "`n") + "`n")

  Compress-Archive `
    -LiteralPath $stagedPackagePath `
    -DestinationPath $stagedZipPath `
    -CompressionLevel Optimal
  $zipHash = (Get-FileHash -LiteralPath $stagedZipPath -Algorithm SHA256).Hash.ToLowerInvariant()

  Move-Item -LiteralPath $stagedPackagePath -Destination $packagePath
  Move-Item -LiteralPath $stagedZipPath -Destination $zipPath
  Write-Utf8NoBom -Path $zipSidecarPath -Content "$zipHash  $packageName.zip`n"

  Write-Host "Windows portable package prepared from Git tree $commitSha."
  Write-Host "Folder: $packagePath"
  Write-Host "ZIP: $zipPath"
  Write-Host "ZIP SHA-256: $zipHash"
} finally {
  if (Test-Path -LiteralPath $stagingRoot) {
    $resolvedStagingRoot = [System.IO.Path]::GetFullPath($stagingRoot)
    $expectedPrefix = $OutputRoot.TrimEnd("\") + "\.$packageName.build-"
    if (-not $resolvedStagingRoot.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing unsafe staging cleanup: $resolvedStagingRoot"
    }
    Remove-Item -LiteralPath $resolvedStagingRoot -Recurse -Force
  }
}
