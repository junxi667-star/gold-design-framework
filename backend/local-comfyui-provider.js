import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { apiError, clone } from "./utils.js";

function safeSegment(value) {
  return String(value || "item").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function inferExtension(filename, contentType) {
  const extension = path.extname(filename || "").toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return extension;
  if (contentType?.includes("jpeg")) return ".jpg";
  if (contentType?.includes("webp")) return ".webp";
  return ".png";
}

function normalizeLoopbackBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw apiError("ComfyUI 地址格式无效", {
      code: "COMFYUI_CONFIGURATION_INVALID",
      httpStatus: 500,
    });
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw apiError("ComfyUI 仅允许连接本机 HTTP 回环地址", {
      code: "COMFYUI_CONFIGURATION_INVALID",
      httpStatus: 500,
      details: { allowedHosts: ["127.0.0.1", "localhost", "::1"] },
    });
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function providerError(message, {
  code = "COMFYUI_ERROR",
  httpStatus = 503,
  retryable = true,
  details = null,
} = {}) {
  return apiError(message, { code, httpStatus, retryable, details });
}

export class LocalComfyUiProvider {
  constructor({
    baseUrl = process.env.COMFYUI_BASE_URL || "http://127.0.0.1:8188",
    workflowPath,
    generatedDir,
    fetchImpl = globalThis.fetch,
    submitTimeoutMs = Number(process.env.COMFYUI_SUBMIT_TIMEOUT_MS || 15000),
    requestTimeoutMs = Number(process.env.COMFYUI_REQUEST_TIMEOUT_MS || 30000),
    baseCheckpoint = process.env.COMFYUI_BASE_CHECKPOINT || "sd_xl_base_1.0.safetensors",
    refinerCheckpoint = process.env.COMFYUI_REFINER_CHECKPOINT || "sd_xl_refiner_1.0.safetensors",
  } = {}) {
    if (!workflowPath) throw new Error("LocalComfyUiProvider requires workflowPath");
    if (!generatedDir) throw new Error("LocalComfyUiProvider requires generatedDir");
    if (!fetchImpl) throw new Error("LocalComfyUiProvider requires fetch support");
    this.baseUrl = normalizeLoopbackBaseUrl(baseUrl);
    this.workflowPath = workflowPath;
    this.generatedDir = generatedDir;
    this.fetchImpl = fetchImpl;
    this.submitTimeoutMs = submitTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.baseCheckpoint = baseCheckpoint;
    this.refinerCheckpoint = refinerCheckpoint;
    this.workflowCache = null;
    this.lastStatus = null;
  }

  async request(pathname, { method = "GET", body, timeoutMs = this.requestTimeoutMs } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        headers: body === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const raw = await response.text().catch(() => "");
        throw providerError(`ComfyUI 请求失败（HTTP ${response.status}）`, {
          code: "COMFYUI_HTTP_ERROR",
          details: { status: response.status, response: raw.slice(0, 500) },
        });
      }
      return response;
    } catch (error) {
      if (String(error?.code || "").startsWith("COMFYUI_")) throw error;
      if (error?.name === "AbortError") {
        throw providerError("连接 ComfyUI 超时，请确认本地 ComfyUI 正在运行", {
          code: "COMFYUI_TIMEOUT",
          details: { baseUrl: this.baseUrl },
        });
      }
      throw providerError("无法连接本地 ComfyUI，请先启动本机 ComfyUI", {
        code: "COMFYUI_UNAVAILABLE",
        details: { baseUrl: this.baseUrl, cause: String(error?.message || error) },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck() {
    const startedAt = Date.now();
    try {
      const healthTimeoutMs = Math.max(
        200,
        Math.min(5000, Number(process.env.COMFYUI_HEALTH_TIMEOUT_MS || 800)),
      );
      const response = await this.request("/system_stats", { timeoutMs: healthTimeoutMs });
      const data = await response.json();
      let ready = false;
      let workflowValid = false;
      let availableCheckpoints = [];
      let missingCheckpoints = [this.baseCheckpoint, this.refinerCheckpoint];
      let readinessError = null;
      try {
        const objectResponse = await this.request(
          "/object_info/CheckpointLoaderSimple",
          { timeoutMs: Math.max(healthTimeoutMs, 1500) },
        );
        const objectInfo = await objectResponse.json();
        const checkpointInfo = objectInfo?.CheckpointLoaderSimple ?? objectInfo;
        availableCheckpoints = checkpointInfo?.input?.required?.ckpt_name?.[0] || [];
        missingCheckpoints = [this.baseCheckpoint, this.refinerCheckpoint]
          .filter((checkpoint) => !availableCheckpoints.includes(checkpoint));
        await this.loadWorkflow();
        workflowValid = true;
        ready = missingCheckpoints.length === 0;
        if (!ready) {
          readinessError = {
            code: "COMFYUI_CHECKPOINTS_MISSING",
            message: `ComfyUI 已连接，但缺少模型：${missingCheckpoints.join("、")}`,
          };
        }
      } catch (error) {
        readinessError = {
          code: error.code || "COMFYUI_NOT_READY",
          message: error.message,
        };
      }
      this.lastStatus = {
        provider: "local-comfyui",
        configured: true,
        reachable: true,
        ready,
        baseUrl: this.baseUrl,
        latencyMs: Date.now() - startedAt,
        device: data?.devices?.[0]?.name || data?.system?.device || null,
        vramTotal: data?.devices?.[0]?.vram_total || null,
        vramFree: data?.devices?.[0]?.vram_free || null,
        workflowPath: this.workflowPath,
        workflowValid,
        baseCheckpoint: this.baseCheckpoint,
        refinerCheckpoint: this.refinerCheckpoint,
        availableCheckpoints,
        missingCheckpoints,
        ...(readinessError ? { error: readinessError } : {}),
      };
    } catch (error) {
      this.lastStatus = {
        provider: "local-comfyui",
        configured: true,
        reachable: false,
        ready: false,
        baseUrl: this.baseUrl,
        latencyMs: Date.now() - startedAt,
        error: {
          code: error.code || "COMFYUI_UNAVAILABLE",
          message: error.message,
        },
        workflowPath: this.workflowPath,
        baseCheckpoint: this.baseCheckpoint,
        refinerCheckpoint: this.refinerCheckpoint,
      };
    }
    return clone(this.lastStatus);
  }

  async loadWorkflow() {
    if (this.workflowCache) return clone(this.workflowCache);
    let workflow;
    try {
      workflow = JSON.parse(await readFile(this.workflowPath, "utf8"));
    } catch (error) {
      throw providerError("无法读取 ComfyUI API 工作流文件", {
        code: "COMFYUI_WORKFLOW_READ_FAILED",
        httpStatus: 500,
        retryable: false,
        details: { workflowPath: this.workflowPath, cause: String(error.message || error) },
      });
    }
    const requiredNodes = ["4", "5", "6", "7", "10", "11", "12", "15", "16", "17", "19"];
    const missingNodes = requiredNodes.filter((nodeId) => !workflow[nodeId]);
    if (missingNodes.length) {
      throw providerError("ComfyUI API 工作流缺少必要节点", {
        code: "COMFYUI_WORKFLOW_INVALID",
        httpStatus: 500,
        retryable: false,
        details: { missingNodes },
      });
    }
    this.workflowCache = workflow;
    return clone(workflow);
  }

  async buildWorkflow({
    positivePrompt,
    negativePrompt,
    width = 1024,
    height = 1024,
    seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
    steps = 25,
    cfg = 7,
    sampler = "euler",
    scheduler = "normal",
    filenamePrefix = "gold_ai",
  } = {}) {
    const workflow = await this.loadWorkflow();
    const normalizedSteps = Math.max(2, Math.min(100, Number(steps) || 25));
    const splitStep = Math.max(1, Math.min(normalizedSteps - 1, Math.round(normalizedSteps * 0.8)));
    workflow["4"].inputs.ckpt_name = this.baseCheckpoint;
    workflow["12"].inputs.ckpt_name = this.refinerCheckpoint;
    workflow["5"].inputs.width = Math.max(256, Math.min(2048, Number(width) || 1024));
    workflow["5"].inputs.height = Math.max(256, Math.min(2048, Number(height) || 1024));
    workflow["5"].inputs.batch_size = 1;
    workflow["6"].inputs.text = String(positivePrompt || "");
    workflow["15"].inputs.text = String(positivePrompt || "");
    workflow["7"].inputs.text = String(negativePrompt || "");
    workflow["16"].inputs.text = String(negativePrompt || "");
    for (const nodeId of ["10", "11"]) {
      workflow[nodeId].inputs.noise_seed = Number(seed);
      workflow[nodeId].inputs.steps = normalizedSteps;
      workflow[nodeId].inputs.cfg = Math.max(1, Math.min(30, Number(cfg) || 7));
      workflow[nodeId].inputs.sampler_name = sampler;
      workflow[nodeId].inputs.scheduler = scheduler;
    }
    workflow["10"].inputs.start_at_step = 0;
    workflow["10"].inputs.end_at_step = splitStep;
    workflow["10"].inputs.add_noise = "enable";
    workflow["10"].inputs.return_with_leftover_noise = "enable";
    workflow["11"].inputs.start_at_step = splitStep;
    workflow["11"].inputs.end_at_step = 10000;
    workflow["11"].inputs.add_noise = "disable";
    workflow["11"].inputs.return_with_leftover_noise = "disable";
    workflow["19"].inputs.filename_prefix = safeSegment(filenamePrefix);
    return {
      workflow,
      parameters: {
        width: workflow["5"].inputs.width,
        height: workflow["5"].inputs.height,
        seed: Number(seed),
        steps: normalizedSteps,
        cfg: workflow["10"].inputs.cfg,
        sampler,
        scheduler,
        baseEndStep: splitStep,
        refinerStartStep: splitStep,
        baseCheckpoint: this.baseCheckpoint,
        refinerCheckpoint: this.refinerCheckpoint,
      },
    };
  }

  async submitGeneration(input) {
    const clientId = `gold-ai-${randomUUID()}`;
    const built = await this.buildWorkflow(input);
    const response = await this.request("/prompt", {
      method: "POST",
      body: { prompt: built.workflow, client_id: clientId },
      timeoutMs: this.submitTimeoutMs,
    });
    const payload = await response.json();
    if (!payload?.prompt_id) {
      throw providerError("ComfyUI 未返回 prompt_id", {
        code: "COMFYUI_INVALID_RESPONSE",
        details: payload,
      });
    }
    if (payload.node_errors && Object.keys(payload.node_errors).length) {
      throw providerError("ComfyUI 工作流节点校验失败", {
        code: "COMFYUI_NODE_VALIDATION_FAILED",
        httpStatus: 400,
        retryable: false,
        details: payload.node_errors,
      });
    }
    return {
      promptId: payload.prompt_id,
      clientId,
      queueNumber: payload.number ?? null,
      parameters: built.parameters,
    };
  }

  async getPromptStatus(promptId) {
    const response = await this.request(`/history/${encodeURIComponent(promptId)}`);
    const payload = await response.json();
    const record = payload?.[promptId];
    if (!record) return { status: "pending", images: [] };
    const status = record.status || {};
    if (status.completed && status.status_str && status.status_str !== "success") {
      return {
        status: "failed",
        images: [],
        error: {
          code: "COMFYUI_EXECUTION_FAILED",
          message: `ComfyUI 执行失败：${status.status_str}`,
          details: status.messages || null,
        },
      };
    }
    const images = [];
    for (const output of Object.values(record.outputs || {})) {
      for (const image of output?.images || []) {
        images.push({
          filename: image.filename,
          subfolder: image.subfolder || "",
          type: image.type || "output",
        });
      }
    }
    if (images.length) return { status: "completed", images };
    if (status.completed) {
      return {
        status: "failed",
        images: [],
        error: {
          code: "COMFYUI_NO_OUTPUT",
          message: "ComfyUI 已完成，但没有返回图片输出",
          details: status.messages || null,
        },
      };
    }
    return { status: "running", images: [] };
  }

  async archiveImage(image, { taskId, directionId, index = 1 } = {}) {
    const query = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder || "",
      type: image.type || "output",
    });
    const response = await this.request(`/view?${query.toString()}`, { timeoutMs: 60000 });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw providerError("ComfyUI 返回了空图片文件", {
        code: "COMFYUI_EMPTY_IMAGE",
      });
    }
    await mkdir(this.generatedDir, { recursive: true });
    const extension = inferExtension(image.filename, response.headers.get("content-type"));
    const filename = `${safeSegment(taskId)}-${safeSegment(directionId)}-${String(index).padStart(2, "0")}${extension}`;
    const filePath = path.join(this.generatedDir, filename);
    await writeFile(filePath, buffer);
    return {
      filename,
      filePath,
      imageUrl: `/generated/${encodeURIComponent(filename)}`,
      mimeType: response.headers.get("content-type") || "image/png",
      sizeBytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    };
  }

  async cancel(promptId) {
    try {
      await this.request("/queue", {
        method: "POST",
        body: { delete: [promptId] },
        timeoutMs: 5000,
      });
      return { cancelled: true };
    } catch (error) {
      return { cancelled: false, error: error.code || error.message };
    }
  }
}
