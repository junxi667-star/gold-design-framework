import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { JewelChainStore } from "../backend/jewelchain-store.js";
import { TaskBroker } from "../backend/task-broker.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "jewelchain-worker-"));
  const store = new JewelChainStore(path.join(root, "state.json"));
  const broker = new TaskBroker({
    store,
    generatedDir: path.join(root, "generated"),
    uploadDir: path.join(root, "uploads"),
  });
  return { root, store, broker };
}

test("Master queue -> Worker claim -> upload -> complete", async () => {
  const { root, broker } = await fixture();
  try {
    await broker.registerWorker({
      workerId: "test-worker",
      workerVersion: "0.8.0",
      capabilities: ["seedream"],
      maxConcurrency: 1,
    });
    const resultPromise = broker.enqueueAndWait({
      jobId: "job-1",
      versionId: "version-1",
      projectId: "project-1",
      prompt: "gold ring",
      filenamePrefix: "test",
      operation: "generate",
    }, { timeoutMs: 5000 });
    const task = await broker.claimTask("test-worker");
    assert.equal(task.type, "generate-image");
    assert.equal(task.payload.prompt, "gold ring");
    await broker.updateProgress(task.id, "test-worker", task.leaseId, { progress: 50, message: "generating" });
    const bytes = Buffer.from("fake-png-content");
    const upload = await broker.storeUpload(task.id, "test-worker", task.leaseId, bytes, {
      filename: "result.png",
      mimeType: "image/png",
    });
    await broker.completeTask(task.id, "test-worker", task.leaseId, {
      uploadId: upload.id,
      requestId: "request-1",
      modelProvider: "Mock Provider",
      modelName: "mock-model",
    });
    const result = await resultPromise;
    assert.equal(result.workerId, "test-worker");
    assert.equal(result.sha256, upload.sha256);
    assert.equal(result.imageUrl.startsWith("/generated/"), true);
    const status = await broker.status();
    assert.equal(status.tasks.completed, 1);
  } finally {
    broker.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("expired lease can be reclaimed", async () => {
  const { root, store, broker } = await fixture();
  try {
    await broker.registerWorker({ workerId: "worker-a", capabilities: ["seedream"] });
    await broker.registerWorker({ workerId: "worker-b", capabilities: ["seedream"] });
    await broker.enqueueGeneration({ jobId: "job-2", versionId: "v2", projectId: "p2", prompt: "ring" });
    const first = await broker.claimTask("worker-a");
    await store.update((state) => {
      const task = state.workerTasks.find((item) => item.id === first.id);
      task.leaseExpiresAt = new Date(Date.now() - 1000).toISOString();
      return null;
    });
    await broker.sweep();
    const second = await broker.claimTask("worker-b");
    assert.equal(second.id, first.id);
    assert.notEqual(second.leaseId, first.leaseId);
  } finally {
    broker.stop();
    await rm(root, { recursive: true, force: true });
  }
});
