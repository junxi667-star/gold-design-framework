import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = resolve(".");
const packageScriptPath = resolve("scripts/package-windows-portable.ps1");
const chineseTrainingPath =
  "data/training/黄金珠宝AI需求解析训练资料V1.md";

function psLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function run(command, args, options = {}) {
  const encoding = Object.prototype.hasOwnProperty.call(options, "encoding")
    ? options.encoding
    : "utf8";
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding,
    maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
  );
  return result;
}

function runPowerShell(source, options = {}) {
  const encoded = Buffer.from(source, "utf16le").toString("base64");
  return run(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encoded,
    ],
    options,
  );
}

function importPackageFunctions() {
  return `. ${psLiteral(packageScriptPath)} -RuntimeDir ${psLiteral(repositoryRoot)}\n`;
}

test("UTF-8 Git ZIP materialization preserves the tracked Chinese path and blob bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "gold-package-unicode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archivePath = join(root, "source.zip");
  const materializedRoot = join(root, "materialized");

  run("git", [
    "-C",
    repositoryRoot,
    "archive",
    "--format=zip",
    `--output=${archivePath}`,
    "HEAD",
  ]);
  runPowerShell(`
${importPackageFunctions()}
New-Item -ItemType Directory -Path ${psLiteral(materializedRoot)} | Out-Null
Expand-ValidatedGitArchiveZip -ArchivePath ${psLiteral(archivePath)} -DestinationRoot ${psLiteral(materializedRoot)}
Assert-MaterializedGitBlob -SourceRoot ${psLiteral(repositoryRoot)} -SourceCommit HEAD -MaterializedRoot ${psLiteral(materializedRoot)} -RelativePath ${psLiteral(chineseTrainingPath)}
`);

  const materializedBytes = await readFile(
    join(materializedRoot, ...chineseTrainingPath.split("/")),
  );
  const blobBytes = run(
    "git",
    ["-C", repositoryRoot, "show", `HEAD:${chineseTrainingPath}`],
    { encoding: null },
  ).stdout;
  assert.deepEqual(materializedBytes, blobBytes);
});

test("validated Git ZIP extraction rejects path traversal before writing outside the root", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "gold-package-traversal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archivePath = join(root, "malicious.zip");
  const materializedRoot = join(root, "materialized");
  const escapedPath = join(root, "escaped.txt");

  runPowerShell(`
Add-Type -AssemblyName System.IO.Compression
$stream = [System.IO.FileStream]::new(${psLiteral(archivePath)}, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try {
  $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    $entry = $archive.CreateEntry("../escaped.txt")
    $writer = [System.IO.StreamWriter]::new($entry.Open())
    try { $writer.Write("must-not-escape") } finally { $writer.Dispose() }
  } finally {
    $archive.Dispose()
  }
} finally {
  $stream.Dispose()
}
`);
  const rejection = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(`
${importPackageFunctions()}
New-Item -ItemType Directory -Path ${psLiteral(materializedRoot)} | Out-Null
try {
  Expand-ValidatedGitArchiveZip -ArchivePath ${psLiteral(archivePath)} -DestinationRoot ${psLiteral(materializedRoot)}
  exit 9
} catch {
  if ($_.Exception.Message -notmatch "traversal") {
    Write-Error $_
    exit 10
  }
}
exit 0
`, "utf16le").toString("base64"),
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  assert.equal(
    rejection.status,
    0,
    `traversal rejection failed\nstdout:\n${rejection.stdout}\nstderr:\n${rejection.stderr}`,
  );
  await assert.rejects(readFile(escapedPath), { code: "ENOENT" });
});

test("Git build identity records main and uses null branch on detached HEAD", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "gold-package-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "identity.txt"), "identity\n", "utf8");

  run("git", ["init", "-b", "main"], { cwd: root });
  run("git", ["config", "user.name", "Package Test"], { cwd: root });
  run("git", ["config", "user.email", "package-test@example.invalid"], {
    cwd: root,
  });
  run("git", ["add", "identity.txt"], { cwd: root });
  run("git", ["commit", "-m", "identity fixture"], { cwd: root });

  const mainIdentity = JSON.parse(
    runPowerShell(`
${importPackageFunctions()}
Get-GitBuildIdentity -SourceRoot ${psLiteral(root)} | ConvertTo-Json -Compress
`).stdout.trim(),
  );
  assert.equal(mainIdentity.Branch, "main");
  assert.match(mainIdentity.SourceCommit, /^[0-9a-f]{40}$/);
  assert.match(mainIdentity.SourceTree, /^[0-9a-f]{40}$/);

  run("git", ["checkout", "--detach", "HEAD"], { cwd: root });
  const detachedIdentity = JSON.parse(
    runPowerShell(`
${importPackageFunctions()}
Get-GitBuildIdentity -SourceRoot ${psLiteral(root)} | ConvertTo-Json -Compress
`).stdout.trim(),
  );
  assert.equal(detachedIdentity.Branch, null);
  assert.equal(detachedIdentity.SourceCommit, mainIdentity.SourceCommit);
  assert.equal(detachedIdentity.SourceTree, mainIdentity.SourceTree);
});
