import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { keccak256 } from "ethers";

import {
  MONAD_TESTNET_DEPLOYMENT_MANIFEST,
  MONAD_TESTNET_PUBLIC_EVIDENCE,
} from "../backend/monad-testnet-read-service.js";
import { compileDesignRegistry } from "../scripts/web3-contract.js";

test("Monad deployment identity is frozen independently of local recompilation", async () => {
  const manifest = MONAD_TESTNET_DEPLOYMENT_MANIFEST;
  const expected = MONAD_TESTNET_PUBLIC_EVIDENCE;

  assert.equal(manifest.network.chainId, 10143);
  assert.equal(manifest.deployment.contractAddress, expected.contractAddress);
  assert.equal(
    manifest.deployment.transactionHash,
    expected.transactions[0].transactionHash,
  );
  assert.equal(
    manifest.deployment.runtimeCode.keccak256,
    "0x8eeea34a26d5880ddfb8d71fd90071768230be3e5e572ddf03cb975947e0809a",
  );
  assert.equal(
    manifest.deployment.runtimeCode.sha256,
    "0d93b66d10dec3414aaaebc85e245b1aff15b70f5a046c0df1277a3de5731b00",
  );

  const recompiled = await compileDesignRegistry();
  const recompiledBytes = Buffer.from(recompiled.deployedBytecode.slice(2), "hex");
  const recompiledKeccak256 = keccak256(recompiled.deployedBytecode);
  const recompiledSha256 = createHash("sha256").update(recompiledBytes).digest("hex");
  assert.match(recompiledKeccak256, /^0x[a-f0-9]{64}$/);
  assert.match(recompiledSha256, /^[a-f0-9]{64}$/);

  const driftedBytes = Buffer.from(recompiledBytes);
  driftedBytes[driftedBytes.length - 1] ^= 0x01;
  const driftedBytecode = `0x${driftedBytes.toString("hex")}`;
  assert.notEqual(keccak256(driftedBytecode), expected.deployedCodeKeccak256);
  assert.notEqual(
    createHash("sha256").update(driftedBytes).digest("hex"),
    expected.deployedCodeSha256,
  );
  assert.equal(
    MONAD_TESTNET_PUBLIC_EVIDENCE.deployedCodeKeccak256,
    manifest.deployment.runtimeCode.keccak256,
  );
  assert.equal(
    MONAD_TESTNET_PUBLIC_EVIDENCE.deployedCodeSha256,
    manifest.deployment.runtimeCode.sha256,
  );
});
