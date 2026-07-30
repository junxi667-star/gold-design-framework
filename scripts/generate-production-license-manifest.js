import { createHash } from "node:crypto";
import {
  access,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NOTICE_NAME_PATTERN = /^(?:licen[cs]e|notice|copying)(?:[._-].*)?$/i;
const README_NAME_PATTERN = /^readme(?:\..+)?$/i;
const MIN_NOTICE_LENGTH = 80;
const MANUAL_NOTICE_ALLOWLIST = new Map([
  [
    "async-eventemitter@0.2.4",
    {
      file: "async-eventemitter@0.2.4.txt",
      requiredCopyright: "Copyright (c) 2013 Andreas Hultgren",
    },
  ],
]);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function packageSegments(name) {
  if (name.startsWith("@")) {
    const [scope, packageName, ...rest] = name.split("/");
    if (!scope || !packageName || rest.length) throw new Error(`Invalid scoped package name: ${name}`);
    return [scope, packageName];
  }
  if (!name || name.includes("/")) throw new Error(`Invalid package name: ${name}`);
  return [name];
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveDependencyPackageJson(projectRoot, fromPackageRoot, dependencyName) {
  const segments = packageSegments(dependencyName);
  let cursor = fromPackageRoot;
  while (isContained(projectRoot, cursor)) {
    const candidate = path.join(cursor, "node_modules", ...segments, "package.json");
    if (await fileExists(candidate)) return candidate;
    if (cursor === projectRoot) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

function manualNoticeName(name, version) {
  return `${name.replace("/", "__")}@${version}.txt`;
}

function hasCompleteDeclaredLicenseBody(declaredLicense, text) {
  switch (declaredLicense.trim()) {
    case "MIT":
      return (
        /Permission\s+is\s+hereby\s+granted,\s+free\s+of\s+charge/i.test(text)
        && /The\s+above\s+copyright\s+notice\s+and\s+this\s+permission\s+notice\s+shall\s+be\s+included/i.test(text)
        && /THE\s+SOFTWARE\s+IS\s+PROVIDED\s+["“]?AS\s+IS["”]?/i.test(text)
        && /IN\s+NO\s+EVENT\s+SHALL\s+THE\s+AUTHORS?\s+OR\s+COPYRIGHT\s+HOLDERS?\s+BE\s+LIABLE/i.test(text)
      );
    case "ISC":
      return (
        /Permission\s+to\s+use,\s+copy,\s+modify,\s+and\/or\s+distribute\s+this\s+software/i.test(text)
        && /provided\s+that\s+the\s+above\s+copyright\s+notice\s+and\s+this\s+permission\s+notice\s+appear\s+in\s+all\s+copies/i.test(text)
        && /THE\s+SOFTWARE\s+IS\s+PROVIDED\s+["“]?AS\s+IS["”]?/i.test(text)
        && /IN\s+NO\s+EVENT\s+SHALL\s+THE\s+AUTHOR\s+BE\s+LIABLE/i.test(text)
      );
    case "0BSD":
      return (
        /Permission\s+to\s+use,\s+copy,\s+modify,\s+and\/or\s+distribute\s+this\s+software/i.test(text)
        && /purpose\s+with\s+or\s+without\s+fee\s+is\s+hereby\s+granted/i.test(text)
        && /THE\s+SOFTWARE\s+IS\s+PROVIDED\s+["“]?AS\s+IS["”]?/i.test(text)
        && /IN\s+NO\s+EVENT\s+SHALL\s+THE\s+AUTHOR\s+BE\s+LIABLE/i.test(text)
      );
    case "BSD-3-Clause":
      return (
        /Redistribution\s+and\s+use\s+in\s+source\s+and\s+binary\s+forms/i.test(text)
        && /Redistributions\s+of\s+source\s+code\s+must\s+retain/i.test(text)
        && /Redistributions\s+in\s+binary\s+form\s+must\s+reproduce/i.test(text)
        && /Neither\s+the\s+name\s+of\s+the\s+copyright\s+holder/i.test(text)
        && /THIS\s+SOFTWARE\s+IS\s+PROVIDED[\s\S]*["“]?AS\s+IS["”]?/i.test(text)
        && /IN\s+NO\s+EVENT\s+SHALL\s+THE\s+COPYRIGHT\s+HOLDER\s+OR\s+CONTRIBUTORS\s+BE\s+LIABLE/i.test(text)
      );
    case "Apache-2.0":
      return (
        /Apache\s+License\s+Version\s+2\.0,\s+January\s+2004/i.test(text)
        && /TERMS\s+AND\s+CONDITIONS\s+FOR\s+USE,\s+REPRODUCTION,\s+AND\s+DISTRIBUTION/i.test(text)
        && /Redistribution\.\s+You\s+may\s+reproduce\s+and\s+distribute\s+copies/i.test(text)
        && /Disclaimer\s+of\s+Warranty/i.test(text)
        && /Limitation\s+of\s+Liability/i.test(text)
      );
    default:
      return false;
  }
}

async function readNoticeFiles(packageRoot, declaredLicense) {
  const entries = await readdir(packageRoot, { withFileTypes: true });
  const notices = [];
  for (const entry of entries) {
    if (!entry.isFile() || !NOTICE_NAME_PATTERN.test(entry.name)) continue;
    const noticePath = path.join(packageRoot, entry.name);
    const content = await readFile(noticePath);
    if (
      content.length < MIN_NOTICE_LENGTH
      || !hasCompleteDeclaredLicenseBody(declaredLicense, content.toString("utf8"))
    ) {
      continue;
    }
    notices.push({ path: noticePath, content, source: "package-notice-file" });
  }
  if (notices.length) return notices;

  for (const entry of entries) {
    if (!entry.isFile() || !README_NAME_PATTERN.test(entry.name)) continue;
    const readmePath = path.join(packageRoot, entry.name);
    const content = await readFile(readmePath);
    const text = content.toString("utf8");
    if (
      content.length >= MIN_NOTICE_LENGTH
      && hasCompleteDeclaredLicenseBody(declaredLicense, text)
    ) {
      notices.push({ path: readmePath, content, source: "readme-complete-body" });
    }
  }
  return notices;
}

function dependencyNames(metadata) {
  return [...new Set([
    ...Object.keys(metadata.dependencies || {}),
    ...Object.keys(metadata.optionalDependencies || {}),
    ...Object.keys(metadata.peerDependencies || {}),
    ...(Array.isArray(metadata.bundledDependencies) ? metadata.bundledDependencies : []),
    ...(Array.isArray(metadata.bundleDependencies) ? metadata.bundleDependencies : []),
  ])].sort();
}

export async function createProductionLicenseManifest({
  packageRoot,
  manualNoticeRoot,
  outputPath,
  ecosystemToolCount = null,
}) {
  const resolvedPackageRoot = await realpath(packageRoot);
  const rootMetadata = JSON.parse(await readFile(path.join(resolvedPackageRoot, "package.json"), "utf8"));
  const lockfilePath = path.join(resolvedPackageRoot, "pnpm-lock.yaml");
  const lockfileContent = await readFile(lockfilePath);
  const queue = Object.keys(rootMetadata.dependencies || {}).sort().map((name) => ({
    name,
    fromPackageRoot: resolvedPackageRoot,
    optional: false,
    bundled: false,
    peer: false,
  }));
  const visitedPaths = new Set();
  const packages = [];

  while (queue.length) {
    const request = queue.shift();
    const packageJsonPath = await resolveDependencyPackageJson(
      resolvedPackageRoot,
      request.fromPackageRoot,
      request.name,
    );
    if (!packageJsonPath) {
      if (request.optional) continue;
      throw new Error(`Production dependency is not installed: ${request.name}`);
    }
    const resolvedPackageJsonPath = await realpath(packageJsonPath);
    const installedPackageRoot = path.dirname(resolvedPackageJsonPath);
    if (!isContained(path.join(resolvedPackageRoot, "node_modules"), installedPackageRoot)) {
      throw new Error(`Resolved dependency escaped node_modules: ${request.name}`);
    }
    if (visitedPaths.has(installedPackageRoot)) continue;
    visitedPaths.add(installedPackageRoot);

    const metadata = JSON.parse(await readFile(resolvedPackageJsonPath, "utf8"));
    if (metadata.name !== request.name || typeof metadata.version !== "string" || !metadata.version) {
      throw new Error(`Installed package identity mismatch for ${request.name}`);
    }
    if (typeof metadata.license !== "string" || !metadata.license.trim()) {
      throw new Error(`${metadata.name}@${metadata.version} has no package.json license field`);
    }

    let notices = await readNoticeFiles(installedPackageRoot, metadata.license.trim());
    let noticeSource = notices[0]?.source || "package-notice-file";
    if (!notices.length) {
      const componentId = `${metadata.name}@${metadata.version}`;
      const allowlistedManual = MANUAL_NOTICE_ALLOWLIST.get(componentId);
      if (!allowlistedManual) {
        throw new Error(
          `${componentId} has no complete LICENSE/NOTICE body and is not on the exact manual allowlist`,
        );
      }
      const expectedManualName = manualNoticeName(metadata.name, metadata.version);
      if (allowlistedManual.file !== expectedManualName) {
        throw new Error(`Manual allowlist filename mismatch for ${componentId}`);
      }
      const manualPath = path.join(manualNoticeRoot, allowlistedManual.file);
      if (!(await fileExists(manualPath))) {
        throw new Error(
          `${componentId} is missing its exact allowlisted manual notice`,
        );
      }
      const manualContent = await readFile(manualPath);
      if (manualContent.length < MIN_NOTICE_LENGTH) {
        throw new Error(`Manual notice is incomplete: ${manualPath}`);
      }
      const manualText = manualContent.toString("utf8");
      if (
        !manualText.includes(allowlistedManual.requiredCopyright)
        || !hasCompleteDeclaredLicenseBody(metadata.license.trim(), manualText)
      ) {
        throw new Error(`Manual notice identity or MIT body is incomplete: ${manualPath}`);
      }
      notices = [{ path: manualPath, content: manualContent, source: "manual-version-matched" }];
      noticeSource = "manual-version-matched";
    }

    packages.push({
      name: metadata.name,
      version: metadata.version,
      declaredLicense: metadata.license.trim(),
      installedPath: normalizePath(path.relative(resolvedPackageRoot, installedPackageRoot)),
      coverageKind: request.bundled
        ? "bundled-distribution"
        : request.peer
          ? "peer-auto-installed"
          : "lock-graph",
      noticeSource,
      noticeFiles: notices
        .map((notice) => ({
          path: normalizePath(path.relative(resolvedPackageRoot, notice.path)),
          sha256: sha256(notice.content),
          bytes: notice.content.length,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    });

    const optionalDependencies = new Set(Object.keys(metadata.optionalDependencies || {}));
    const optionalPeers = metadata.peerDependenciesMeta || {};
    const declaredDependencies = new Set([
      ...Object.keys(metadata.dependencies || {}),
      ...Object.keys(metadata.optionalDependencies || {}),
    ]);
    const peerDependencies = new Set(Object.keys(metadata.peerDependencies || {}));
    const bundledDependencies = new Set([
      ...(Array.isArray(metadata.bundledDependencies) ? metadata.bundledDependencies : []),
      ...(Array.isArray(metadata.bundleDependencies) ? metadata.bundleDependencies : []),
    ]);
    for (const dependencyName of dependencyNames(metadata)) {
      queue.push({
        name: dependencyName,
        fromPackageRoot: installedPackageRoot,
        optional: optionalDependencies.has(dependencyName)
          || optionalPeers[dependencyName]?.optional === true,
        bundled: request.bundled || bundledDependencies.has(dependencyName),
        peer: request.peer
          || (
            peerDependencies.has(dependencyName)
            && !declaredDependencies.has(dependencyName)
          ),
      });
    }
  }

  packages.sort((left, right) =>
    `${left.name}@${left.version}:${left.installedPath}`
      .localeCompare(`${right.name}@${right.version}:${right.installedPath}`));
  const uniqueComponentCount = new Set(
    packages.map((item) => `${item.name}@${item.version}`),
  ).size;
  if (!packages.length || !uniqueComponentCount) {
    throw new Error("Physical production dependency closure is empty");
  }

  const manifest = {
    schemaVersion: "production-third-party-license-manifest/v1",
    rootPackage: {
      name: rootMetadata.name,
      version: rootMetadata.version,
    },
    productionPackageCount: packages.length,
    closureAuthority: "physical-installed-package-paths",
    uniqueComponentCount,
    lockfile: {
      path: "pnpm-lock.yaml",
      sha256: sha256(lockfileContent),
    },
    ecosystemToolView: {
      pnpmLicenseListPackageCount: ecosystemToolCount,
      reconciliationStatus: "UNKNOWN",
      note:
        "Informational only. pnpm's license view may collapse or omit bundled physical package paths; "
        + "it is not used as the release gate.",
    },
    gate: {
      packageJsonLicenseFieldRequired: true,
      completeNoticeBodyRequired: true,
      exactVersionManualFallbackAllowed: true,
      exactManualAllowlist: [...MANUAL_NOTICE_ALLOWLIST.keys()],
      minimumNoticeBytes: MIN_NOTICE_LENGTH,
      bundledDistributionCovered: true,
    },
    packages,
  };
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function parseArguments(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(
        "Usage: --package-root PATH --manual-root PATH --output PATH "
          + "[--ecosystem-tool-count N]",
      );
    }
    result[flag.slice(2)] = value;
  }
  return result;
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const args = parseArguments(process.argv.slice(2));
  const ecosystemToolCount = args["ecosystem-tool-count"] === undefined
    ? null
    : Number(args["ecosystem-tool-count"]);
  if (
    !args["package-root"]
    || !args["manual-root"]
    || !args.output
    || (
      ecosystemToolCount !== null
      && (!Number.isSafeInteger(ecosystemToolCount) || ecosystemToolCount < 0)
    )
  ) {
    throw new Error("Required license-manifest arguments are missing or invalid");
  }
  const manifest = await createProductionLicenseManifest({
    packageRoot: args["package-root"],
    manualNoticeRoot: args["manual-root"],
    outputPath: args.output,
    ecosystemToolCount,
  });
  console.log(
      `Production license manifest: ${manifest.productionPackageCount} physical package paths, `
      + `${manifest.uniqueComponentCount} unique components`,
  );
}
