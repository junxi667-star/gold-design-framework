import test from "node:test";
import assert from "node:assert/strict";
import { encodeConfirmVersion, encodeRegisterVersion, REGISTER_VERSION_SELECTOR, ZERO_HASH } from "../backend/evm-codec.js";

test("ABI encoder creates selectors and complete payloads", () => {
  const hash = `0x${"1".repeat(64)}`;
  const register = encodeRegisterVersion({ designId: hash, contentHash: hash, parentContentHash: ZERO_HASH, metadataUri: "https://example/meta.json" });
  assert.ok(register.startsWith(REGISTER_VERSION_SELECTOR));
  assert.ok(register.length > 10 + 64 * 4);
  const confirm = encodeConfirmVersion({ designId: hash, contentHash: hash });
  assert.equal(confirm.length, 2 + 8 + 64 * 2);
});
