import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { detectImageType } from "./media/image-type.js";
import {
  createAppError,
  ARK_IMAGE_PROVIDER_ERROR,
  ARK_NOT_CONFIGURED,
  ARK_INVALID_RESPONSE,
  ARK_REQUEST_FAILED,
  ARK_NO_IMAGE_URL,
  ARK_IMAGE_DOWNLOAD_FAILED,
  ARK_EMPTY_IMAGE,
  ARK_UNSUPPORTED_IMAGE,
  ARK_TIMEOUT,
  ARK_CONNECT_FAILED,
} from "./error-codes.js";

function providerError(message, { code = ARK_IMAGE_PROVIDER_ERROR, httpStatus, retryable, details } = {}) {
  return createAppError(code, { message, httpStatus, retryable, details });
}

function normalizeBaseUrl(value) {
  return String(value || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/+$/, "");
}

function safeSegment(value) {
  return String(value || "item").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export class ArkImageProvider {
  constructor({ generatedDir, fetchImpl = globalThis.fetch } = {}) {
    this.generatedDir = generatedDir;
    this.fetchImpl = fetchImpl;
    this.apiKey = String(process.env.ARK_API_KEY || "").trim();
    this.baseUrl = normalizeBaseUrl(process.env.ARK_BASE_URL);
    this.model = String(process.env.ARK_IMAGE_MODEL || "doubao-seedream-5-0-260128").trim();
    this.imageSize = String(process.env.ARK_IMAGE_SIZE || "2K").trim();
    this.watermark = String(process.env.ARK_IMAGE_WATERMARK || "true").toLowerCase() !== "false";
    this.timeoutMs = Number(process.env.ARK_IMAGE_TIMEOUT_MS || 180000);
  }

  get configured() {
    return Boolean(this.fetchImpl && this.apiKey && this.baseUrl && this.model);
  }

  status() {
    return {
      provider: "volcengine-ark",
      model: this.model,
      configured: this.configured,
      imageSize: this.imageSize,
      watermark: this.watermark,
      endpoint: `${this.baseUrl}/images/generations`,
      notice: this.configured
        ? "火山方舟 Seedream 已配置"
        : "请在 .env 中填写 ARK_API_KEY 后重启",
    };
  }

  async generate({ prompt, filenamePrefix = "jewelchain" }) {
    if (!this.configured) {
      throw providerError("火山方舟尚未配置，请填写 .env 中的 ARK_API_KEY", {
        code: ARK_NOT_CONFIGURED,
        httpStatus: 409,
        retryable: false,
      });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const requestId = randomUUID();
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt,
          sequential_image_generation: "disabled",
          response_format: "url",
          size: this.imageSize,
          stream: false,
          watermark: this.watermark,
        }),
        signal: controller.signal,
      });
      const raw = await response.text();
      let payload = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        throw providerError("火山方舟返回了无法解析的响应", {
          code: ARK_INVALID_RESPONSE,
          details: { status: response.status, responsePreview: raw.slice(0, 300) },
        });
      }
      if (!response.ok) {
        const providerMessage = payload?.error?.message || payload?.message || "未知错误";
        throw providerError(`火山方舟请求失败（HTTP ${response.status}）：${providerMessage}`, {
          code: ARK_REQUEST_FAILED,
          retryable: response.status === 429 || response.status >= 500,
          details: {
            status: response.status,
            providerCode: payload?.error?.code || payload?.code || null,
            requestId: response.headers.get("x-tt-logid") || response.headers.get("x-request-id") || requestId,
          },
        });
      }
      const candidate = payload?.data?.[0] || payload?.images?.[0] || payload?.result?.data?.[0];
      const imageUrl = candidate?.url || candidate?.image_url || candidate?.imageUrl;
      if (!imageUrl) {
        throw providerError("火山方舟没有返回图片 URL", {
          code: ARK_NO_IMAGE_URL,
          details: { responseKeys: Object.keys(payload || {}) },
        });
      }
      const imageResponse = await this.fetchImpl(imageUrl, { signal: controller.signal });
      if (!imageResponse.ok) {
        throw providerError(`下载生成图片失败（HTTP ${imageResponse.status}）`, {
          code: ARK_IMAGE_DOWNLOAD_FAILED,
          details: { status: imageResponse.status },
        });
      }
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      if (!bytes.length) throw providerError("下载到的图片为空", { code: ARK_EMPTY_IMAGE });
      const imageType = detectImageType(bytes);
      if (!imageType) {
        throw providerError("下载结果不是受支持的 PNG、JPEG 或 WebP 图片", {
          code: ARK_UNSUPPORTED_IMAGE,
          retryable: false,
        });
      }
      await mkdir(this.generatedDir, { recursive: true });
      const filename = `${safeSegment(filenamePrefix)}_${Date.now()}${imageType.extension}`;
      const filePath = path.join(this.generatedDir, filename);
      await writeFile(filePath, bytes);
      return {
        requestId: response.headers.get("x-tt-logid") || response.headers.get("x-request-id") || requestId,
        filename,
        filePath,
        imageUrl: `/generated/${filename}`,
        mimeType: imageType.mimeType,
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        modelProvider: "Volcengine Ark",
        modelName: this.model,
        imageSize: this.imageSize,
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw providerError("火山方舟请求超时", { code: ARK_TIMEOUT, retryable: true });
      }
      if (error?.httpStatus) throw error;
      throw providerError("无法连接火山方舟", {
        code: ARK_CONNECT_FAILED,
        details: { cause: error?.message || String(error) },
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
