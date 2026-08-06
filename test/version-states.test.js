import assert from "node:assert/strict";
import test from "node:test";

import {
  VERSION_STATES,
  canTransitionVersion,
  assertVersionTransition,
  isVersionState,
} from "../backend/version-states.js";

test("version state machine covers all 8 known states", () => {
  assert.deepEqual(VERSION_STATES, [
    "generating",
    "generation_failed",
    "awaiting_confirmation",
    "awaiting_wallet_signature",
    "tx_submitted",
    "registration_failed",
    "chain_confirmed",
    "finalized",
  ]);
});

test("generation lifecycle transitions are legal", () => {
  assert.equal(canTransitionVersion("generating", "awaiting_confirmation"), true);
  assert.equal(canTransitionVersion("generating", "generation_failed"), true);
  assert.equal(canTransitionVersion("generation_failed", "awaiting_confirmation"), true);
  assert.equal(canTransitionVersion("awaiting_confirmation", "awaiting_wallet_signature"), true);
  assert.equal(canTransitionVersion("awaiting_wallet_signature", "tx_submitted"), true);
  assert.equal(canTransitionVersion("tx_submitted", "chain_confirmed"), true);
  assert.equal(canTransitionVersion("tx_submitted", "registration_failed"), true);
  assert.equal(canTransitionVersion("registration_failed", "awaiting_wallet_signature"), true);
  assert.equal(canTransitionVersion("chain_confirmed", "finalized"), true);
});

test("illegal transitions are rejected", () => {
  assert.equal(canTransitionVersion("generating", "chain_confirmed"), false);
  assert.equal(canTransitionVersion("awaiting_confirmation", "tx_submitted"), false);
  assert.equal(canTransitionVersion("finalized", "chain_confirmed"), false);
  assert.equal(canTransitionVersion("tx_submitted", "awaiting_confirmation"), false);
  assert.equal(canTransitionVersion("chain_confirmed", "tx_submitted"), false);
});

test("same-state transition is allowed (idempotent re-entry)", () => {
  assert.equal(canTransitionVersion("generation_failed", "generation_failed"), true);
  assert.equal(canTransitionVersion("chain_confirmed", "chain_confirmed"), true);
});

test("assertVersionTransition throws INVALID_VERSION_STATE with details", () => {
  assert.throws(
    () => assertVersionTransition("generating", "finalized"),
    (error) => error.code === "INVALID_VERSION_STATE"
      && error.httpStatus === 409
      && error.details.from === "generating"
      && error.details.to === "finalized",
  );
});

test("isVersionState validates membership", () => {
  assert.equal(isVersionState("chain_confirmed"), true);
  assert.equal(isVersionState("generating"), true);
  assert.equal(isVersionState("unknown"), false);
  assert.equal(isVersionState(null), false);
});
