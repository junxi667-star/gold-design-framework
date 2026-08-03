import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "./backend/env-loader.js";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(rootDir);

const [{ createApiRouter }, { createWorkerApiRouter }, { WorkerWebSocketHub }, { JewelChainStore }, { ArkImageProvider }, { DesignStorageService }, { MonadChainService }, { JewelChainAgent }, { TaskBroker }, { GenerationDispatcher }] = await Promise.all([
  import("./backend/api-router.js"),
  import("./backend/worker-api-router.js"),
  import("./backend/worker-websocket.js"),
  import("./backend/jewelchain-store.js"),
  import("./backend/ark-image-provider.js"),
  import("./backend/storage-service.js"),
  import("./backend/chain-service.js"),
  import("./backend/agent-orchestrator.js"),
  import("./backend/task-broker.js"),
  import("./backend/generation-dispatcher.js"),
]);

const publicDir = path.join(rootDir, "public");
const generatedDir = path.join(rootDir, "generated");
const metadataDir = path.join(rootDir, "metadata");
const statePath = process.env.JEWELCHAIN_STATE_PATH || path.join(rootDir, "data", "jewelchain-state.json");
const workerUploadDir = path.join(rootDir, "data", "worker-uploads");

const store = new JewelChainStore(statePath);
const imageProvider = new ArkImageProvider({ generatedDir });
const storageService = new DesignStorageService({ metadataDir });
const chainService = new MonadChainService();
const taskBroker = new TaskBroker({ store, generatedDir, uploadDir: workerUploadDir });
const generationDispatcher = new GenerationDispatcher({ imageProvider, taskBroker });
const agent = new JewelChainAgent({ store, generationDispatcher, storageService, chainService, generatedDir });
let workerHub = null;
const routeWorkerApi = createWorkerApiRouter(taskBroker, { onTaskChanged: (workerId) => workerHub?.dispatchPending(workerId) });
const routeApi = createApiRouter(agent, chainService, taskBroker);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
]);

const configuredCorsOrigins = String(process.env.CORS_ALLOWED_ORIGINS || "https://demo.jewelchain.xyz")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const corsOrigins = new Set(configuredCorsOrigins);

function isAllowedBrowserOrigin(origin) {
  if (!origin) return false;
  if (corsOrigins.has("*") || corsOrigins.has(origin)) return true;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);
}

function applyCors(request, response, pathname) {
  if (!pathname.startsWith("/api/")) return false;
  const origin = String(request.headers.origin || "");
  if (isAllowedBrowserOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Accept,Content-Type,X-Demo-Access-Code,Authorization,X-Worker-Id,X-Lease-Id,X-File-Name,X-Content-Sha256");
    response.setHeader("Access-Control-Max-Age", "86400");
  }
  if (request.method === "OPTIONS") {
    response.writeHead(isAllowedBrowserOrigin(origin) ? 204 : 403, { "Cache-Control": "no-store" });
    response.end();
    return true;
  }
  return false;
}

function safeResolve(base, requested) {
  const resolved = path.resolve(base, requested);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) return null;
  return resolved;
}

async function serveFile(request, response, filePath, { asset = false } = {}) {
  try {
    await access(filePath);
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not file");
    const extension = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": contentTypes.get(extension) || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": asset ? "private, max-age=3600" : "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https:; connect-src 'self' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    };
    response.writeHead(200, headers);
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

export function createServer() {
  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(400);
      response.end("Invalid request");
      return;
    }
    const url = new URL(request.url, "http://localhost");
    if (applyCors(request, response, url.pathname)) return;
    if (await routeWorkerApi(request, response, url)) return;
    if (await routeApi(request, response, url)) return;
    if (!["GET", "HEAD"].includes(request.method || "")) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }
    if (url.pathname.startsWith("/generated/")) {
      const file = safeResolve(generatedDir, decodeURIComponent(url.pathname.slice("/generated/".length)));
      if (!file) return serveFile(request, response, "", { asset: true });
      return serveFile(request, response, file, { asset: true });
    }
    if (url.pathname.startsWith("/metadata/")) {
      const file = safeResolve(metadataDir, decodeURIComponent(url.pathname.slice("/metadata/".length)));
      if (!file) return serveFile(request, response, "", { asset: true });
      return serveFile(request, response, file, { asset: true });
    }
    const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const file = safeResolve(publicDir, requested);
    if (!file) return serveFile(request, response, "");
    return serveFile(request, response, file);
  });
  workerHub = new WorkerWebSocketHub({ server, taskBroker });
  taskBroker.setNotifier((workerId) => workerHub?.dispatchPending(workerId));
  taskBroker.start();
  server.on("close", () => taskBroker.stop());
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 4173);
  const host = String(process.env.HOST || "127.0.0.1");
  const server = createServer();
  server.listen(port, host, () => {
    const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    console.log(`JewelChain Studio v1.2.0 Master: http://${displayHost}:${port}`);
    console.log(`Health: http://${displayHost}:${port}/api/health`);
    console.log(`Worker WS: ws://${displayHost}:${port}/ws/worker`);
    console.log(`Monad contract: ${chainService.contractAddress}`);
    agent.resumePendingJobs().catch((error) => console.error(`Resume jobs failed: ${error.message}`));
  });
}
