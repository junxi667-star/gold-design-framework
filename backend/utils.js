import { createHash, randomUUID } from "node:crypto";

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export function iso(value = Date.now()) {
  return new Date(value).toISOString();
}

export function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function list(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(text).filter(Boolean))];
  }
  return [...new Set(text(value).split(/[，,、;；\n]/).map(text).filter(Boolean))];
}

export function requireText(value, label) {
  const normalized = text(value);
  if (!normalized) {
    throw apiError(`${label}不能为空`, {
      code: "VALIDATION_FAILED",
      httpStatus: 400,
    });
  }
  return normalized;
}

export function apiError(message, {
  code = "VALIDATION_FAILED",
  httpStatus = 400,
  retryable = false,
  details = null,
} = {}) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  error.retryable = retryable;
  error.details = details;
  return error;
}

function sortForStableJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortForStableJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortForStableJson(value[key])]),
    );
  }
  return value;
}

export function fingerprint(value) {
  const canonical = JSON.stringify(sortForStableJson(value));
  return createHash("sha256").update(canonical).digest("hex");
}
