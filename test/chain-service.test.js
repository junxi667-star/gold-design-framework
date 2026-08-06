import assert from "node:assert/strict";
import test from "node:test";

import { MonadChainService } from "../backend/chain-service.js";

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test("chain RPC failure surfaces RPC_REQUEST_FAILED with provider details", async () => {
  const service = new MonadChainService({
    fetchImpl: async () => jsonResponse(500, { error: { code: -32000, message: "execution reverted" } }),
  });
  await assert.rejects(
    service.rpc("eth_chainId"),
    (error) => error.code === "RPC_REQUEST_FAILED" && error.httpStatus === 502 && error.retryable === true,
  );
});

test("chain RPC connection failure surfaces RPC_CONNECT_FAILED", async () => {
  const service = new MonadChainService({
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  await assert.rejects(
    service.rpc("eth_chainId"),
    (error) => error.code === "RPC_CONNECT_FAILED" && error.httpStatus === 502 && error.retryable === true,
  );
});

test("verifyTransaction rejects malformed txHash with INVALID_TX_HASH", async () => {
  const service = new MonadChainService({
    fetchImpl: async () => jsonResponse(200, { result: null }),
  });
  await assert.rejects(
    service.verifyTransaction({ txHash: "0x123", walletAddress: "0x1111111111111111111111111111111111111111", kind: "register", expected: {} }),
    (error) => error.code === "INVALID_TX_HASH" && error.httpStatus === 400,
  );
});
