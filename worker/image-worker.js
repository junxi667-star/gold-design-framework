import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../backend/env-loader.js";
import { ArkImageProvider } from "../backend/ark-image-provider.js";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnvFile(rootDir);

const workerId = String(process.env.WORKER_ID || `${os.hostname().toLowerCase()}-image-01`).trim();
const workerVersion = "0.8.0";
const token = String(process.env.WORKER_TOKEN || "").trim();
const masterBaseUrl = String(process.env.MASTER_BASE_URL || "http://127.0.0.1:4173").replace(/\/+$/, "");
const pollIntervalMs = Math.max(1500, Number(process.env.WORKER_POLL_INTERVAL_MS || 5000));
const maxConcurrency = Math.max(1, Number(process.env.WORKER_MAX_CONCURRENCY || 1));
const generatedDir = path.resolve(rootDir, process.env.IMAGE_WORKER_GENERATED_DIR || "worker-generated");
const provider = new ArkImageProvider({ generatedDir });

if (!token) {
  console.error("ERROR: .env 中缺少 WORKER_TOKEN");
  process.exit(1);
}

const workerHeaders = {
  Authorization: `Bearer ${token}`,
  "X-Worker-Id": workerId,
};

let websocket = null;
let busy = false;
let stopped = false;
let wsConnected = false;
let heartbeatTimer = null;
let pollTimer = null;

function log(message) {
  console.log(`[${new Date().toLocaleString()}] ${message}`);
}

