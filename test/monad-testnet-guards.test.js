import assert from "node:assert/strict";
import test from "node:test";

import { Interface, Transaction, ZeroAddress } from "ethers";

import {
  MONAD_TESTNET_CHAIN_ID,
  MONAD_TESTNET_RPC_URL,
  MONAD_TESTNET_WALLET_INIT_ACK,
  MONAD_TESTNET_WRITE_ACK,
  assertMonadTestnetChainId,
  assertNoSecretEnvironment,
  assertOfficialRpcUrl,
  assertSafeTransactionRequest,
  assertWalletInitAuthorized,
  assertWriteExecutionAuthorized,
  parseAndAssertSerializedTransaction,
  prepareSafeContractCall,
  resolveSecretPaths,
} from "../scripts/monad-testnet-common.js";

const contractAddress = "0x0000000000000000000000000000000000001014";
const otherAddress = "0x0000000000000000000000000000000000009999";
const contractInterface = new Interface([
  "function confirmVersion(bytes32 designId, bytes32 contentHash)",
]);
const callData = contractInterface.encodeFunctionData("confirmVersion", [
  `0x${"11".repeat(32)}`,
  `0x${"22".repeat(32)}`,
]);

test("only the fixed official Monad Testnet RPC is accepted", () => {
  assert.equal(assertOfficialRpcUrl(`${MONAD_TESTNET_RPC_URL}/`), MONAD_TESTNET_RPC_URL);
  assert.throws(() => assertOfficialRpcUrl("https://rpc.monad.xyz"), {
    code: "MONAD_TESTNET_RPC_REJECTED",
  });
  assert.throws(() => assertOfficialRpcUrl("http://testnet-rpc.monad.xyz"), {
    code: "MONAD_TESTNET_RPC_REJECTED",
  });
  assert.throws(() => assertOfficialRpcUrl(`${MONAD_TESTNET_RPC_URL}?redirect=mainnet`), {
    code: "MONAD_TESTNET_RPC_REJECTED",
  });
});

test("chainId must be exactly 10143", () => {
  assert.equal(assertMonadTestnetChainId("0x279f"), MONAD_TESTNET_CHAIN_ID);
  assert.throws(() => assertMonadTestnetChainId(1), {
    code: "MONAD_TESTNET_CHAIN_ID_MISMATCH",
  });
  assert.throws(() => assertMonadTestnetChainId(31337), {
    code: "MONAD_TESTNET_CHAIN_ID_MISMATCH",
  });
});

test("wallet initialization requires its own acknowledgement", () => {
  assert.throws(() => assertWalletInitAuthorized({}), {
    code: "WALLET_INIT_NOT_AUTHORIZED",
  });
  assert.doesNotThrow(() =>
    assertWalletInitAuthorized({
      MONAD_TESTNET_WALLET_INIT_ACK,
    }));
});

test("writes require both CLI flag and exact separate acknowledgement", () => {
  assert.throws(() => assertWriteExecutionAuthorized({ argv: [], env: {} }), {
    code: "TESTNET_WRITE_FLAG_REQUIRED",
  });
  assert.throws(() =>
    assertWriteExecutionAuthorized({
      argv: ["--execute-testnet"],
      env: {},
    }), { code: "TESTNET_WRITE_ACK_REQUIRED" });
  assert.doesNotThrow(() =>
    assertWriteExecutionAuthorized({
      argv: ["--execute-testnet"],
      env: { MONAD_TESTNET_WRITE_ACK },
    }));
});

test("plaintext private-key and mnemonic environment variables fail closed", () => {
  assert.doesNotThrow(() => assertNoSecretEnvironment({}));
  assert.throws(() => assertNoSecretEnvironment({ PRIVATE_KEY: "do-not-use" }), {
    code: "PLAINTEXT_SECRET_ENV_REJECTED",
  });
  assert.throws(() => assertNoSecretEnvironment({ MNEMONIC: "do-not-use" }), {
    code: "PLAINTEXT_SECRET_ENV_REJECTED",
  });
});

