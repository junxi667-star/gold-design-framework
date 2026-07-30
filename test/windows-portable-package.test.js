import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageMetadata = JSON.parse(await readFile("package.json", "utf8"));
const packageScript = await readFile("scripts/package-windows-portable.ps1", "utf8");
const licenseManifestScript = await readFile(
  "scripts/generate-production-license-manifest.js",
  "utf8",
);
const portableStartScript = await readFile("packaging/scripts/start.ps1", "utf8");
const readme = await readFile("README.md", "utf8");
const gitAttributes = await readFile(".gitattributes", "utf8");

test("V0.6.0 runtime dependencies and packaging command are explicit", () => {
  assert.equal(packageMetadata.version, "0.6.0");
  assert.equal(packageMetadata.dependencies.ethers, "^6.15.0");
  assert.equal(packageMetadata.dependencies.ganache, "^7.9.2");
  assert.equal(packageMetadata.devDependencies.solc, "^0.8.30");
  assert.match(packageMetadata.scripts["package:windows"], /package-windows-portable\.ps1/);
});

test("Windows package source is materialized from the bound Git tree", () => {
  assert.match(packageScript, /status --porcelain=v1 --untracked-files=all/);
  assert.match(packageScript, /Refusing to package a dirty Git worktree/);
  assert.match(packageScript, /ls-tree -r --name-only \$commitSha/);
  assert.match(
    packageScript,
    /archive --format=zip --output=\$gitArchivePath \$commitSha/,
  );
  assert.match(packageScript, /function Expand-ValidatedGitArchiveZip/);
  assert.match(packageScript, /Unsafe ZIP entry traversal path/);
  assert.match(packageScript, /ZIP entry escaped the materialization root/);
  assert.match(packageScript, /reparse or symbolic-link entry/);
  assert.match(packageScript, /Duplicate or case-colliding ZIP entry path/);
  assert.match(packageScript, /function Assert-MaterializedGitBlob/);
  assert.match(
    packageScript,
    /data\/training\/黄金珠宝AI需求解析训练资料V1\.md/,
  );
  assert.doesNotMatch(packageScript, /tar\.exe|\$tarCommand|--format=tar/);
  assert.match(packageScript, /\[string\]\$MaterializedSourceRoot/);
  assert.match(packageScript, /Join-Path \$MaterializedSourceRoot/);
  assert.match(packageScript, /-MaterializedSourceRoot \$gitMaterializedRoot/);
  assert.match(
    packageScript,
    /--dir \$gitMaterializedRoot\s+`\s+install/,
  );
  assert.match(
    packageScript,
    /Join-Path \$gitMaterializedRoot "scripts\\web3-build\.js"/,
  );
  assert.doesNotMatch(packageScript, /--dir \$sourceRoot\s+`\s+install/);
  assert.doesNotMatch(
    packageScript,
    /Join-Path \$sourceRoot "scripts\\web3-build\.js"/,
  );
  assert.match(packageScript, /cleanAtStart = \$cleanAtStart/);
  assert.match(packageScript, /sourceFromGitTree = \$true/);
  assert.match(packageScript, /endClean = \$endClean/);
  assert.match(packageScript, /sourceCommit = \$commitSha/);
  assert.match(packageScript, /sourceTree = \$treeSha/);
  assert.match(packageScript, /Branch = \$branch/);
  assert.match(packageScript, /\$null/);
  assert.match(packageScript, /bitReproducibleClaim = \$false/);
  assert.match(packageScript, /Source-bound and traceable build/);
  assert.ok(
    [...packageScript.matchAll(/status --porcelain=v1 --untracked-files=all/g)].length >= 2,
    "Git cleanliness must be checked before and after the build lifecycle",
  );
  assert.doesNotMatch(packageScript, /git\s+archive\s+.*\bHEAD\b/);
});