function wsUrl() {
  const url = new URL(masterBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/worker";
  url.search = "";
  return url.toString();
}

async function api(pathname, { method = "POST", body, headers = {}, rawBody } = {}) {
  const response = await fetch(`${masterBaseUrl}${pathname}`, {
    method,
    headers: {
      ...workerHeaders,
      ...(rawBody ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch { payload = { error: { message: text || `HTTP ${response.status}` } }; }
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Master API 请求失败（HTTP ${response.status}）`);
    error.code = payload?.error?.code;
    error.retryable = payload?.error?.retryable;
    throw error;
  }
  return payload?.data ?? payload;
}

async function registerHttp() {
  return api("/api/v1/workers/register", {
    body: {
      workerVersion,
      capabilities: ["seedream", "jewelry-v1-v2"],
      maxConcurrency,
      transport: wsConnected ? "websocket" : "http",
    },
  });
}

async function heartbeat() {
  const memoryUsageMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  if (wsConnected && websocket?.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({
      type: "worker.heartbeat",
      workerId,
      runningTasks: busy ? 1 : 0,
      available: !busy,
      memoryUsageMb,
    }));
    return;
  }
  await api("/api/v1/workers/heartbeat", {
    body: { runningTasks: busy ? 1 : 0, available: !busy, memoryUsageMb, transport: "http" },
  });
}

async function progress(task, value, message) {
  await api(`/api/v1/workers/tasks/${encodeURIComponent(task.id)}/progress`, {
    body: { leaseId: task.leaseId, progress: value, message },
  });
}

async function renew(task) {
  await api(`/api/v1/workers/tasks/${encodeURIComponent(task.id)}/renew`, {
    body: { leaseId: task.leaseId },
  });
}

async function uploadImage(task, generated) {
  const bytes = await readFile(generated.filePath);
  const sha256 = generated.sha256 || createHash("sha256").update(bytes).digest("hex");
  return api(`/api/v1/workers/tasks/${encodeURIComponent(task.id)}/upload`, {
    method: "PUT",
    rawBody: bytes,
    headers: {
      "Content-Type": generated.mimeType || "image/png",
      "X-Lease-Id": task.leaseId,
      "X-File-Name": encodeURIComponent(generated.filename || "image.png"),
      "X-Content-Sha256": sha256,
    },
  });
}

async function executeTask(task) {
  if (busy || !task) return;
  busy = true;
  log(`领取任务 ${task.id}：${task.type}`);
  const renewTimer = setInterval(() => renew(task).catch((error) => log(`续租失败：${error.message}`)), 35_000);
  renewTimer.unref?.();
  try {
    if (task.type !== "generate-image") throw Object.assign(new Error(`不支持任务类型：${task.type}`), { code: "UNSUPPORTED_TASK_TYPE" });
    await progress(task, 20, "Image Worker 正在调用 Seedream");
    const generated = await provider.generate({
      prompt: task.payload?.prompt,
      filenamePrefix: task.payload?.filenamePrefix || `task_${task.id}`,
    });
    await progress(task, 80, "图片生成完成，正在上传 Master");
    const upload = await uploadImage(task, generated);
    await progress(task, 94, "图片已上传，正在提交任务结果");
    await api(`/api/v1/workers/tasks/${encodeURIComponent(task.id)}/complete`, {
      body: {
        leaseId: task.leaseId,
        uploadId: upload.id,
        requestId: generated.requestId,
        modelProvider: generated.modelProvider,
        modelName: generated.modelName,
        imageSize: generated.imageSize,
      },
    });
    log(`任务 ${task.id} 完成`);
  } catch (error) {
    log(`任务 ${task.id} 失败：${error.message}`);
    try {
      await api(`/api/v1/workers/tasks/${encodeURIComponent(task.id)}/fail`, {
        body: {
          leaseId: task.leaseId,
          errorCode: error.code || "WORKER_EXECUTION_FAILED",
          errorMessage: error.message,
          retryable: Boolean(error.retryable),
        },
      });
    } catch (reportError) {
      log(`回传失败状态失败：${reportError.message}`);
    }
  } finally {
    clearInterval(renewTimer);
    busy = false;
    if (wsConnected && websocket?.readyState === WebSocket.OPEN) websocket.send(JSON.stringify({ type: "worker.ready" }));
  }
}

async function pollOnce() {
  if (busy || wsConnected) return;
  try {
    await registerHttp();
    const result = await api("/api/v1/workers/tasks/claim", { body: {} });
    if (result.task) await executeTask(result.task);
  } catch (error) {
    log(`HTTP 兜底轮询失败：${error.message}`);
  }
}

function connectWebSocket() {
  if (stopped) return;
  if (typeof WebSocket !== "function") {
    log("当前 Node 不支持 WebSocket，自动使用 HTTP 轮询兜底");
    return;
  }
  log(`连接 Master：${wsUrl()}`);
  const ws = new WebSocket(wsUrl());
  websocket = ws;
  ws.addEventListener("open", () => {
    wsConnected = true;
    log("WebSocket 已连接");
    ws.send(JSON.stringify({
      type: "worker.register",
      token,
      workerId,
      workerVersion,
      capabilities: ["seedream", "jewelry-v1-v2"],
      maxConcurrency,
    }));
  });
  ws.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data || "{}"));
      if (message.type === "worker.registered") log(`Worker 注册成功，租约 ${message.leaseSeconds}s`);
      if (message.type === "task.assigned") executeTask(message.task).catch((error) => log(error.message));
      if (message.type === "server.error") log(`Master 消息：${message.code} ${message.message}`);
    } catch (error) {
      log(`无法解析 WebSocket 消息：${error.message}`);
    }
  });
  ws.addEventListener("close", () => {
    wsConnected = false;
    websocket = null;
    if (stopped) log("WebSocket 已关闭");
    else {
      log("WebSocket 已断开，启用 HTTP 轮询；5 秒后尝试重连");
      setTimeout(connectWebSocket, 5000).unref?.();
    }
  });
  ws.addEventListener("error", () => {});
}

async function main() {
  log(`JewelChain Image Worker v${workerVersion}`);
  log(`Worker ID：${workerId}`);
  log(`Master：${masterBaseUrl}`);
  const status = provider.status();
  log(`图片模型：${status.configured ? `${status.model} 已配置` : "未配置"}`);
  if (!status.configured) throw new Error("火山方舟 API 未配置，检查 .env 中的 ARK_API_KEY");
  await registerHttp();
  connectWebSocket();
  heartbeatTimer = setInterval(() => heartbeat().catch((error) => log(`心跳失败：${error.message}`)), 30_000);
  heartbeatTimer.unref?.();
  pollTimer = setInterval(() => pollOnce().catch(() => {}), pollIntervalMs);
  pollTimer.unref?.();
  await pollOnce();
}

function shutdown() {
  stopped = true;
  clearInterval(heartbeatTimer);
  clearInterval(pollTimer);
  try { websocket?.close(); } catch {}
  log("Image Worker 已停止");
  setTimeout(() => process.exit(0), 100).unref?.();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
