import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GoldAiService } from "./backend/ai-service.js";
import { createApiRouter } from "./backend/api-router.js";
import { LocalComfyUiProvider } from "./backend/local-comfyui-provider.js";
import { JsonStateStore } from "./backend/state-store.js";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const defaultGeneratedDir = path.join(rootDir, "generated");
const defaultWorkflowPath = path.join(
  rootDir,
  "backend",
  "workflows",
  "sdxl_base_refiner_gold_v1_api.json",
);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

function resolveContainedPath(baseDir, requested) {
  const resolved = path.resolve(baseDir, requested);
  if (resolved !== baseDir && !resolved.startsWith(`${baseDir}${path.sep}`)) return null;
  return resolved;
}

function resolvePublicPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  return resolveContainedPath(publicDir, requested);
}

function resolveGeneratedPath(requestUrl, generatedDir) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  if (!pathname.startsWith("/generated/")) return null;
  return resolveContainedPath(generatedDir, pathname.slice("/generated/".length));
}

function normalizedHostname(hostname) {
  return String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
}

function validateRequestAuthority(request) {
  const rawHost = String(request.headers.host || "");
  if (!rawHost || /[\s,]/.test(rawHost)) {
    return { ok: false, code: "INVALID_HOST", message: "请求 Host 无效" };
  }
  let hostUrl;
  try {
    hostUrl = new URL(`http://${rawHost}`);
  } catch {
    return { ok: false, code: "INVALID_HOST", message: "请求 Host 无效" };
  }
  const hostname = normalizedHostname(hostUrl.hostname);
  const localPort = Number(request.socket.localPort);
  const requestPort = Number(hostUrl.port || 80);
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname) || requestPort !== localPort) {
    return {
      ok: false,
      code: "INVALID_HOST",
      message: "本地服务只接受当前回环地址和监听端口",
    };
  }

  const origin = String(request.headers.origin || "");
  if (origin) {
    let originUrl;
    try {
      originUrl = new URL(origin);
    } catch {
      return { ok: false, code: "CROSS_ORIGIN_REQUEST", message: "请求 Origin 无效" };
    }
    if (originUrl.protocol !== "http:" || originUrl.host.toLowerCase() !== hostUrl.host.toLowerCase()) {
      return {
        ok: false,
        code: "CROSS_ORIGIN_REQUEST",
        message: "本地服务拒绝跨源请求",
      };
    }
  }
  if (String(request.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site") {
    return {
      ok: false,
      code: "CROSS_ORIGIN_REQUEST",
      message: "本地服务拒绝跨站请求",
    };
  }
  return { ok: true };
}

function sendJsonError(response, statusCode, code, message) {
  const body = JSON.stringify({
    error: {
      code,
      message,
      retryable: false,
      details: null,
    },
  });
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function serveFile(request, response, filePath, {
  instanceToken = "",
  imageOnly = false,
} = {}) {
  try {
    await access(filePath);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    const extension = path.extname(filePath).toLowerCase();
    if (imageOnly && ![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
      response.writeHead(415, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Unsupported generated asset");
      return;
    }
    const headers = {
      "Content-Type": contentTypes.get(extension) ?? "application/octet-stream",
      "Content-Length": fileStat.size,
      "Cache-Control": imageOnly ? "private, max-age=3600" : "no-store",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    };
    if (instanceToken) headers["X-Gold-Demo-Instance"] = instanceToken;
    response.writeHead(200, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

export function createAppServer({
  instanceToken = process.env.GOLD_DEMO_INSTANCE_TOKEN || "",
  statePath = process.env.GOLD_AI_STATE_PATH || path.join(rootDir, "data", "ai-backend-state.json"),
  generatedDir = process.env.GOLD_AI_GENERATED_DIR || defaultGeneratedDir,
  workflowPath = process.env.COMFYUI_WORKFLOW_PATH || defaultWorkflowPath,
  comfyUiBaseUrl = process.env.COMFYUI_BASE_URL || "http://127.0.0.1:8188",
  now,
  provider,
  demoCompletionMs,
} = {}) {
  const store = new JsonStateStore(statePath);
  const comfyProvider = provider ?? new LocalComfyUiProvider({
    baseUrl: comfyUiBaseUrl,
    workflowPath,
    generatedDir,
  });
  const aiService = new GoldAiService(store, {
    provider: comfyProvider,
    ...(now ? { now } : {}),
    ...(demoCompletionMs !== undefined ? { demoCompletionMs } : {}),
  });
  const routeApi = createApiRouter(aiService);

  return http.createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(400);
      response.end("Invalid request");
      return;
    }
    const authority = validateRequestAuthority(request);
    if (!authority.ok) {
      sendJsonError(response, 403, authority.code, authority.message);
      return;
    }

    let requestUrl;
    try {
      requestUrl = new URL(request.url, "http://localhost");
    } catch {
      response.writeHead(400);
      response.end("Invalid request");
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      if (request.method === "POST") {
        const mediaType = String(request.headers["content-type"] || "")
          .split(";", 1)[0]
          .trim()
          .toLowerCase();
        if (mediaType !== "application/json") {
          sendJsonError(
            response,
            415,
            "UNSUPPORTED_MEDIA_TYPE",
            "写入接口只接受 application/json",
          );
          return;
        }
      }
      if (await routeApi(request, response, requestUrl)) return;
    }

    if (!["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }
    try {
      const generatedPath = resolveGeneratedPath(request.url, generatedDir);
      if (generatedPath) {
        await serveFile(request, response, generatedPath, { instanceToken, imageOnly: true });
        return;
      }
      const filePath = resolvePublicPath(request.url);
      if (!filePath) {
        response.writeHead(400);
        response.end("Invalid path");
        return;
      }
      await serveFile(request, response, filePath, { instanceToken });
    } catch {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Invalid path");
    }
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const port = Number(process.env.PORT || 4173);
  const server = createAppServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`黄金产业 AI 智能设计框架：http://127.0.0.1:${port}`);
    console.log("后端 API 已启用；ComfyUI 只有在实时健康检查通过时才显示为可用。");
  });
}
