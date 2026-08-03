import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { JewelChainAgent } from "../backend/agent-orchestrator.js";
import { JewelChainStore } from "../backend/jewelchain-store.js";
import { DesignStorageService } from "../backend/storage-service.js";
import { ZERO_HASH } from "../backend/evm-codec.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlV8AAAAASUVORK5CYII=", "base64");
const WALLET = "0x1111111111111111111111111111111111111111";

async function waitJob(agent, jobId) {
  for (let index = 0; index < 100; index += 1) {
    const job = await agent.getJob(jobId);
    if (["succeeded", "failed"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("job timeout");
}

class FakeImageProvider {
  constructor(dir) { this.dir = dir; this.counter = 0; }
  status() { return { configured: true, model: "fake-seedream" }; }
  async generate({ filenamePrefix }) {
    await mkdir(this.dir, { recursive: true });
    const filename = `${filenamePrefix}_${++this.counter}.png`;
    const filePath = path.join(this.dir, filename);
    await writeFile(filePath, PNG);
    return {
      requestId: `req-${this.counter}`,
      filename, filePath, imageUrl: `/generated/${filename}`,
      mimeType: "image/png", sizeBytes: PNG.length,
      sha256: createHash("sha256").update(PNG).digest("hex"),
      modelProvider: "Fake Ark", modelName: "fake-seedream",
    };
  }
}

class FakeChainService {
  constructor() {
    this.chainId = 10143;
    this.contractAddress = "0x2222222222222222222222222222222222222222";
    this.explorerUrl = "https://explorer.example";
    this.nextVersion = 1;
  }
  config() { return { chainId: 10143, chainIdHex: "0x279f", contractAddress: this.contractAddress, rpcUrls: [], blockExplorerUrls: [] }; }
  prepareRegister(input) { return { kind: "register", chain: this.config(), transaction: { to: this.contractAddress, value: "0x0", data: "0x1234" }, expected: input }; }
  prepareFinalize(input) { return { kind: "finalize", chain: this.config(), transaction: { to: this.contractAddress, value: "0x0", data: "0x5678" }, expected: input }; }
  async verifyTransaction({ txHash, kind, expected }) {
    if (kind === "finalize") return { status: "confirmed", txHash, blockNumber: 30, event: { event: "VersionFinalized", versionNumber: 2, ...expected }, explorerUrl: `${this.explorerUrl}/tx/${txHash}` };
    return { status: "confirmed", txHash, blockNumber: 10 + this.nextVersion, event: { event: "VersionRegistered", versionNumber: this.nextVersion++, registeredBy: WALLET, ...expected }, explorerUrl: `${this.explorerUrl}/tx/${txHash}` };
  }
}

test("Agent completes V1 -> Monad -> V2 -> finalize and answers evidence questions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jewel-agent-"));
  const generated = path.join(root, "generated");
  const metadata = path.join(root, "metadata");
  const store = new JewelChainStore(path.join(root, "state.json"));
  const storage = new DesignStorageService({ metadataDir: metadata });
  storage.mode = "local";
  const chain = new FakeChainService();
  const agent = new JewelChainAgent({ store, imageProvider: new FakeImageProvider(generated), storageService: storage, chainService: chain, generatedDir: generated });
  try {
    const created = await agent.createDesign({ customerText: "设计一款新中式黄金戒指，带简化祥云纹样" });
    assert.equal((await waitJob(agent, created.jobId)).status, "succeeded");
    const preparedV1 = await agent.prepareRegistration(created.versionId, { walletAddress: WALLET, baseUrl: "http://localhost:4173" });
    assert.equal(preparedV1.parentContentHash, ZERO_HASH);
    const tx1 = `0x${"1".repeat(64)}`;
    await agent.recordSubmission(created.versionId, { txHash: tx1, walletAddress: WALLET, kind: "register" });
    assert.equal((await agent.getChainStatus(created.versionId, "register")).status, "confirmed");

    const revision = await agent.reviseDesign(created.projectId, { parentVersionId: created.versionId, changeRequest: "保留戒圈和祥云，把表面改成磨砂质感" });
    assert.equal((await waitJob(agent, revision.jobId)).status, "succeeded");
    const preparedV2 = await agent.prepareRegistration(revision.versionId, { walletAddress: WALLET, baseUrl: "http://localhost:4173" });
    assert.equal(preparedV2.parentContentHash, preparedV1.contentHash);
    const tx2 = `0x${"2".repeat(64)}`;
    await agent.recordSubmission(revision.versionId, { txHash: tx2, walletAddress: WALLET, kind: "register" });
    assert.equal((await agent.getChainStatus(revision.versionId, "register")).status, "confirmed");

    await agent.prepareFinalize(revision.versionId, { walletAddress: WALLET });
    const tx3 = `0x${"3".repeat(64)}`;
    await agent.recordSubmission(revision.versionId, { txHash: tx3, walletAddress: WALLET, kind: "finalize" });
    assert.equal((await agent.getChainStatus(revision.versionId, "finalize")).status, "confirmed");

    const relation = await agent.answerQuestion(created.projectId, "V2 是否从 V1 修改而来？");
    assert.match(relation.answer, /是的/);
    const finalAnswer = await agent.answerQuestion(created.projectId, "最终确认版是哪一版？");
    assert.match(finalAnswer.answer, /V2/);
    const certificate = await agent.certificate(created.projectId);
    assert.equal(certificate.finalVersion.versionNumber, 2);
    assert.equal(certificate.monad.finalizationTxHash, tx3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
