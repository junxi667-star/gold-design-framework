import { ZeroHash, keccak256 } from "ethers";

export const DESIGN_MANIFEST_SCHEMA_VERSION = "design-manifest/v1";
export const DESIGN_MANIFEST_CANONICALIZATION = "sorted-object-keys+nfc-strings/json/utf-8/v1";
export const DESIGN_MANIFEST_CONTENT_HASH_ALGORITHM = "keccak256";
export const DESIGN_MANIFEST_ZERO_PARENT_HASH = ZeroHash.toLowerCase();

function normalizeCanonicalValue(value, path = "$") {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return typeof value === "string" ? value.normalize("NFC") : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Canonical JSON does not allow non-finite numbers at ${path}`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeCanonicalValue(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Canonical JSON only accepts plain objects at ${path}`);
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => {
          if (value[key] === undefined) {
            throw new TypeError(`Canonical JSON does not allow undefined at ${path}.${key}`);
          }
          return [
            key.normalize("NFC"),
            normalizeCanonicalValue(value[key], `${path}.${key}`),
          ];
        }),
    );
  }
  throw new TypeError(`Canonical JSON does not allow ${typeof value} at ${path}`);
}

export function canonicalJson(value) {
  return JSON.stringify(normalizeCanonicalValue(value));
}

export function canonicalJsonUtf8(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

export function designManifestContentHash(manifest) {
  if (
    !manifest
    || manifest.schemaVersion !== DESIGN_MANIFEST_SCHEMA_VERSION
  ) {
    throw new TypeError(`Manifest schema must be ${DESIGN_MANIFEST_SCHEMA_VERSION}`);
  }
  return keccak256(canonicalJsonUtf8(manifest));
}

export function manifestHashingDescriptor() {
  return {
    schemaVersion: DESIGN_MANIFEST_SCHEMA_VERSION,
    canonicalization: DESIGN_MANIFEST_CANONICALIZATION,
    textEncoding: "UTF-8",
    contentHashAlgorithm: DESIGN_MANIFEST_CONTENT_HASH_ALGORITHM,
    firstVersionParentContentHash: DESIGN_MANIFEST_ZERO_PARENT_HASH,
  };
}
