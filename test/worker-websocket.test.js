import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { JewelChainStore } from "../backend/jewelchain-store.js";
import { TaskBroker } from "../backend/task-broker.js";
import { WorkerWebSocketHub } from "../backend/worker-websocket.js";

function waitMessage(ws, type, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting ${type}`)), timeoutMs);
    const handler = (event) => {
      const payload = JSON.parse(String(event.data));
      if (payload.type !== type) return;
      clearTimeout(timer);
      ws.removeEventListener("message", handler);
      resolve(payload);
    };
    ws.addEventListener("message", handler);
  });
}

test("WebSocket registers worker and pushes pending task", async (t) => {
  if (typeof WebSocket !== "function") return t.skip("WebSocket not available in this Node runtime");
  const oldToken = process.env.WORKER_TOKEN;
  process.env.WORKER_TOKEN = "test-worker-token-123456789";
  const root = await mkdtemp(path.join(os.tmpdir(), "jewelchain-ws-"));
  const store = new JewelChainStore(path.join(root, "state.json"));
  const broker = new TaskBroker({ store, generatedDir: path.join(root, "generated"), uploadDir: path.join(root, "uploads") });
  const server = http.createServer((request, response) => { response.writeHead(404); response.end(); });
  const hub = new WorkerWebSocketHub({ server, taskBroker: broker });
  broker.setNotifier((workerId) => hub.dispatchPending(workerId));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/worker`);
  try {
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    const registeredPromise = waitMessage(ws, "worker.registered");
    ws.send(JSON.stringify({
      type: "worker.register",
      token: process.env.WORKER_TOKEN,
      workerId: "ws-test-worker",
      workerVersion: "0.8.0",
      capabilities: ["seedream"],
      maxConcurrency: 1,
    }));
    await registeredPromise;
    const assignedPromise = waitMessage(ws, "task.assigned");
    await broker.enqueueGeneration({ jobId: "ws-job", versionId: "ws-version", projectId: "ws-project", prompt: "gold ring" });
    const assigned = await assignedPromise;
    assert.equal(assigned.task.payload.prompt, "gold ring");
    assert.equal(assigned.task.workerId, "ws-test-worker");
  } finally {
    ws.close();
    await new Promise((resolve) => server.close(resolve));
    broker.stop();
    await rm(root, { recursive: true, force: true });
    if (oldToken === undefined) delete process.env.WORKER_TOKEN;
    else process.env.WORKER_TOKEN = oldToken;
  }
});
