import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Interface, ZeroHash } from "ethers";

import {
  MONAD_TESTNET_PUBLIC_EVIDENCE,
  MonadTestnetReadService,
} from "../backend/monad-testnet-read-service.js";
import { createAppServer } from "../server.js";

const artifact = JSON.parse(
  await readFile(
    new URL("../contracts/artifacts/DesignRegistry.json", import.meta.url),
    "utf8",
  ),
);
const contractInterface = new Interface(artifact.abi);
const expected = MONAD_TESTNET_PUBLIC_EVIDENCE;
const v1Uri =
  "https://example.invalid/jewelchain-monad-testnet/1785313075234-a4d119f2-7eb2-4e5e-b723-08e4dcfeb567/v1.json";
const v2Uri =
  "https://example.invalid/jewelchain-monad-testnet/1785313075234-a4d119f2-7eb2-4e5e-b723-08e4dcfeb567/v2.json";

function record({
  contentHash,
  parentContentHash,
  metadataUri,
  versionNumber,
  finalized,
  registeredAt,
}) {
  return {
    contentHash,
    parentContentHash,
    metadataUri,
    registeredBy: expected.accountAddress,
    registeredAt: BigInt(registeredAt),
    versionNumber: BigInt(versionNumber),
    exists: true,
    finalized,
  };
}

function encodedLog(eventName, values) {
  const event = contractInterface.getEvent(eventName);
  const encoded = contractInterface.encodeEventLog(event, values);
  return {
    address: expected.contractAddress,
    topics: encoded.topics,
    data: encoded.data,
  };
}

function liveFixture() {
  const v1 = record({
    contentHash: expected.v1ContentHash,
    parentContentHash: ZeroHash,
    metadataUri: v1Uri,
    versionNumber: 1,
    finalized: false,
    registeredAt: 1785313100,
  });
  const v2 = record({
    contentHash: expected.v2ContentHash,
    parentContentHash: expected.v1ContentHash,
    metadataUri: v2Uri,
    versionNumber: 2,
    finalized: true,
    registeredAt: 1785313110,
  });
  const eventLogs = [
    [],
    [encodedLog("VersionRegistered", [
      expected.designId,
      expected.v1ContentHash,
      ZeroHash,
      1n,
      expected.accountAddress,
      v1Uri,
    ])],
    [encodedLog("VersionRegistered", [
      expected.designId,
      expected.v2ContentHash,
      expected.v1ContentHash,
      2n,
      expected.accountAddress,
      v2Uri,
    ])],
    [encodedLog("VersionFinalized", [
      expected.designId,
      expected.v2ContentHash,
      2n,
      expected.accountAddress,
    ])],
  ];
  const receipts = new Map();
  const transactions = new Map();
  expected.transactions.forEach((item, index) => {
    receipts.set(item.transactionHash.toLowerCase(), {
      hash: item.transactionHash,
      status: 1,
      blockNumber: item.blockNumber,
      gasUsed: BigInt(item.gasUsed),
      logs: eventLogs[index],
    });
    transactions.set(item.transactionHash.toLowerCase(), {
      hash: item.transactionHash,
      value: 0n,
      from: expected.accountAddress,
      to: item.kind === "DEPLOYMENT" ? null : expected.contractAddress,
    });
  });
  const provider = {
    send: async (method) => {
      assert.equal(method, "eth_chainId");
      return "0x279f";
    },
    getBlockNumber: async () => 49060000,
    getBlock: async () => ({ timestamp: 1785313200 }),
    getCode: async () => artifact.deployedBytecode,
    getTransactionReceipt: async (hash) => receipts.get(hash.toLowerCase()) || null,
    getTransaction: async (hash) => transactions.get(hash.toLowerCase()) || null,
  };
  const contract = {
    getVersion: async (_designId, contentHash) =>
      contentHash.toLowerCase() === expected.v1ContentHash ? v1 : v2,
    getFinal: async () => v2,
    getLatest: async () => v2,
    finalContentHash: async () => expected.v2ContentHash,
    versionCount: async () => 2n,
  };
  return { provider, contract };
}

function cachedFiles() {
  return {
    run: {
      network: { chainId: expected.chainId },
      deployment: { contractAddress: expected.contractAddress },
      syntheticTestVector: {
        designId: expected.designId,
        v1: {
          contentHash: expected.v1ContentHash,
          parentContentHash: ZeroHash,
          metadataUri: v1Uri,
        },
        v2: {
          contentHash: expected.v2ContentHash,
          parentContentHash: expected.v1ContentHash,
          metadataUri: v2Uri,
        },
      },
      readback: {
        finalContentHash: expected.v2ContentHash,
        finalized: true,
      },
      completedAt: "2026-07-29T08:18:07.620Z",
    },
    verification: {
      verified: true,
      verifiedAtBlock: 49054219,
      verifiedAt: "2026-07-29T08:21:47.034Z",
      transactionReceipts: expected.transactions.map((item) => ({
        hash: item.transactionHash,
        blockNumber: item.blockNumber,
        status: 1,
      })),
      decodedEvents: [
        "VersionRegistered",
        "VersionRegistered",
        "VersionFinalized",
      ],
      parentRelationshipVerified: true,
      finalVersionVerified: true,
    },
  };
}

