import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { JewelChainStore } from "../backend/jewelchain-store.js";
import { TaskBroker } from "../backend/task-broker.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlV8AAAAASUVORK5CYII=", "base64");

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
      workerVersion: "1.0.0",
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
    const upload = await broker.storeUpload(task.id, "test-worker", task.leaseId, PNG, {
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
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.imageUrl.startsWith("/generated/"), true);
    const status = await broker.status();
    assert.equal(status.tasks.completed, 1);
  } finally {
    broker.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("Worker upload rejects non-image bytes before they reach the public generated directory", async () => {
  const { root, broker } = await fixture();
  try {
    await broker.registerWorker({ workerId: "test-worker", capabilities: ["seedream"] });
    await broker.enqueueGeneration({ jobId: "job-invalid-upload", versionId: "version-invalid-upload", projectId: "project-invalid-upload", prompt: "gold ring" });
    const task = await broker.claimTask("test-worker");

    await assert.rejects(
      broker.storeUpload(task.id, "test-worker", task.leaseId, Buffer.from("not-an-image"), {
        filename: "payload.js",
        mimeType: "text/javascript",
      }),
      { code: "WORKER_UPLOAD_UNSUPPORTED_IMAGE", httpStatus: 415 },
    );
  } finally {
    broker.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("Worker upload rejects a forged image Content-Type", async () => {
  const { root, broker } = await fixture();
  try {    await broker.registerWorker({ workerId: "test-worker", capabilities: ["seedream"] });
    await broker.enqueueGeneration({ jobId: "job-mime-mismatch", versionId: "version-mime-mismatch", projectId: "project-mime-mismatch", prompt: "gold ring" });
    const task = await broker.claimTask("test-worker");

    await assert.rejects(
      broker.storeUpload(task.id, "test-worker", task.leaseId, PNG, {
        filename: "result.png",
        mimeType: "image/webp",
      }),
      { code: "WORKER_UPLOAD_MIME_MISMATCH", httpStatus: 415 },
    );
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

test("retryable fail from a busy worker returns the task to the queue", async () => {
  const { root, broker } = await fixture();
  try {
    await broker.registerWorker({ workerId: "busy-worker", capabilities: ["seedream"] });
    await broker.enqueueGeneration({ jobId: "job-busy", versionId: "v-busy", projectId: "p-busy", prompt: "ring" });
    const claimed = await broker.claimTask("busy-worker");
    const requeued = await broker.failTask(claimed.id, "busy-worker", claimed.leaseId, {
      errorCode: "WORKER_BUSY",
      errorMessage: "生图端正在执行其他任务，任务已重新排队",
      retryable: true,
    });
    assert.equal(requeued.status, "pending");
    assert.equal(requeued.workerId, null);
    const reclaimed = await broker.claimTask("busy-worker");
    assert.equal(reclaimed.id, claimed.id);
    assert.equal(reclaimed.attempts, 2);
  } finally {
    broker.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("single-task worker does not receive a second task while one is active", async () => {
  const { root, broker } = await fixture();
  try {
    await broker.registerWorker({ workerId: "single-worker", capabilities: ["seedream"], maxConcurrency: 1 });
    await broker.enqueueGeneration({ jobId: "job-a", versionId: "v-a", projectId: "p-a", prompt: "ring a" });
    await broker.enqueueGeneration({ jobId: "job-b", versionId: "v-b", projectId: "p-b", prompt: "ring b" });
    const first = await broker.claimTask("single-worker");
    assert.equal(first.payload.prompt, "ring a");
    const second = await broker.claimTask("single-worker");
    assert.equal(second, null);
    const status = await broker.status();
    assert.equal(status.tasks.active, 1);
    assert.equal(status.tasks.pending, 1);
  } finally {
    broker.stop();
    await rm(root, { recursive: true, force: true });
  }
});
