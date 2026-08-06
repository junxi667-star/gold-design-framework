import assert from "node:assert/strict";
import test from "node:test";

import { createAppError, PAYLOAD_TOO_LARGE, PROJECT_NOT_FOUND, ARK_NOT_CONFIGURED, GENERATION_FAILED, INTERNAL_ERROR } from "../backend/error-codes.js";

test("createAppError uses registered defaults for httpStatus and retryable", () => {
  const error = createAppError(PAYLOAD_TOO_LARGE);
  assert.equal(error.code, "PAYLOAD_TOO_LARGE");
  assert.equal(error.httpStatus, 413);
  assert.equal(error.retryable, false);
  assert.equal(error.message, "请求内容过大");
  assert.equal(error.details, null);
});

test("createAppError allows custom message while keeping registered metadata", () => {
  const error = createAppError(PROJECT_NOT_FOUND, { message: "自定义消息" });
  assert.equal(error.code, "PROJECT_NOT_FOUND");
  assert.equal(error.httpStatus, 404);
  assert.equal(error.retryable, false);
  assert.equal(error.message, "自定义消息");
});

test("createAppError allows httpStatus override", () => {
  const error = createAppError(ARK_NOT_CONFIGURED, { httpStatus: 500 });
  assert.equal(error.code, "ARK_NOT_CONFIGURED");
  assert.equal(error.httpStatus, 500);
  assert.equal(error.retryable, false);
});

test("createAppError handles unknown codes gracefully", () => {
  const error = createAppError("UNKNOWN_CODE");
  assert.equal(error.code, "UNKNOWN_CODE");
  assert.equal(error.httpStatus, 500);
  assert.equal(error.retryable, false);
  assert.equal(error.message, "未知错误");
});

test("createAppError preserves details", () => {
  const error = createAppError(PROJECT_NOT_FOUND, { details: { id: "abc" } });
  assert.deepEqual(error.details, { id: "abc" });
});

test("every exported code resolves to a registry entry", () => {
  for (const code of [GENERATION_FAILED, INTERNAL_ERROR]) {
    const error = createAppError(code);
    assert.equal(error.code, code);
    assert.ok(error.httpStatus >= 400 && error.httpStatus <= 599);
    assert.ok(error.message.length > 0);
  }
  assert.equal(createAppError(GENERATION_FAILED).httpStatus, 502);
  assert.equal(createAppError(GENERATION_FAILED).retryable, true);
  assert.equal(createAppError(INTERNAL_ERROR).httpStatus, 500);
});
