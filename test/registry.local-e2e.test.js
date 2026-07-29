import assert from "node:assert/strict";
import test from "node:test";

import { ContractFactory, JsonRpcProvider, id, keccak256, toUtf8Bytes, ZeroHash } from "ethers";
import ganache from "ganache";

import { compileDesignRegistry } from "../scripts/web3-contract.js";

test("真实本地 EVM 完成 V1 -> V2 -> finalize -> readback", async (context) => {
  const chainId = 31337;
  const server = ganache.server({
    chain: { chainId, networkId: chainId },
    logging: { quiet: true },
    wallet: { deterministic: true, totalAccounts: 2 },
  });
  await server.listen(0, "127.0.0.1");
  context.after(() => server.close());

  const address = server.address();
  const provider = new JsonRpcProvider(`http://127.0.0.1:${address.port}`);
  const network = await provider.getNetwork();
  assert.equal(network.chainId, 31337n);

  const signer = await provider.getSigner(0);
  const otherSigner = await provider.getSigner(1);
  const artifact = await compileDesignRegistry();
  const registry = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy();
  await registry.waitForDeployment();

  const designId = id("project-local-e2e");
  const v1Hash = keccak256(toUtf8Bytes('{"schemaVersion":"design-manifest/v1","versionId":"v1"}'));
  const v2Hash = keccak256(toUtf8Bytes('{"schemaVersion":"design-manifest/v1","versionId":"v2"}'));
  const invalidHash = keccak256(toUtf8Bytes("invalid-parent-version"));
  const unknownParent = keccak256(toUtf8Bytes("unknown-parent"));

  await (await registry.registerVersion(designId, v1Hash, ZeroHash, "local://manifest/v1")).wait();
  await assert.rejects(
    registry.registerVersion(designId, v1Hash, ZeroHash, "local://manifest/v1-duplicate"),
  );
  await assert.rejects(
    registry.registerVersion(designId, invalidHash, unknownParent, "local://manifest/invalid"),
  );
  await assert.rejects(
    registry.connect(otherSigner).registerVersion(
      designId,
      invalidHash,
      v1Hash,
      "local://manifest/unauthorized",
    ),
  );
  await (await registry.registerVersion(designId, v2Hash, v1Hash, "local://manifest/v2")).wait();
  await (await registry.confirmVersion(designId, v2Hash)).wait();

  const v2 = await registry.getVersion(designId, v2Hash);
  const latest = await registry.getLatest(designId);
  const final = await registry.getFinal(designId);

  assert.equal(v2.parentContentHash, v1Hash);
  assert.equal(v2.versionNumber, 2n);
  assert.equal(v2.finalized, true);
  assert.equal(latest.contentHash, v2Hash);
  assert.equal(final.contentHash, v2Hash);
  assert.equal(await registry.versionCount(designId), 2n);
  assert.equal(await registry.designOwner(designId), await signer.getAddress());
});
