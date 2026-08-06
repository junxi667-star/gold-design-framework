import { randomUUID } from "node:crypto";
import { createAppError, VALIDATION_FAILED } from "./error-codes.js";

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

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function requireText(value, label) {
  const normalized = text(value);
  if (!normalized) {
    throw createAppError(VALIDATION_FAILED, { message: `${label}不能为空` });
  }
  return normalized;
}
