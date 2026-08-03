import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../backend/env-loader.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = loadEnvFile(root);
const [{ ArkImageProvider }, { DesignStorageService }, { MonadChainService }] = await Promise.all([
  import("../backend/ark-image-provider.js"),
  import("../backend/storage-service.js"),
  import("../backend/chain-service.js"),
]);
const provider = new ArkImageProvider({ generatedDir: path.join(root, "worker-generated") });
const storage = new DesignStorageService({ metadataDir: path.join(root, "metadata") });
const chain = new MonadChainService();
const masterUrl = String(process.env.MASTER_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4173}`).replace(/\/+$/, "");

async function fetchJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return response.ok ? await response.json() : { error: `HTTP ${response.status}` };
  } catch (error) {
    return { error: error.message };
  }
}

console.log("JewelChain Studio v1.0.0 Diagnostics");
console.log("Node:", process.version);
console.log(".env:", env.loaded ? "FOUND" : "NOT FOUND");
console.log("public/index.html:", existsSync(path.join(root, "public", "index.html")) ? "OK" : "MISSING");
console.log("runtime/node.exe:", existsSync(path.join(root, "runtime", "node.exe")) ? "OK" : "MISSING");
console.log("worker/image-worker.js:", existsSync(path.join(root, "worker", "image-worker.js")) ? "OK" : "MISSING");
console.log("Execution mode:", process.env.IMAGE_EXECUTION_MODE || "worker");
console.log("Master URL:", masterUrl);
console.log("Worker ID:", process.env.WORKER_ID || "not set");
console.log("Worker token:", process.env.WORKER_TOKEN ? "CONFIGURED" : "MISSING");
console.log("Image provider:", JSON.stringify(provider.status(), null, 2));
console.log("Storage:", JSON.stringify(storage.status(), null, 2));
console.log("Chain:", JSON.stringify(await chain.status(), null, 2));
console.log("Master health:", JSON.stringify(await fetchJson(`${masterUrl}/api/health`), null, 2));
console.log("Worker status:", JSON.stringify(await fetchJson(`${masterUrl}/api/v1/workers/status`), null, 2));
