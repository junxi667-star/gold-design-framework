import assert from "node:assert/strict";
import test from "node:test";

import {
  AiClientError,
  HttpAiClient,
  LocalAiClient,
} from "../public/js/ai-client.js";

class MemoryDatabase {
  constructor() {
    this.stores = new Map();
  }

  store(name) {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
    return this.stores.get(name);
  }

  async getAll(name) {
    return [...this.store(name).values()];
  }

  async get(name, id) {
    return this.store(name).get(id);
  }

  async put(name, value) {
    this.store(name).set(value.id, structuredClone(value));
    return value;
  }
}

function generationInput(promptVersionId, overrides = {}) {
  return {
    projectId: "project-1",
    requirementRevisionId: "requirement-1",
    structuredRequirements: { productType: "吊坠", missingFields: ["黄金类型"] },
    directionCount: 3,
    imagesPerDirection: 1,
    referenceImages: [],
    modelConfig: { modelId: "demo-concept-v1" },
    promptVersionId,
    knowledgeRevisionIds: [],
    ...overrides,
  };
}

test("本地需求解析只整理明确输入且不识别参考图", async () => {
  const client = new LocalAiClient({ database: new MemoryDatabase() });
  const result = await client.parseRequirements({
    customerText: "想做一个年轻一点的莲花吊坠",
    formFields: { motifs: "莲花" },
    referenceImages: [{ fileName: "reference.png", mimeType: "image/png", size: 123 }],
  });

  assert.equal(result.productType, "吊坠");
  assert.deepEqual(result.motifs, ["莲花"]);
  assert.equal(result.analysisMode, "local_rule_demo");
  assert.equal(result.referenceImages[0].interpretationStatus, "stored_not_interpreted");
  assert.ok(result.missingFields.includes("黄金类型"));
  assert.match(result.understandingSummary, /参考图片未识别/);
});

test("模型目录由 client 返回且本地任务按状态机生成占位结果", async () => {
  let now = Date.parse("2026-07-20T00:00:00Z");
  const database = new MemoryDatabase();
  const client = new LocalAiClient({ database, now: () => now });
  const [prompt] = await client.listPromptTemplates();
  const models = await client.listModels();

  assert.ok(models.every((model) => model.isDemo));
  assert.ok(models.some((model) => model.capabilities.operations.includes("refine")));

  const accepted = await client.createGeneration(generationInput(prompt.id));
  assert.equal(accepted.expectedCount, 3);
  assert.equal((await client.getTask(accepted.taskId)).status, "queued");

  now += 800;
  assert.equal((await client.getTask(accepted.taskId)).status, "running");
  now += 4000;
  const completed = await client.getTask(accepted.taskId);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.completedImages.length, 3);
  assert.ok(completed.completedImages.every((result) => result.isDemoPlaceholder));
  assert.equal((await client.listProjectVersions("project-1")).length, 3);
});

test("取消后重试创建新任务且不覆盖旧任务", async () => {
  let now = Date.parse("2026-07-20T00:00:00Z");
  const database = new MemoryDatabase();
  const client = new LocalAiClient({ database, now: () => now });
  const [prompt] = await client.listPromptTemplates();
  const accepted = await client.createGeneration(generationInput(prompt.id));

  const cancelling = await client.cancelTask(accepted.taskId);
  assert.equal(cancelling.status, "cancel_requested");
  now += 500;
  const cancelled = await client.getTask(accepted.taskId);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.retryable, true);

  const retried = await client.retryTask(accepted.taskId);
  assert.notEqual(retried.taskId, accepted.taskId);
  assert.notEqual(retried.generationId, accepted.generationId);
  assert.equal((await database.get("aiTasks", accepted.taskId)).status, "cancelled");
  assert.equal((await database.get("aiTasks", retried.taskId)).retryOfTaskId, accepted.taskId);
});

