import { timingSafeEqual } from "node:crypto";

const JSON_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 25 * 1024 * 1024;

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function workerError(message, { code = "WORKER_API_ERROR", httpStatus = 400, retryable = false, details = null } = {}) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  error.retryable = retryable;
  error.details = details;
  return error;
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw workerError(`请求内容超过 ${Math.round(limit / 1024 / 1024)} MB 限制`, { code: "PAYLOAD_TOO_LARGE", httpStatus: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const body = await readBody(request, JSON_LIMIT);
  if (!body.length) return {};
  try { return JSON.parse(body.toString("utf8")); }
  catch { throw workerError("请求 JSON 格式无效", { code: "INVALID_JSON" }); }
}

function bearerToken(request) {
  const value = String(request.headers.authorization || "");
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function requireWorkerAuth(request) {
  const expected = String(process.env.WORKER_TOKEN || "").trim();
  if (!expected) throw workerError("Master 尚未配置 WORKER_TOKEN", { code: "WORKER_TOKEN_NOT_CONFIGURED", httpStatus: 503 });
  if (!safeEqual(bearerToken(request), expected)) throw workerError("Image Worker 认证失败", { code: "WORKER_UNAUTHORIZED", httpStatus: 401 });
  const workerId = String(request.headers["x-worker-id"] || "").trim();
  if (!workerId) throw workerError("缺少 X-Worker-Id", { code: "WORKER_ID_REQUIRED" });
  return workerId;
}

function errorPayload(error) {
  return {
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: error.httpStatus ? error.message : "Worker API 发生未处理错误",
      retryable: Boolean(error.retryable),
      details: error.httpStatus ? error.details ?? null : null,
    },
  };
}

export function createWorkerApiRouter(taskBroker, { onTaskChanged } = {}) {
  return async function routeWorkerApi(request, response, url) {
    const method = request.method || "GET";
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/v1/workers")) return false;

    try {
      if (method === "GET" && pathname === "/api/v1/workers/status") {
        sendJson(response, 200, { data: await taskBroker.status() });
        return true;
      }

      const workerId = requireWorkerAuth(request);
      if (method === "POST" && pathname === "/api/v1/workers/register") {
        const body = await readJson(request);
        const worker = await taskBroker.registerWorker({ ...body, workerId, transport: body.transport || "http", source: request.socket.remoteAddress || "unknown" });
        sendJson(response, 200, { data: { worker, heartbeatIntervalMs: 30_000, leaseSeconds: taskBroker.leaseSeconds } });
        onTaskChanged?.(workerId);
        return true;
      }
      if (method === "POST" && pathname === "/api/v1/workers/heartbeat") {
        sendJson(response, 200, { data: await taskBroker.heartbeat(workerId, await readJson(request)) });
        return true;
      }
      if (method === "POST" && pathname === "/api/v1/workers/tasks/claim") {
        sendJson(response, 200, { data: { task: await taskBroker.claimTask(workerId) } });
        return true;
      }

      const renew = pathname.match(/^\/api\/v1\/workers\/tasks\/([^/]+)\/renew$/);
      if (method === "POST" && renew) {
        const body = await readJson(request);
        sendJson(response, 200, { data: await taskBroker.renewTask(decodeURIComponent(renew[1]), workerId, body.leaseId) });
        return true;
      }
      const progress = pathname.match(/^\/api\/v1\/workers\/tasks\/([^/]+)\/progress$/);
      if (method === "POST" && progress) {
        const body = await readJson(request);
        sendJson(response, 200, { data: await taskBroker.updateProgress(decodeURIComponent(progress[1]), workerId, body.leaseId, body) });
        return true;
      }
      const upload = pathname.match(/^\/api\/v1\/workers\/tasks\/([^/]+)\/upload$/);
      if (method === "PUT" && upload) {
        const leaseId = String(request.headers["x-lease-id"] || "").trim();
        const bytes = await readBody(request, IMAGE_LIMIT);
        const result = await taskBroker.storeUpload(decodeURIComponent(upload[1]), workerId, leaseId, bytes, {
          filename: decodeURIComponent(String(request.headers["x-file-name"] || "image.png")),
          mimeType: request.headers["content-type"] || "image/png",
          sha256: request.headers["x-content-sha256"] || "",
        });
        sendJson(response, 201, { data: result });
        return true;
      }
      const complete = pathname.match(/^\/api\/v1\/workers\/tasks\/([^/]+)\/complete$/);
      if (method === "POST" && complete) {
        const body = await readJson(request);
        const result = await taskBroker.completeTask(decodeURIComponent(complete[1]), workerId, body.leaseId, body);
        sendJson(response, 200, { data: result });
        onTaskChanged?.(workerId);
        return true;
      }
      const fail = pathname.match(/^\/api\/v1\/workers\/tasks\/([^/]+)\/fail$/);
      if (method === "POST" && fail) {
        const body = await readJson(request);
        const result = await taskBroker.failTask(decodeURIComponent(fail[1]), workerId, body.leaseId, body);
        sendJson(response, 200, { data: result });
        onTaskChanged?.();
        return true;
      }

      sendJson(response, 404, { error: { code: "WORKER_ROUTE_NOT_FOUND", message: "Worker 接口不存在", retryable: false } });
      return true;
    } catch (error) {
      sendJson(response, error.httpStatus || 500, errorPayload(error));
      return true;
    }
  };
}
