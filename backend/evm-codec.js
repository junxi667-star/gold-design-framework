import { functionSelector, hexToBytes, keccak256, bytesToHex } from "./keccak.js";

export const ZERO_HASH = `0x${"0".repeat(64)}`;
export const REGISTER_VERSION_SIGNATURE = "registerVersion(bytes32,bytes32,bytes32,string)";
export const CONFIRM_VERSION_SIGNATURE = "confirmVersion(bytes32,bytes32)";
export const VERSION_REGISTERED_EVENT = "VersionRegistered(bytes32,bytes32,bytes32,uint64,address,string)";
export const VERSION_FINALIZED_EVENT = "VersionFinalized(bytes32,bytes32,uint64,address)";

export const REGISTER_VERSION_SELECTOR = functionSelector(REGISTER_VERSION_SIGNATURE);
export const CONFIRM_VERSION_SELECTOR = functionSelector(CONFIRM_VERSION_SIGNATURE);
export const VERSION_REGISTERED_TOPIC = keccak256(VERSION_REGISTERED_EVENT);
export const VERSION_FINALIZED_TOPIC = keccak256(VERSION_FINALIZED_EVENT);

function strip0x(value) {
  return String(value || "").replace(/^0x/i, "");
}

export function normalizeBytes32(value, label = "bytes32") {
  const hex = strip0x(value).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new TypeError(`${label} must be 32-byte hex`);
  return `0x${hex}`;
}

export function normalizeAddress(value, label = "address") {
  const hex = strip0x(value).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hex)) throw new TypeError(`${label} must be 20-byte hex`);
  return `0x${hex}`;
}

function wordFromHex(value) {
  return strip0x(value).padStart(64, "0");
}

function wordFromBigInt(value) {
  const number = BigInt(value);
  if (number < 0n) throw new TypeError("Negative ABI integers are not supported");
  return number.toString(16).padStart(64, "0");
}

function encodeStringTail(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  const lengthWord = wordFromBigInt(bytes.length);
  const dataHex = bytesToHex(bytes, false);
  const padded = dataHex.padEnd(Math.ceil(dataHex.length / 64) * 64 || 64, "0");
  return `${lengthWord}${padded}`;
}

export function encodeRegisterVersion({ designId, contentHash, parentContentHash, metadataUri }) {
  const selector = strip0x(REGISTER_VERSION_SELECTOR);
  const staticWords = [
    wordFromHex(normalizeBytes32(designId, "designId")),
    wordFromHex(normalizeBytes32(contentHash, "contentHash")),
    wordFromHex(normalizeBytes32(parentContentHash, "parentContentHash")),
    wordFromBigInt(4 * 32),
  ].join("");
  return `0x${selector}${staticWords}${encodeStringTail(metadataUri)}`;
}

export function encodeConfirmVersion({ designId, contentHash }) {
  return `0x${strip0x(CONFIRM_VERSION_SELECTOR)}${wordFromHex(normalizeBytes32(designId, "designId"))}${wordFromHex(normalizeBytes32(contentHash, "contentHash"))}`;
}

function readWord(dataHex, index) {
  const normalized = strip0x(dataHex);
  const start = index * 64;
  return normalized.slice(start, start + 64).padEnd(64, "0");
}

function readString(dataHex, offsetBytes) {
  const normalized = strip0x(dataHex);
  const base = Number(offsetBytes) * 2;
  const length = Number(BigInt(`0x${normalized.slice(base, base + 64) || "0"}`));
  const payload = normalized.slice(base + 64, base + 64 + length * 2);
  return new TextDecoder().decode(hexToBytes(payload || "00").slice(0, length));
}

function topicEquals(value, expected) {
  return String(value || "").toLowerCase() === expected.toLowerCase();
}

function logAddressMatches(log, contractAddress) {
  return normalizeAddress(log.address) === normalizeAddress(contractAddress);
}

export function parseRegistryReceipt(receipt, { contractAddress, expectedDesignId, expectedContentHash, expectedParentContentHash, kind = "register" }) {
  const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];
  if (kind === "finalize") {
    const log = logs.find((item) => (
      logAddressMatches(item, contractAddress)
      && topicEquals(item.topics?.[0], VERSION_FINALIZED_TOPIC)
      && topicEquals(item.topics?.[1], expectedDesignId)
      && topicEquals(item.topics?.[2], expectedContentHash)
    ));
    if (!log) return null;
    const versionNumber = Number(BigInt(`0x${readWord(log.data, 0)}`));
    const finalizedBy = `0x${readWord(log.data, 1).slice(24)}`;
    return { event: "VersionFinalized", designId: normalizeBytes32(log.topics[1]), contentHash: normalizeBytes32(log.topics[2]), versionNumber, finalizedBy: normalizeAddress(finalizedBy) };
  }

  const log = logs.find((item) => (
    logAddressMatches(item, contractAddress)
    && topicEquals(item.topics?.[0], VERSION_REGISTERED_TOPIC)
    && topicEquals(item.topics?.[1], expectedDesignId)
    && topicEquals(item.topics?.[2], expectedContentHash)
    && topicEquals(item.topics?.[3], expectedParentContentHash)
  ));
  if (!log) return null;
  const versionNumber = Number(BigInt(`0x${readWord(log.data, 0)}`));
  const registeredBy = `0x${readWord(log.data, 1).slice(24)}`;
  const metadataOffset = Number(BigInt(`0x${readWord(log.data, 2)}`));
  const metadataUri = readString(log.data, metadataOffset);
  return {
    event: "VersionRegistered",
    designId: normalizeBytes32(log.topics[1]),
    contentHash: normalizeBytes32(log.topics[2]),
    parentContentHash: normalizeBytes32(log.topics[3]),
    versionNumber,
    registeredBy: normalizeAddress(registeredBy),
    metadataUri,
  };
}
