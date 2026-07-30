import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createProductionLicenseManifest } from "../scripts/generate-production-license-manifest.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manualNoticeRoot = path.join(projectRoot, "third_party", "manual-licenses");

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

test("production license manifest covers the authoritative physical closure", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "gold-license-manifest-"));
  const outputPath = path.join(temporaryRoot, "THIRD_PARTY_LICENSE_MANIFEST.json");
  try {
    const manifest = await createProductionLicenseManifest({
      packageRoot: projectRoot,
      manualNoticeRoot,
      outputPath,
      ecosystemToolCount: 39,
    });
    assert.equal(manifest.schemaVersion, "production-third-party-license-manifest/v1");
    assert.equal(manifest.closureAuthority, "physical-installed-package-paths");
    assert.equal(manifest.productionPackageCount, 65);
    assert.equal(manifest.packages.length, 65);
    assert.equal(manifest.uniqueComponentCount, 59);
    assert.equal(manifest.ecosystemToolView.pnpmLicenseListPackageCount, 39);
    assert.equal(manifest.ecosystemToolView.reconciliationStatus, "UNKNOWN");
    assert.match(
      manifest.ecosystemToolView.note,
      /Informational only[\s\S]*not used as the release gate/,
    );

    const lockfileContent = await readFile(path.join(projectRoot, "pnpm-lock.yaml"));
    assert.deepEqual(manifest.lockfile, {
      path: "pnpm-lock.yaml",
      sha256: sha256(lockfileContent),
    });
    assert.deepEqual(
      manifest.gate.exactManualAllowlist,
      ["async-eventemitter@0.2.4"],
    );
    assert.equal(manifest.gate.packageJsonLicenseFieldRequired, true);
    assert.equal(manifest.gate.completeNoticeBodyRequired, true);
    assert.equal(manifest.gate.exactVersionManualFallbackAllowed, true);

    const manualPackages = manifest.packages.filter(
      (item) => item.noticeSource === "manual-version-matched",
    );
    assert.equal(manualPackages.length, 1);
    assert.equal(manualPackages[0].name, "async-eventemitter");
    assert.equal(manualPackages[0].version, "0.2.4");
    assert.equal(
      manualPackages[0].noticeFiles[0].path,
      "third_party/manual-licenses/async-eventemitter@0.2.4.txt",
    );
    const manualBody = await readFile(
      path.join(manualNoticeRoot, "async-eventemitter@0.2.4.txt"),
      "utf8",
    );
    assert.match(manualBody, /Copyright \(c\) 2013 Andreas Hultgren/);
    assert.match(manualBody, /Permission is hereby granted, free of charge/);
    assert.match(manualBody, /THE SOFTWARE IS PROVIDED "AS IS"/);

    const readmeBodyComponents = manifest.packages
      .filter((item) => item.noticeSource === "readme-complete-body")
      .map((item) => `${item.name}@${item.version}`)
      .sort();
    assert.deepEqual(readmeBodyComponents, [
      "brorand@1.1.0",
      "elliptic@6.5.4",
      "hash.js@1.1.7",
      "hmac-drbg@1.0.1",
      "minimalistic-crypto-utils@1.0.1",
    ]);
    for (const item of manifest.packages) {
      assert.ok(item.declaredLicense);
      assert.ok(item.noticeFiles.length > 0);
      for (const notice of item.noticeFiles) {
        assert.ok(notice.bytes >= manifest.gate.minimumNoticeBytes);
        assert.match(notice.sha256, /^[0-9a-f]{64}$/);
      }
    }

    const persistedManifest = JSON.parse(await readFile(outputPath, "utf8"));
    assert.deepEqual(persistedManifest, manifest);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("license closure fails closed when a dependency has no complete body or allowlist", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "gold-license-fixture-"));
  const packageRoot = path.join(fixtureRoot, "package");
  const dependencyRoot = path.join(packageRoot, "node_modules", "missing-license-body");
  const fixtureManualRoot = path.join(packageRoot, "manual");
  try {
    await mkdir(dependencyRoot, { recursive: true });
    await mkdir(fixtureManualRoot, { recursive: true });
    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "license-fixture",
        version: "1.0.0",
        dependencies: { "missing-license-body": "1.0.0" },
      }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(path.join(packageRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await writeFile(
      path.join(dependencyRoot, "package.json"),
      `${JSON.stringify({
        name: "missing-license-body",
        version: "1.0.0",
        license: "MIT",
      }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(dependencyRoot, "LICENSE"),
      "This file is deliberately longer than eighty bytes but has no grant, "
        + "preservation condition, disclaimer, or liability limitation.\n",
      "utf8",
    );

    await assert.rejects(
      createProductionLicenseManifest({
        packageRoot,
        manualNoticeRoot: fixtureManualRoot,
        outputPath: path.join(packageRoot, "manifest.json"),
        ecosystemToolCount: 0,
      }),
      /missing-license-body@1\.0\.0 has no complete LICENSE\/NOTICE body and is not on the exact manual allowlist/,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("exact manual fallback also fails closed when its version-matched body is absent", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "gold-license-manual-fixture-"));
  const packageRoot = path.join(fixtureRoot, "package");
  const dependencyRoot = path.join(packageRoot, "node_modules", "async-eventemitter");
  const fixtureManualRoot = path.join(packageRoot, "manual");
  try {
    await mkdir(dependencyRoot, { recursive: true });
    await mkdir(fixtureManualRoot, { recursive: true });
    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "manual-license-fixture",
        version: "1.0.0",
        dependencies: { "async-eventemitter": "0.2.4" },
      }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(path.join(packageRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await writeFile(
      path.join(dependencyRoot, "package.json"),
      `${JSON.stringify({
        name: "async-eventemitter",
        version: "0.2.4",
        license: "MIT",
      }, null, 2)}\n`,
      "utf8",
    );

    await assert.rejects(
      createProductionLicenseManifest({
        packageRoot,
        manualNoticeRoot: fixtureManualRoot,
        outputPath: path.join(packageRoot, "manifest.json"),
        ecosystemToolCount: 0,
      }),
      /async-eventemitter@0\.2\.4 is missing its exact allowlisted manual notice/,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