test("Windows package script enforces an explicit, pre-install project payload gate", () => {
  assert.match(packageScript, /RuntimeDir must contain node\.exe/);
  assert.match(packageScript, /Windows x64 Node\.js 20 or newer/);
  assert.match(packageScript, /Refusing to overwrite existing release output/);
  assert.match(packageScript, /Forbidden project path selected for packaging/);
  assert.match(packageScript, /Project payload does not match the explicit whitelist/);
  assert.match(packageScript, /Compare-Object -ReferenceObject \$expectedFiles/);
  assert.match(packageScript, /\$expectedPayloadDestinations = @\(/);
  assert.match(packageScript, /Assert-ProjectPayload/);
  assert.match(
    packageScript,
    /Project payload scan must run before third-party node_modules are installed/,
  );
  for (const forbiddenKeyword of [
    "团队架构",
    "岗位协作",
    "协作系统",
    "第一大脑",
    "第二大脑",
    "夜间做梦",
    "XIAOFANZI",
    "PROJECT_INITIALIZATION",
    "collaboration-os",
    "AGENTS.md",
    "创建者项目",
  ]) {
    assert.match(packageScript, new RegExp(forbiddenKeyword.replace(".", "\\.")));
  }
  assert.match(packageScript, /PRIVATE KEY/);
  assert.match(packageScript, /High-confidence access token detected/);
  assert.match(packageScript, /High-confidence assigned secret detected/);
  assert.match(packageScript, /api\[_-\]\?key/);
  assert.match(packageScript, /\.IndexOf\(\$keyword, \[System\.StringComparison\]::OrdinalIgnoreCase\)/);
  assert.doesNotMatch(packageScript, /\.Contains\(\$keyword,/);
  assert.ok(packageScript.includes("\\s*[:=]\\s*[\"'']?"));
  assert.ok(
    packageScript.indexOf("Assert-ProjectPayload `")
      < packageScript.indexOf('Invoke-Checked -Label "Locked Git-tree dependency install"'),
    "The project payload must be scanned before dependency installation",
  );
  assert.match(packageScript, /contracts\\artifacts\\DesignRegistry\.json/);
  assert.match(packageScript, /contracts\/deployments\/monad-testnet-10143\.json/);
  assert.match(packageScript, /SHA256SUMS\.txt/);
  assert.doesNotMatch(packageScript, /git\s+add|Copy-Item\s+.*\*/);
  assert.match(gitAttributes, /^\* text=auto eol=lf$/m);
  assert.match(gitAttributes, /^\*\.bat text eol=crlf$/m);
});

test("Windows package records the physical license closure and exact manual fallback", () => {
  assert.match(
    packageScript,
    /third_party\/manual-licenses\/async-eventemitter@0\.2\.4\.txt/,
  );
  assert.match(packageScript, /THIRD_PARTY_LICENSE_MANIFEST\.json/);
  assert.match(packageScript, /--ecosystem-tool-count \$ecosystemLicensePackageCount/);
  assert.match(packageScript, /node_modules\\\.pnpm/);
  assert.match(packageScript, /Refusing unsafe pnpm virtual-store cleanup/);
  assert.match(packageScript, /function Assert-ReparseTargetsContained/);
  assert.match(packageScript, /virtual-store root that is itself a reparse point/);
  assert.match(packageScript, /Reparse target escaped the pnpm virtual store/);
  assert.match(packageScript, /Portable package contains reparse points/);
  assert.match(
    packageScript,
    /Join-Path \$gitMaterializedRoot "scripts\\generate-production-license-manifest\.js"/,
  );
  assert.match(
    licenseManifestScript,
    /closureAuthority: "physical-installed-package-paths"/,
  );
  assert.match(licenseManifestScript, /uniqueComponentCount/);
  assert.match(licenseManifestScript, /sha256: sha256\(lockfileContent\)/);
  assert.match(licenseManifestScript, /"async-eventemitter@0\.2\.4"/);
  assert.match(
    licenseManifestScript,
    /Copyright \(c\) 2013 Andreas Hultgren/,
  );
  assert.match(licenseManifestScript, /exactManualAllowlist/);
  assert.match(licenseManifestScript, /completeNoticeBodyRequired: true/);
  assert.match(licenseManifestScript, /function hasCompleteDeclaredLicenseBody/);
  for (const license of ["MIT", "ISC", "0BSD", "BSD-3-Clause", "Apache-2.0"]) {
    assert.match(licenseManifestScript, new RegExp(`case "${license}":`));
  }
});

test("Windows package normalizes all four owned BAT launchers and runs cmd smoke", () => {
  const batCaseBlock = packageScript.match(
    /\$batSmokeCases = \[ordered\]@\{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(batCaseBlock, "BAT smoke-case map must exist");
  for (const launcher of [
    "START_DEMO.bat",
    "STOP_DEMO.bat",
    "启动演示.bat",
    "关闭演示.bat",
  ]) {
    assert.match(batCaseBlock, new RegExp(launcher.replace(".", "\\.")));
  }
  assert.match(packageScript, /function Convert-BatToCrlf/);
  assert.match(
    packageScript,
    /\(\$content -replace "`r`n\?", "`n"\) -replace "`n", "`r`n"/,
  );
  assert.match(packageScript, /function Assert-BatCrlf/);
  assert.match(packageScript, /BAT file contains a naked LF instead of CRLF/);
  assert.match(packageScript, /function Invoke-BatSyntaxSmoke/);
  assert.match(packageScript, /& \$CmdPath \/d \/s \/c/);
  assert.match(packageScript, /--syntax-smoke/);
  assert.match(packageScript, /GOLD_START_CMD_SMOKE_OK/);
  assert.match(packageScript, /GOLD_STOP_CMD_SMOKE_OK/);
});

test("portable start pins and restores every guarded child environment family", () => {
  const expectedPinnedEntries = [
    /LOCAL_EVM_PORT = "8545"/,
    /LOCAL_EVM_CHAIN_ID = "31337"/,
    /LOCAL_EVM_RPC_URL = \$evmRpcUrl/,
    /GOLD_WEB3_STATE_PATH = \(Join-Path \$packageRoot "data\\web3-backend-state\.json"\)/,
    /GOLD_WEB3_RUNTIME_PATH = \(Join-Path \$packageRoot "data\\web3-local-runtime\.json"\)/,
    /GOLD_WEB3_ARTIFACT_PATH = \(Join-Path \$packageRoot "contracts\\artifacts\\DesignRegistry\.json"\)/,
    /PORT = "4173"/,
  ];
  for (const entry of expectedPinnedEntries) {
    assert.match(portableStartScript, entry);
  }
  assert.match(portableStartScript, /function Get-GuardedEnvironmentSnapshot/);
  assert.match(portableStartScript, /function Clear-GuardedEnvironment/);
  assert.match(portableStartScript, /function Set-PortableEnvironment/);
  assert.match(portableStartScript, /function Restore-GuardedEnvironment/);
  assert.match(portableStartScript, /\$normalized -eq "PORT"/);
  assert.match(portableStartScript, /StartsWith\("LOCAL_EVM_"/);
  assert.match(portableStartScript, /StartsWith\("GOLD_WEB3_"/);
  const snapshotIndex = portableStartScript.indexOf(
    "$guardedEnvironmentSnapshot = Get-GuardedEnvironmentSnapshot",
  );
  const pinIndex = portableStartScript.indexOf("Set-PortableEnvironment", snapshotIndex);
  const tryIndex = portableStartScript.indexOf("try {", pinIndex);
  const finallyIndex = portableStartScript.lastIndexOf("} finally {");
  const restoreIndex = portableStartScript.lastIndexOf(
    "Restore-GuardedEnvironment -Snapshot $guardedEnvironmentSnapshot",
  );
  assert.ok(snapshotIndex >= 0 && snapshotIndex < pinIndex);
  assert.ok(pinIndex < tryIndex);
  assert.ok(tryIndex < finallyIndex);
  assert.ok(finallyIndex < restoreIndex);
});

test("V0.6.0 README states AI, network, Registry, and copyright boundaries", () => {
  assert.match(readme, /V0\.6\.0/);
  assert.match(readme, /不识别照片、不做 OCR/);
  assert.match(readme, /不训练或微调模型/);
  assert.match(readme, /不自动联网采集专业知识/);
  assert.match(readme, /本地开发链/);
  assert.match(readme, /Monad Testnet.*只读/);
  assert.match(readme, /链上记录不等于版权登记/);
});
