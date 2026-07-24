import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createAppServer } from "../server.js";

function offlineProvider() {
  return {
    healthCheck: async () => ({
      provider: "local-comfyui",
      configured: true,
      reachable: false,
      error: { code: "COMFYUI_UNAVAILABLE", message: "测试环境未连接 ComfyUI" },
    }),
  };
}

async function startServer(directory, options = {}) {
  const server = createAppServer({
    statePath: path.join(directory, "state.json"),
    generatedDir: path.join(directory, "generated"),
    provider: offlineProvider(),
    ...options,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function jsonRequest(url, {
  method = "GET",
  body,
  headers = {},
} = {}) {
  const response = await fetch(url, {
    method,
    headers: body === undefined
      ? headers
      : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    response,
    payload: await response.json(),
  };
}

function generationBody(overrides = {}) {
  return {
    projectId: "project-legacy-client",
    requirementRevisionId: "requirement-from-v041-browser",
    structuredRequirements: {
      productType: "吊坠",
      goldType: "足金",
      style: "年轻简约",
      targetAudience: "年轻女性",
      usageScenario: "送礼",
      motifs: ["莲花"],
      mustKeep: ["莲花元素"],
      mustAvoid: ["尖锐结构"],
    },
    promptVersionId: "prompt-backend-v1",
    modelConfig: { modelId: "backend-contract-v1" },
    directionCount: 3,
    imagesPerDirection: 1,
    knowledgeRevisionIds: [],
    referenceImages: [],
    ...overrides,
  };
}

test("旧静态页面保留，模型目录只在实时健康检查通过时开放 ComfyUI", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gold-backend-models-"));
  const app = await startServer(directory);
  try {
    const page = await fetch(`${app.baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /黄金产业 AI 智能设计框架/);

    const health = await jsonRequest(`${app.baseUrl}/api/health`);
    assert.equal(health.response.status, 200);
    assert.equal(health.payload.data.capabilities.realImageGenerationAvailable, false);
    assert.equal(health.payload.data.capabilities.imageGeneration, "explicit_placeholder_demo_only");

    const models = await jsonRequest(`${app.baseUrl}/api/ai/models`);
    const demo = models.payload.data.items.find((item) => item.id === "backend-contract-v1");
    const comfy = models.payload.data.items.find(
      (item) => item.id === "local-comfyui-sdxl-base-refiner-v1",
    );
    assert.equal(demo.status, "available");
    assert.equal(demo.isDemo, true);
    assert.equal(comfy.status, "unavailable");
    assert.equal(comfy.isDemo, false);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ComfyUI 端口可达但模型或工作流未就绪时仍禁止真实模型", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gold-backend-not-ready-"));
  const provider = {
    healthCheck: async () => ({
      provider: "local-comfyui",
      configured: true,
      reachable: true,
      ready: false,
      missingCheckpoints: ["sd_xl_refiner_1.0.safetensors"],
      error: {
        code: "COMFYUI_CHECKPOINTS_MISSING",
        message: "ComfyUI 已连接，但缺少 Refiner 模型",
      },
    }),
  };
  const app = await startServer(directory, { provider });
  try {
    const health = await jsonRequest(`${app.baseUrl}/api/health`);
    assert.equal(health.payload.data.capabilities.realImageGenerationAvailable, false);
    assert.equal(health.payload.data.capabilities.provider.reachable, true);
    assert.equal(health.payload.data.capabilities.provider.ready, false);

    const models = await jsonRequest(`${app.baseUrl}/api/ai/models`);
    const comfy = models.payload.data.items.find(
      (item) => item.id === "local-comfyui-sdxl-base-refiner-v1",
    );
    assert.equal(comfy.status, "unavailable");
    assert.match(comfy.availabilityReason, /缺少/);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("恶意 Host、跨源 Origin 和 text/plain 写入均被拒绝", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gold-backend-origin-"));
  const app = await startServer(directory);
  try {
    const port = Number(new URL(app.baseUrl).port);
    const hostStatus = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: "127.0.0.1",
        port,
        path: "/api/health",
        headers: { Host: "attacker.example" },
      }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(hostStatus, 403);

    const crossOrigin = await jsonRequest(`${app.baseUrl}/api/ai/requirements/parse`, {
      method: "POST",
      headers: { Origin: "http://attacker.example" },
      body: { customerText: "莲花吊坠" },
    });
    assert.equal(crossOrigin.response.status, 403);
    assert.equal(crossOrigin.payload.error.code, "CROSS_ORIGIN_REQUEST");

    const textPlain = await fetch(`${app.baseUrl}/api/ai/requirements/parse`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ customerText: "莲花吊坠" }),
    });
    assert.equal(textPlain.status, 415);
    assert.equal((await textPlain.json()).error.code, "UNSUPPORTED_MEDIA_TYPE");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Idempotency-Key 跨进程状态重放，相同键不同请求返回冲突", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gold-backend-idempotency-"));
  const key = "generation-persisted-test-1";
  let app = await startServer(directory);
  try {
    const first = await jsonRequest(`${app.baseUrl}/api/ai/generations`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: generationBody(),
    });
    assert.equal(first.response.status, 202);
    const firstTaskId = first.payload.data.taskId;

    const replay = await jsonRequest(`${app.baseUrl}/api/ai/generations`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: generationBody(),
    });
    assert.equal(replay.response.status, 202);
    assert.equal(replay.payload.data.taskId, firstTaskId);
    assert.equal(replay.response.headers.get("idempotency-replayed"), "true");

    const conflict = await jsonRequest(`${app.baseUrl}/api/ai/generations`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: generationBody({ directionCount: 2 }),
    });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.payload.error.code, "IDEMPOTENCY_CONFLICT");

    await app.close();
    app = await startServer(directory);
    const afterRestart = await jsonRequest(`${app.baseUrl}/api/ai/generations`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: generationBody(),
    });
    assert.equal(afterRestart.response.status, 202);
    assert.equal(afterRestart.payload.data.taskId, firstTaskId);
    assert.equal(afterRestart.response.headers.get("idempotency-replayed"), "true");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("旧前端内联确认需求可生成三个命名方向并保留 completedImages", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gold-backend-directions-"));
  let clock = Date.now();
  const app = await startServer(directory, {
    now: () => clock,
    demoCompletionMs: 100,
  });
  try {
    const accepted = await jsonRequest(`${app.baseUrl}/api/ai/generations`, {
      method: "POST",
      body: generationBody(),
    });
    assert.equal(accepted.response.status, 202);
    assert.equal(accepted.payload.data.directions.length, 3);

    clock += 200;
    const task = await jsonRequest(
      `${app.baseUrl}/api/ai/tasks/${accepted.payload.data.taskId}`,
    );
    assert.equal(task.payload.data.status, "succeeded");
    assert.deepEqual(
      task.payload.data.directions.map((direction) => direction.name),
      ["现代留白", "文化叙事", "结构创新"],
    );
    assert.equal(task.payload.data.completedImages.length, 3);
    assert.ok(task.payload.data.completedImages.every((item) => item.isDemoPlaceholder));
    assert.ok(task.payload.data.completedImages.every((item) => item.directionName));
    assert.ok(task.payload.data.directions.every((direction) => direction.description));
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("部分成功按方向聚合，单方向 retry 不重跑成功方向", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gold-backend-partial-"));
  let submitted = 0;
  const promptStatuses = new Map();
  const provider = {
    healthCheck: async () => ({
      provider: "local-comfyui",
      configured: true,
      reachable: true,
    }),
    submitGeneration: async () => {
      submitted += 1;
      const promptId = `prompt-${submitted}`;
      promptStatuses.set(promptId, submitted === 2 ? "failed" : "completed");
      return {
        promptId,
        clientId: `client-${submitted}`,
        queueNumber: submitted,
        parameters: { seed: submitted },
      };
    },
    getPromptStatus: async (promptId) => {
      if (promptStatuses.get(promptId) === "failed") {
        return {
          status: "failed",
          error: { code: "TEST_DIRECTION_FAILED", message: "验收模拟：该方向失败" },
        };
      }
      return {
        status: "completed",
        images: [{ filename: `${promptId}.png`, subfolder: "", type: "output" }],
      };
    },
    archiveImage: async (_image, { taskId, directionId, index }) => ({
      filename: `${taskId}-${directionId}-${index}.png`,
      imageUrl: `/generated/${taskId}-${directionId}-${index}.png`,
      mimeType: "image/png",
      sizeBytes: 68,
      sha256: "test-sha256",
    }),
    cancel: async () => ({ cancelled: true }),
  };
  const app = await startServer(directory, { provider });
  try {
    const accepted = await jsonRequest(`${app.baseUrl}/api/ai/generations`, {
      method: "POST",
      body: generationBody({
        modelConfig: { modelId: "local-comfyui-sdxl-base-refiner-v1" },
      }),
    });
    assert.equal(accepted.response.status, 202);
    assert.equal(submitted, 3);

    const task = await jsonRequest(
      `${app.baseUrl}/api/ai/tasks/${accepted.payload.data.taskId}`,
    );
    assert.equal(task.payload.data.status, "partial_succeeded");
    assert.deepEqual(
      task.payload.data.directions.map((direction) => direction.status),
      ["succeeded", "failed", "succeeded"],
    );
    assert.equal(task.payload.data.completedImages.length, 2);
    const failedDirection = task.payload.data.directions[1];
    const successfulDirectionIds = task.payload.data.directions
      .filter((direction) => direction.status === "succeeded")
      .map((direction) => direction.id);

    promptStatuses.set("prompt-4", "completed");
    const retry = await jsonRequest(
      `${app.baseUrl}/api/ai/tasks/${accepted.payload.data.taskId}/retry`,
      {
        method: "POST",
        body: { directionId: failedDirection.id },
      },
    );
    assert.equal(retry.response.status, 202);
    assert.equal(submitted, 4);
    assert.deepEqual(retry.payload.data.retriedDirectionIds, [failedDirection.id]);
    assert.deepEqual(retry.payload.data.preservedSuccessfulDirectionIds, successfulDirectionIds);

    const retriedTask = await jsonRequest(
      `${app.baseUrl}/api/ai/tasks/${retry.payload.data.taskId}`,
    );
    assert.equal(retriedTask.payload.data.directions.length, 1);
    assert.equal(
      retriedTask.payload.data.directions[0].sourceDirectionId,
      failedDirection.id,
    );
    assert.equal(retriedTask.payload.data.status, "succeeded");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
