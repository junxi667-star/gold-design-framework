// backend/version-states.js — 版本状态机集中定义
import { createAppError, INVALID_VERSION_STATE } from "./error-codes.js";

export const VERSION_STATES = Object.freeze([
  "generating",
  "generation_failed",
  "awaiting_confirmation",
  "awaiting_wallet_signature",
  "tx_submitted",
  "registration_failed",
  "chain_confirmed",
  "finalized",
]);

// 允许准备上链的状态（prepareRegistration）
export const REGISTRATION_PREPARE_STATES = Object.freeze([
  "awaiting_confirmation",
  "awaiting_wallet_signature",
  "registration_failed",
]);

// 合法迁移表：from -> Set(to)
const TRANSITIONS = Object.freeze({
  generating: new Set(["awaiting_confirmation", "generation_failed"]),
  generation_failed: new Set(["awaiting_confirmation"]),
  awaiting_confirmation: new Set(["awaiting_wallet_signature"]),
  awaiting_wallet_signature: new Set(["awaiting_wallet_signature", "tx_submitted"]),
  tx_submitted: new Set(["chain_confirmed", "registration_failed"]),
  registration_failed: new Set(["awaiting_wallet_signature"]),
  chain_confirmed: new Set(["finalized", "chain_confirmed"]),
  finalized: new Set(["finalized"]),
});

export function isVersionState(value) {
  return VERSION_STATES.includes(value);
}

export function canTransitionVersion(from, to) {
  if (from === to) return true;
  if (!isVersionState(from) || !isVersionState(to)) return false;
  return TRANSITIONS[from].has(to);
}

export function assertVersionTransition(from, to) {
  if (canTransitionVersion(from, to)) return;
  throw createAppError(INVALID_VERSION_STATE, {
    message: `版本状态不能从 ${from} 变更为 ${to}`,
    details: { from, to },
  });
}