test("secret directory must stay outside the repository", () => {
  const repositoryRoot = "D:\\黄金设计";
  assert.throws(() =>
    resolveSecretPaths({
      repositoryRoot,
      env: { GOLD_MONAD_TESTNET_SECRET_DIR: "D:\\黄金设计\\.secrets\\wallet" },
    }), { code: "SECRET_DIRECTORY_INSIDE_REPOSITORY" });
  const outside = resolveSecretPaths({
    repositoryRoot,
    env: { GOLD_MONAD_TESTNET_SECRET_DIR: "D:\\黄金设计-secrets\\monad-testnet" },
  });
  assert.equal(outside.directory, "D:\\黄金设计-secrets\\monad-testnet");
});

test("safe contract transaction fixes target, function, chain and zero value", () => {
  const transaction = {
    chainId: MONAD_TESTNET_CHAIN_ID,
    value: 0n,
    to: contractAddress,
    from: ZeroAddress,
    data: callData,
  };
  assert.equal(assertSafeTransactionRequest(transaction, {
    contractAddress,
    contractInterface,
    expectedFunction: "confirmVersion",
    expectedFrom: ZeroAddress,
  }), transaction);
  assert.throws(() =>
    assertSafeTransactionRequest({ ...transaction, value: 1n }, {
      contractAddress,
      contractInterface,
      expectedFunction: "confirmVersion",
    }), { code: "MONAD_TESTNET_NONZERO_VALUE_REJECTED" });
  assert.throws(() =>
    assertSafeTransactionRequest({ ...transaction, chainId: 1n }, {
      contractAddress,
      contractInterface,
      expectedFunction: "confirmVersion",
    }), { code: "MONAD_TESTNET_CHAIN_ID_MISMATCH" });
  assert.throws(() =>
    assertSafeTransactionRequest({ ...transaction, to: otherAddress }, {
      contractAddress,
      contractInterface,
      expectedFunction: "confirmVersion",
    }), { code: "CONTRACT_TARGET_MISMATCH" });
});

test("serialized transaction is parsed again before broadcast", () => {
  const transaction = Transaction.from({
    chainId: MONAD_TESTNET_CHAIN_ID,
    type: 2,
    nonce: 0,
    gasLimit: 100_000n,
    maxFeePerGas: 2n,
    maxPriorityFeePerGas: 1n,
    to: contractAddress,
    value: 0n,
    data: callData,
  });
  const parsed = parseAndAssertSerializedTransaction(transaction.unsignedSerialized, {
    requireSignature: false,
    contractAddress,
    contractInterface,
    expectedFunction: "confirmVersion",
  });
  assert.equal(parsed.chainId, MONAD_TESTNET_CHAIN_ID);
  assert.throws(() =>
    parseAndAssertSerializedTransaction(transaction.unsignedSerialized, {
      contractAddress,
      contractInterface,
      expectedFunction: "confirmVersion",
    }), { code: "SIGNED_TRANSACTION_REQUIRED" });
});

test("contract writes always static-call, estimate and populate before signing", async () => {
  const order = [];
  const method = {
    async staticCall() {
      order.push("staticCall");
      return undefined;
    },
    async estimateGas() {
      order.push("estimateGas");
      return 50_000n;
    },
    async populateTransaction() {
      order.push("populateTransaction");
      return { to: contractAddress, data: callData };
    },
  };
  const provider = {
    async getFeeData() {
      return { maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, gasPrice: null };
    },
  };
  const prepared = await prepareSafeContractCall({
    method,
    args: [],
    provider,
    from: ZeroAddress,
    contractAddress,
    contractInterface,
    expectedFunction: "confirmVersion",
  });
  assert.deepEqual(order, ["staticCall", "estimateGas", "populateTransaction"]);
  assert.equal(prepared.transaction.chainId, MONAD_TESTNET_CHAIN_ID);
  assert.equal(prepared.transaction.value, 0n);
});