test("live evidence requires and returns the complete verified public chain state", async () => {
  const { provider, contract } = liveFixture();
  const service = new MonadTestnetReadService({
    provider,
    artifactLoader: async () => artifact,
    cacheLoader: async () => cachedFiles(),
    contractFactory: () => contract,
    now: () => new Date("2026-07-29T09:00:00.000Z"),
    timeoutMs: 100,
  });
  const result = await service.getEvidence();

  assert.equal(result.schemaVersion, "monad-testnet-public-evidence/v1");
  assert.equal(result.mode, "monad-testnet-readonly");
  assert.equal(result.evidenceStatus, "live");
  assert.equal(result.source, "live-public-rpc");
  assert.equal(result.stale, false);
  assert.equal(result.network.chainId, 10143);
  assert.equal(result.contract.codeStatus, "PRESENT");
  assert.equal(result.contract.codeSizeBytes, 3507);
  assert.equal(result.transactions.length, 4);
  assert.deepEqual(result.transactions.map((item) => item.valueWei), ["0", "0", "0", "0"]);
  assert.deepEqual(result.transactions.map((item) => item.logCount), [0, 1, 1, 1]);
  assert.equal(result.versions[0].label, "V1");
  assert.equal(result.versions[1].parentLabel, "V1");
  assert.equal(result.final.contentHash, expected.v2ContentHash);
  assert.equal(result.latest.contentHash, expected.v2ContentHash);
  assert.equal(result.versionCount, 2);
  assert.deepEqual(result.checks.eventCounts, {
    VersionRegistered: 2,
    VersionFinalized: 1,
  });
  assert.equal(result.checks.allChecksPass, true);
  assert.equal(result.error, null);
});

test("RPC outage may use only independently verified cached public evidence", async () => {
  const service = new MonadTestnetReadService({
    provider: {
      send: async () => {
        throw new Error("offline");
      },
    },
    cacheLoader: async () => cachedFiles(),
    now: () => new Date("2026-07-29T09:10:00.000Z"),
    timeoutMs: 100,
  });
  const result = await service.getEvidence();

  assert.equal(result.evidenceStatus, "cached");
  assert.equal(result.source, "cached-public-evidence");
  assert.equal(result.stale, true);
  assert.equal(result.lastSuccessfulAt, "2026-07-29T08:21:47.034Z");
  assert.equal(result.transactions.length, 4);
  assert.equal(result.versions[0].registeredAt, null);
  assert.equal(result.checks.allChecksPass, true);
});

test("a live chain conflict never falls back to cached evidence", async () => {
  const service = new MonadTestnetReadService({
    provider: { send: async () => "0x1" },
    cacheLoader: async () => cachedFiles(),
    timeoutMs: 100,
  });
  await assert.rejects(service.getEvidence(), {
    code: "MONAD_TESTNET_EVIDENCE_CONFLICT",
    httpStatus: 502,
  });
});

test("RPC outage without verified cache fails closed", async () => {
  const service = new MonadTestnetReadService({
    provider: {
      send: async () => {
        throw new Error("offline");
      },
    },
    cacheLoader: async () => ({ run: null, verification: null }),
    timeoutMs: 100,
  });
  await assert.rejects(service.getEvidence(), {
    code: "MONAD_TESTNET_EVIDENCE_UNAVAILABLE",
    httpStatus: 503,
  });
});

function offlineAiProvider() {
  return {
    healthCheck: async () => ({
      provider: "test-offline",
      configured: false,
      reachable: false,
      error: null,
    }),
  };
}

async function startApi(context, service) {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "gold-monad-read-api-"));
  const server = createAppServer({
    statePath: path.join(temporaryDirectory, "state.json"),
    provider: offlineAiProvider(),
    web3Service: {
      getConfig: async () => ({
        mode: "local-development",
        chainId: 31337,
        connected: false,
      }),
    },
    monadTestnetReadService: service,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(temporaryDirectory, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("HTTP contract exposes one GET-only parameterless evidence endpoint", async (context) => {
  let calls = 0;
  const payload = {
    schemaVersion: expected.schemaVersion,
    mode: "monad-testnet-readonly",
    evidenceStatus: "live",
    source: "live-public-rpc",
  };
  const baseUrl = await startApi(context, {
    getEvidence: async () => {
      calls += 1;
      return payload;
    },
  });

  const response = await fetch(`${baseUrl}/api/web3/monad-testnet/evidence`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.data, payload);
  assert.equal(calls, 1);

  const parameterResponse = await fetch(
    `${baseUrl}/api/web3/monad-testnet/evidence?network=mainnet`,
  );
  const parameterBody = await parameterResponse.json();
  assert.equal(parameterResponse.status, 400);
  assert.equal(parameterBody.error.code, "MONAD_TESTNET_EVIDENCE_PARAMS_REJECTED");
  assert.equal(calls, 1);

  const postResponse = await fetch(`${baseUrl}/api/web3/monad-testnet/evidence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(postResponse.status, 404);
  assert.equal(calls, 1);
});

test("HTTP conflict uses a non-2xx error body and never returns success data", async (context) => {
  const conflict = new Error("public evidence conflict");
  conflict.code = "MONAD_TESTNET_EVIDENCE_CONFLICT";
  conflict.httpStatus = 502;
  conflict.retryable = false;
  const baseUrl = await startApi(context, {
    getEvidence: async () => {
      throw conflict;
    },
  });

  const response = await fetch(`${baseUrl}/api/web3/monad-testnet/evidence`);
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.data, undefined);
  assert.equal(body.error.code, "MONAD_TESTNET_EVIDENCE_CONFLICT");
  assert.equal(body.error.retryable, false);
});