test("细化结果建立明确父版本且反馈不会自动晋升", async () => {
  let now = Date.parse("2026-07-20T00:00:00Z");
  const database = new MemoryDatabase();
  const client = new LocalAiClient({ database, now: () => now });
  const [prompt] = await client.listPromptTemplates();
  const accepted = await client.createGeneration(generationInput(prompt.id, {
    directionCount: 1,
    modelConfig: { modelId: "demo-refine-v1" },
  }));
  now += 4000;
  await client.getTask(accepted.taskId);
  const [rootResult] = await client.listResults("project-1");

  const refined = await client.refineGeneration(rootResult.generationId, {
    selectedResultId: rootResult.id,
    parentVersionId: rootResult.versionId,
    customerChangeRequest: "减少装饰",
    modelConfig: { modelId: "demo-refine-v1" },
  });
  now += 4000;
  await client.getTask(refined.taskId);
  const versions = await client.listProjectVersions("project-1");
  const child = versions.find((version) => version.parentVersionId === rootResult.versionId);
  assert.ok(child, "细化结果必须指向父版本");

  const receipt = await client.submitResultFeedback(child.selectedResultId, {
    role: "expert",
    dimensions: { requirementMatch: 4 },
    qualitySampleCandidate: true,
  });
  const feedback = await database.get("aiFeedback", receipt.feedbackId);
  assert.equal(feedback.promotionStatus, "candidate_only");
  assert.match(receipt.notice, /不会自动训练/);
});

test("知识检索只返回已批准修订且任务拒绝未审核引用", async () => {
  const now = "2026-07-20T00:00:00.000Z";
  const knowledge = [
    {
      id: "approved-1",
      kind: "text",
      title: "已审核资料",
      category: "style",
      textContent: "仅作演示",
      sourceNote: "内部演示",
      reviewStatus: "approved",
      reviewer: "专家甲",
      reviewedAt: now,
      updatedAt: now,
      tags: [],
    },
    {
      id: "pending-1",
      kind: "text",
      title: "待审核资料",
      category: "style",
      textContent: "不得返回",
      sourceNote: "未审核",
      reviewStatus: "pending",
      reviewer: "",
      reviewedAt: null,
      updatedAt: now,
      tags: [],
    },
  ];
  const client = new LocalAiClient({
    database: new MemoryDatabase(),
    getKnowledgeItems: () => knowledge,
  });
  const [prompt] = await client.listPromptTemplates();
  const hits = await client.searchApprovedKnowledge({ query: "" });
  assert.deepEqual(hits.map((item) => item.knowledgeId), ["approved-1"]);

  await assert.rejects(
    client.createGeneration(generationInput(prompt.id, {
      knowledgeRevisionIds: [`pending-1@${now}`],
    })),
    (error) => error instanceof AiClientError && error.code === "REVIEW_REQUIRED",
  );
});

test("提示词必须测试通过才能发布且历史版本保留", async () => {
  const client = new LocalAiClient({ database: new MemoryDatabase() });
  const original = await client.getPublishedPrompt();
  const draft = await client.createPromptVersion({
    name: "未测试草稿",
    content: "测试内容",
    changeNote: "验证发布门禁",
    testPassed: false,
  });
  await assert.rejects(client.publishPromptVersion(draft.id), /测试通过/);

  const tested = await client.createPromptVersion({
    name: "测试通过版本",
    content: "新的测试内容",
    changeNote: "已完成团队评测",
    testPassed: true,
  });
  await client.publishPromptVersion(tested.id);
  const history = await client.listPromptTemplates();
  assert.equal(history.find((item) => item.id === tested.id).status, "official");
  assert.equal(history.find((item) => item.id === original.id).status, "archived");
  assert.equal(history.length, 3);
});

test("HTTP client 使用同源路径、幂等键并拒绝未审核知识响应", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/knowledge/search") {
      return new Response(JSON.stringify({ items: [{ knowledgeId: "bad", approvalStatus: "pending" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ taskId: "task-1", status: "queued", expectedCount: 3 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const client = new HttpAiClient({ fetchImpl });
  await client.createGeneration({ projectId: "project-1" }, { idempotencyKey: "idem-1" });

  assert.equal(calls[0].url, "/api/ai/generations");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Idempotency-Key"], "idem-1");
  await assert.rejects(
    client.searchApprovedKnowledge({ query: "莲花" }),
    (error) => error.code === "PROTOCOL_VIOLATION",
  );
});
