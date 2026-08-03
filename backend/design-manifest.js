import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { keccak256 } from "./keccak.js";
import { ZERO_HASH, normalizeAddress } from "./evm-codec.js";

export const METADATA_SCHEMA_VERSION = "jewelchain-design/v1";
export const CANONICALIZATION = "sorted-object-keys+nfc-strings/json/utf-8/v1";

function normalizeValue(value, path = "$") {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item, index) => normalizeValue(item, `${path}[${index}]`));
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`Only plain objects are allowed at ${path}`);
    return Object.fromEntries(Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) throw new TypeError(`undefined is not allowed at ${path}.${key}`);
      return [key.normalize("NFC"), normalizeValue(value[key], `${path}.${key}`)];
    }));
  }
  throw new TypeError(`Unsupported type at ${path}`);
}

export function canonicalJson(value) {
  return JSON.stringify(normalizeValue(value));
}

export function hashCanonical(value) {
  return keccak256(Buffer.from(canonicalJson(value), "utf8"));
}

export function hashText(value) {
  return keccak256(Buffer.from(String(value ?? "").normalize("NFC"), "utf8"));
}

export async function hashImageFile(filePath) {
  const bytes = await readFile(filePath);
  return {
    imageHash: keccak256(bytes),
    imageSha256: createHash("sha256").update(bytes).digest("hex"),
    imageSizeBytes: bytes.length,
  };
}

function publicRequirement(requirement) {
  return {
    productType: String(requirement.productType || ""),
    goldType: String(requirement.goldType || ""),
    shape: String(requirement.shape || requirement.structureForms?.[0] || ""),
    style: String(requirement.style || ""),
    motifs: Array.isArray(requirement.motifs) ? requirement.motifs : [],
    surfaceEffects: Array.isArray(requirement.surfaceEffects) ? requirement.surfaceEffects : [],
    targetAudience: String(requirement.targetAudience || ""),
    usageScenario: String(requirement.usageScenario || ""),
    mustKeep: Array.isArray(requirement.mustKeep) ? requirement.mustKeep : [],
    mustAvoid: Array.isArray(requirement.mustAvoid) ? requirement.mustAvoid : [],
  };
}

export function buildMetadata({ project, version, registrant, imageUri, imageEvidence }) {
  const normalizedRegistrant = normalizeAddress(registrant);
  const requirementSnapshot = publicRequirement(version.structuredRequirement || {});
  const requirementHash = hashCanonical(version.structuredRequirement || {});
  const promptHash = hashText(version.apiPrompt || "");
  const metadata = {
    schemaVersion: METADATA_SCHEMA_VERSION,
    canonicalization: CANONICALIZATION,
    localDesignId: project.localDesignId,
    version: version.versionNumber,
    parentContentHash: version.parentContentHash || ZERO_HASH,
    registrant: normalizedRegistrant,
    productType: requirementSnapshot.productType,
    shape: requirementSnapshot.shape,
    style: requirementSnapshot.style,
    motifs: requirementSnapshot.motifs,
    surfaceEffects: requirementSnapshot.surfaceEffects,
    targetAudience: requirementSnapshot.targetAudience,
    usageScenario: requirementSnapshot.usageScenario,
    changeRequest: version.changeRequest || "",
    requirementHash,
    promptHash,
    imageHash: imageEvidence.imageHash,
    imageSha256: imageEvidence.imageSha256,
    imageSizeBytes: imageEvidence.imageSizeBytes,
    imageUri,
    modelProvider: version.modelProvider,
    modelName: version.modelName,
    reviewStatus: "customer-confirmed",
    generatedAt: version.createdAt,
    declarationType: "registrant-declaration",
    legalNotice: "链上记录证明内容指纹、提交地址与时间，不替代版权登记、原创性审查或法律认定。",
  };
  return {
    metadata,
    requirementHash,
    promptHash,
    imageHash: imageEvidence.imageHash,
    contentHash: hashCanonical(metadata),
  };
}
