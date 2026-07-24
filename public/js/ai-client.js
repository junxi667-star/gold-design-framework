const TASK_TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);

export const AI_API_PATHS = Object.freeze({
  parseRequirements: "/api/ai/requirements/parse",
  generations: "/api/ai/generations",
  task: (taskId) => `/api/ai/tasks/${encodeURIComponent(taskId)}`,
  cancelTask: (taskId) => `/api/ai/tasks/${encodeURIComponent(taskId)}/cancel`,
  retryTask: (taskId) => `/api/ai/tasks/${encodeURIComponent(taskId)}/retry`,
  refineGeneration: (generationId) => `/api/ai/generations/${encodeURIComponent(generationId)}/refine`,
  resultFeedback: (resultId) => `/api/ai/results/${encodeURIComponent(resultId)}/feedback`,
  projectVersions: (projectId) => `/api/projects/${encodeURIComponent(projectId)}/versions`,
  models: "/api/ai/models",
  promptTemplates: "/api/ai/prompt-templates",
  publishedPrompt: "/api/ai/prompt-templates/current",
  comparePrompts: "/api/ai/prompt-templates/compare",
  publishPrompt: (versionId) => `/api/ai/prompt-templates/${encodeURIComponent(versionId)}/publish`,
  knowledgeSearch: "/api/knowledge/search",
});

export class AiClientError extends Error {
  constructor(message, { code = "CLIENT_ERROR", httpStatus = 0, retryable = false, details = null } = {}) {
    super(message);
    this.name = "AiClientError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    this.details = details;
  }
}

function id(prefix) {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function iso(value = Date.now()) {
  return new Date(value).toISOString();
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(text).filter(Boolean))];
  }
  return [...new Set(text(value).split(/[，,、;；\n]/).map(text).filter(Boolean))];
}

function requireText(value, label) {
  const normalized = text(value);
  if (!normalized) {
    throw new AiClientError(`${label}不能为空`, { code: "VALIDATION_FAILED" });
  }
  return normalized;
}

function clone(value) {
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function fnvHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unwrap(payload) {
  return payload?.data ?? payload;
}

function asItems(payload) {
  const value = unwrap(payload);
  if (Array.isArray(value)) {
    return value;
  }
  return value?.items ?? [];
}

export class HttpAiClient {
  constructor({ fetchImpl = globalThis.fetch?.bind(globalThis), basePath = "" } = {}) {
    this.fetchImpl = fetchImpl;
    this.basePath = basePath.replace(/\/$/, "");
  }

  async request(path, { method = "GET", body, signal, idempotencyKey } = {}) {
    if (!this.fetchImpl) {
      throw new AiClientError("当前环境不支持网络请求", { code: "FETCH_UNAVAILABLE" });
    }

    const headers = { Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    let response;
    try {
      response = await this.fetchImpl(`${this.basePath}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw error;
      }
      throw new AiClientError("无法连接同源 AI 后端；系统不会自动切换到演示模式", {
        code: "CONNECTION_FAILED",
        retryable: true,
        details: error,
      });
    }

    const raw = await response.text();
    let payload = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { message: raw };
      }
    }

    if (!response.ok) {
      const error = payload?.error ?? payload ?? {};
      throw new AiClientError(error.message || `请求失败（HTTP ${response.status}）`, {
        code: error.code || "HTTP_ERROR",
        httpStatus: response.status,
        retryable: Boolean(error.retryable || response.status >= 500 || response.status === 429),
        details: error,
      });
    }

    return unwrap(payload);
  }

  parseRequirements(input, options = {}) {
    return this.request(AI_API_PATHS.parseRequirements, { method: "POST", body: input, ...options });
  }

  createGeneration(input, options = {}) {
    return this.request(AI_API_PATHS.generations, { method: "POST", body: input, ...options });
  }

  getTask(taskId, options = {}) {
    return this.request(AI_API_PATHS.task(taskId), options);
  }

  cancelTask(taskId, input = {}, options = {}) {
    return this.request(AI_API_PATHS.cancelTask(taskId), { method: "POST", body: input, ...options });
  }

  retryTask(taskId, input = {}, options = {}) {
    return this.request(AI_API_PATHS.retryTask(taskId), { method: "POST", body: input, ...options });
  }

  refineGeneration(generationId, input, options = {}) {
    return this.request(AI_API_PATHS.refineGeneration(generationId), { method: "POST", body: input, ...options });
  }

  submitResultFeedback(resultId, input, options = {}) {
    return this.request(AI_API_PATHS.resultFeedback(resultId), { method: "POST", body: input, ...options });
  }

  listProjectVersions(projectId, options = {}) {
    return this.request(AI_API_PATHS.projectVersions(projectId), options);
  }

  listModels(options = {}) {
    return this.request(AI_API_PATHS.models, options).then(asItems);
  }

  listPromptTemplates(options = {}) {
    return this.request(`${AI_API_PATHS.promptTemplates}?scope=gold-design`, options).then(asItems);
  }

  getPublishedPrompt(options = {}) {
    return this.request(`${AI_API_PATHS.publishedPrompt}?scope=gold-design`, options);
  }

  createPromptVersion(input, options = {}) {
    return this.request(AI_API_PATHS.promptTemplates, { method: "POST", body: input, ...options });
  }

  comparePromptVersions(leftId, rightId, options = {}) {
    return this.request(AI_API_PATHS.comparePrompts, {
      method: "POST",
      body: { leftVersionId: leftId, rightVersionId: rightId },
      ...options,
    });
  }

  publishPromptVersion(versionId, input = {}, options = {}) {
    return this.request(AI_API_PATHS.publishPrompt(versionId), { method: "POST", body: input, ...options });
  }

  async searchApprovedKnowledge(input, options = {}) {
    const payload = await this.request(AI_API_PATHS.knowledgeSearch, { method: "POST", body: input, ...options });
    const items = asItems(payload);
    if (items.some((item) => item.approvalStatus !== "approved" && item.reviewStatus !== "approved")) {
      throw new AiClientError("知识检索返回了未审核资料，已拒绝整次响应", {
        code: "PROTOCOL_VIOLATION",
        details: items,
      });
    }
    return items;
  }
}

const DEMO_MODELS = Object.freeze([
  {
    id: "demo-concept-v1",
    provider: "local-demo",
    displayName: "本地构图占位器",
    status: "available",
    isDefault: true,
    isDemo: true,
    recommendedUse: "验证多方向任务、进度和版本交互",
    capabilities: {
      operations: ["generate"],
      inputModalities: ["text", "image-reference"],
      maxReferenceImages: 4,
      aspectRatios: ["1:1", "4:5"],
      outputCount: { min: 1, max: 9 },
    },
  },
  {
    id: "demo-refine-v1",
    provider: "local-demo",
    displayName: "本地细化占位器",
    status: "available",
    isDefault: false,
    isDemo: true,
    recommendedUse: "验证基于父版本的细化链路",
    capabilities: {
      operations: ["generate", "refine"],
      inputModalities: ["text", "image-reference"],
      maxReferenceImages: 6,
      aspectRatios: ["1:1", "4:5", "16:9"],
      outputCount: { min: 1, max: 9 },
    },
  },
]);

export class LocalAiClient {
  constructor({ database, getKnowledgeItems = () => [], now = () => Date.now() } = {}) {
    if (!database) {
      throw new AiClientError("本地接口演示需要数据库", { code: "DATABASE_REQUIRED" });
    }
    this.database = database;
    this.getKnowledgeItems = getKnowledgeItems;
    this.now = now;
  }

  async parseRequirements(input) {
    const form = input.formFields ?? {};
    const raw = text(input.customerText);
    const exactFromRaw = (options) => options.find((option) => raw.includes(option)) ?? "";
    const structured = {
      productType: text(form.productType) || exactFromRaw(["戒指", "吊坠", "手镯", "项链", "耳饰", "摆件", "金条"]),
      goldType: text(form.goldType) || exactFromRaw(["足金", "古法金", "硬金", "K金"]),
      style: text(form.style) || exactFromRaw(["简约现代", "现代国潮", "传统文化", "轻奢精致", "古法质感"]),
      targetAudience: text(form.targetAudience),
      usageScenario: text(form.usageScenario),
      motifs: list(form.motifs),
      weightOrBudget: text(form.weightOrBudget),
      craftRequirements: list(form.craftRequirements),
      mustKeep: list(form.mustKeep),
      mustAvoid: list(form.mustAvoid),
    };
    const labels = {
      productType: "产品类型",
      goldType: "黄金类型",
      style: "风格",
      targetAudience: "目标人群",
      usageScenario: "使用场景",
      motifs: "图案元素",
      weightOrBudget: "克重或预算",
      craftRequirements: "工艺要求",
    };
    const missingFields = Object.entries(labels)
      .filter(([key]) => Array.isArray(structured[key]) ? structured[key].length === 0 : !structured[key])
      .map(([, label]) => label);
    const explicit = [
      structured.productType,
      structured.goldType,
      structured.style,
      structured.targetAudience,
      structured.usageScenario,
    ].filter(Boolean);

    return {
      requirementRevisionId: id("requirement"),
      analysisMode: "local_rule_demo",
      ...structured,
      missingFields,
      referenceImages: (input.referenceImages ?? []).map((image) => ({
        ...image,
        interpretationStatus: "stored_not_interpreted",
      })),
      understandingSummary: explicit.length
        ? `本地规则仅整理了客户明确输入：${explicit.join("、")}。参考图片未识别，缺失信息仍需人工确认。`
        : "本地规则未得到足够的明确字段，请人工补充结构化需求；参考图片未识别。",
    };
  }

  async approvedKnowledgeRevisionIds() {
    const items = await this.getKnowledgeItems();
    return new Set(items
      .filter((item) => item.reviewStatus === "approved")
      .map((item) => `${item.id}@${item.updatedAt}`));
  }

  async validateKnowledgeRevisions(revisionIds = []) {
    const approved = await this.approvedKnowledgeRevisionIds();
    const invalid = revisionIds.filter((revisionId) => !approved.has(revisionId));
    if (invalid.length) {
      throw new AiClientError("生成任务引用了未审核或已过期的知识修订", {
        code: "REVIEW_REQUIRED",
        details: invalid,
      });
    }
  }

  findModel(modelId, operation) {
    const model = DEMO_MODELS.find((item) => item.id === modelId);
    if (!model || model.status !== "available" || !model.capabilities.operations.includes(operation)) {
      throw new AiClientError("所选模型当前不支持该操作，请刷新模型列表后重选", {
        code: "UNSUPPORTED_MODEL_CAPABILITY",
      });
    }
    return model;
  }

  async createTask(payload, { operation, retryOfTaskId = null, retryOfGenerationId = null } = {}) {
    const modelId = payload.modelConfig?.modelId || payload.modelId;
    const model = this.findModel(modelId, operation);
    const expectedCount = operation === "refine"
      ? 1
      : Number(payload.directionCount || 1) * Number(payload.imagesPerDirection || 1);
    if (expectedCount < model.capabilities.outputCount.min || expectedCount > model.capabilities.outputCount.max) {
      throw new AiClientError(`所选模型单次支持 ${model.capabilities.outputCount.min}–${model.capabilities.outputCount.max} 个结果`, {
        code: "VALIDATION_FAILED",
      });
    }
    if ((payload.referenceImages ?? []).length > model.capabilities.maxReferenceImages) {
      throw new AiClientError(`所选模型最多接收 ${model.capabilities.maxReferenceImages} 张参考图片`, {
        code: "VALIDATION_FAILED",
      });
    }
    await this.validateKnowledgeRevisions(payload.knowledgeRevisionIds ?? []);

    const createdAtMs = this.now();
    const generationId = id("generation");
    const task = {
      id: id("task"),
      generationId,
      projectId: requireText(payload.projectId, "项目 ID"),
      operation,
      status: "queued",
      currentStep: "等待本地演示任务开始",
      progress: 0,
      expectedCount,
      completedImages: [],
      resultIds: [],
      error: null,
      retryable: false,
      retryOfTaskId,
      retryOfGenerationId,
      rootTaskId: null,
      modelSnapshot: clone(model),
      promptVersionId: payload.promptVersionId || null,
      knowledgeRevisionIds: [...(payload.knowledgeRevisionIds ?? [])],
      requirementRevisionId: payload.requirementRevisionId || null,
      parentVersionId: payload.parentVersionId || null,
      parentResultId: payload.selectedResultId || null,
      sourceGenerationId: payload.sourceGenerationId || null,
      payload: clone(payload),
      createdAt: iso(createdAtMs),
      startedAt: null,
      completedAt: null,
      updatedAt: iso(createdAtMs),
      cancelRequestedAt: null,
    };
    task.rootTaskId = retryOfTaskId ? (payload.rootTaskId || retryOfTaskId) : task.id;
    await this.database.put("aiTasks", task);
    return {
      taskId: task.id,
      generationId,
      status: task.status,
      expectedCount,
    };
  }

  async createGeneration(input) {
    const templates = await this.listPromptTemplates();
    if (!templates.some((item) => item.id === input.promptVersionId)) {
      throw new AiClientError("提示词模板版本不存在", { code: "NOT_FOUND" });
    }
    return this.createTask(input, { operation: "generate" });
  }

  async createResults(task) {
    if (task.resultIds.length) {
      return task;
    }
    const createdAt = iso(this.now());
    const results = [];
    const previewKeys = ["minimal", "narrative", "structural", "minimal", "narrative", "structural"];
    for (let index = 0; index < task.expectedCount; index += 1) {
      const directionIndex = task.operation === "refine"
        ? 1
        : Math.floor(index / Number(task.payload.imagesPerDirection || 1)) + 1;
      const imageIndex = task.operation === "refine"
        ? 1
        : index % Number(task.payload.imagesPerDirection || 1) + 1;
      const result = {
        id: id("result"),
        versionId: id("ai-version"),
        generationId: task.generationId,
        projectId: task.projectId,
        sourceTaskId: task.id,
        parentVersionId: task.parentVersionId,
        parentResultId: task.parentResultId,
        directionIndex,
        imageIndex,
        title: task.operation === "refine" ? "细化占位结果" : `方向 ${directionIndex} · 结果 ${imageIndex}`,
        status: "succeeded",
        imageUrl: null,
        previewKey: previewKeys[index % previewKeys.length],
        isDemoPlaceholder: true,
        modelSnapshot: clone(task.modelSnapshot),
        promptVersionId: task.promptVersionId,
        knowledgeRevisionIds: [...task.knowledgeRevisionIds],
        requirementRevisionId: task.requirementRevisionId,
        customerChangeRequest: text(task.payload.customerChangeRequest),
        createdAt,
      };
      await this.database.put("aiResults", result);
      results.push(result);
    }
    return {
      ...task,
      resultIds: results.map((item) => item.id),
      completedImages: results.map((item) => ({
        resultId: item.id,
        versionId: item.versionId,
        generationId: item.generationId,
        title: item.title,
        imageUrl: item.imageUrl,
        previewKey: item.previewKey,
        isDemoPlaceholder: true,
      })),
    };
  }

  async getTask(taskId) {
    let task = await this.database.get("aiTasks", taskId);
    if (!task) {
      throw new AiClientError("任务不存在", { code: "NOT_FOUND" });
    }
    if (TASK_TERMINAL_STATES.has(task.status)) {
      return task;
    }

    const nowMs = this.now();
    const age = nowMs - new Date(task.createdAt).getTime();
    if (task.status === "cancel_requested") {
      if (nowMs - new Date(task.cancelRequestedAt).getTime() >= 450) {
        task = {
          ...task,
          status: "cancelled",
          currentStep: "任务已取消",
          retryable: true,
          completedAt: iso(nowMs),
          updatedAt: iso(nowMs),
        };
      }
    } else if (age >= 3600) {
      task = await this.createResults(task);
      task = {
        ...task,
        status: "succeeded",
        currentStep: "本地合同演示完成",
        progress: 100,
        startedAt: task.startedAt || iso(new Date(task.createdAt).getTime() + 600),
        completedAt: iso(nowMs),
        updatedAt: iso(nowMs),
      };
    } else if (age >= 600) {
      const progress = Math.min(92, Math.max(task.progress, Math.round(((age - 600) / 3000) * 92)));
      const currentStep = progress < 30
        ? "校验需求与已审核知识"
        : progress < 65
          ? "编排提示词与任务快照"
          : "生成本地占位结果";
      task = {
        ...task,
        status: "running",
        currentStep,
        progress,
        startedAt: task.startedAt || iso(nowMs),
        updatedAt: iso(nowMs),
      };
    }

    await this.database.put("aiTasks", task);
    return task;
  }

  async cancelTask(taskId) {
    const task = await this.getTask(taskId);
    if (TASK_TERMINAL_STATES.has(task.status)) {
      return task;
    }
    const updated = {
      ...task,
      status: "cancel_requested",
      currentStep: "正在取消",
      cancelRequestedAt: iso(this.now()),
      updatedAt: iso(this.now()),
    };
    await this.database.put("aiTasks", updated);
    return updated;
  }

  async retryTask(taskId) {
    const task = await this.getTask(taskId);
    if (!new Set(["failed", "cancelled"]).has(task.status) || !task.retryable) {
      throw new AiClientError("当前任务状态不可重试", { code: "INVALID_TASK_STATE" });
    }
    return this.createTask({ ...task.payload, rootTaskId: task.rootTaskId }, {
      operation: task.operation,
      retryOfTaskId: task.id,
      retryOfGenerationId: task.generationId,
    });
  }

  async refineGeneration(generationId, input) {
    const result = await this.database.get("aiResults", input.selectedResultId);
    if (!result || result.generationId !== generationId) {
      throw new AiClientError("细化基线结果不存在", { code: "NOT_FOUND" });
    }
    if (input.parentVersionId !== result.versionId) {
      throw new AiClientError("父版本已经变化，请刷新版本关系后重试", {
        code: "STALE_PARENT_VERSION",
      });
    }
    return this.createTask({
      ...input,
      projectId: result.projectId,
      sourceGenerationId: generationId,
      requirementRevisionId: result.requirementRevisionId,
      promptVersionId: input.promptVersionId || result.promptVersionId,
      knowledgeRevisionIds: input.knowledgeRevisionIds ?? result.knowledgeRevisionIds,
      modelConfig: input.modelConfig,
    }, { operation: "refine" });
  }

  async submitResultFeedback(resultId, input) {
    const result = await this.database.get("aiResults", resultId);
    if (!result) {
      throw new AiClientError("反馈目标不存在", { code: "NOT_FOUND" });
    }
    const createdAt = iso(this.now());
    const feedback = {
      id: id("feedback"),
      resultId,
      projectId: result.projectId,
      versionId: result.versionId,
      role: input.role === "expert" ? "expert" : "customer",
      dimensions: clone(input.dimensions ?? {}),
      problemTags: list(input.problemTags),
      mustKeep: list(input.mustKeep),
      changeSuggestions: text(input.changeSuggestions),
      passed: Boolean(input.passed),
      qualitySampleCandidate: Boolean(input.qualitySampleCandidate),
      promotionStatus: "candidate_only",
      createdAt,
    };
    await this.database.put("aiFeedback", feedback);
    return {
      feedbackId: feedback.id,
      acceptedAt: createdAt,
      notice: "反馈仅已记录，不会自动训练、发布知识或晋升提示词。",
    };
  }

  async listProjectVersions(projectId) {
    const [results, feedback] = await Promise.all([
      this.database.getAll("aiResults"),
      this.database.getAll("aiFeedback"),
    ]);
    return results
      .filter((item) => item.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((result, index) => ({
        id: result.versionId,
        number: index + 1,
        projectId,
        generationId: result.generationId,
        sourceTaskId: result.sourceTaskId,
        parentVersionId: result.parentVersionId,
        resultIds: [result.id],
        selectedResultId: result.id,
        modelSnapshot: result.modelSnapshot,
        promptVersionId: result.promptVersionId,
        knowledgeRevisionIds: result.knowledgeRevisionIds,
        feedbackCount: feedback.filter((item) => item.resultId === result.id).length,
        isDemoPlaceholder: result.isDemoPlaceholder,
        createdAt: result.createdAt,
      }));
  }

  async listModels() {
    return clone(DEMO_MODELS);
  }

  async ensurePromptSeed() {
    const existing = await this.database.getAll("promptTemplates");
    if (existing.length) {
      return existing;
    }
    const createdAt = iso(this.now());
    const seed = {
      id: "prompt-demo-v1",
      scope: "gold-design",
      version: 1,
      name: "黄金设计沟通框架",
      content: "仅基于用户确认的结构化需求与已审核知识，输出彼此有明显差异的概念方向。保留缺失信息，不声称具备生产可行性。",
      changeNote: "本地合同演示初始模板",
      status: "official",
      testPassed: true,
      createdAt,
      publishedAt: createdAt,
    };
    await this.database.put("promptTemplates", seed);
    return [seed];
  }

  async listPromptTemplates() {
    const templates = await this.ensurePromptSeed();
    return [...templates].sort((left, right) => right.version - left.version);
  }

  async getPublishedPrompt() {
    return (await this.listPromptTemplates()).find((item) => item.status === "official") ?? null;
  }

  async createPromptVersion(input) {
    const templates = await this.listPromptTemplates();
    const createdAt = iso(this.now());
    const template = {
      id: id("prompt"),
      scope: "gold-design",
      version: Math.max(...templates.map((item) => item.version), 0) + 1,
      name: requireText(input.name, "模板名称"),
      content: requireText(input.content, "模板内容"),
      changeNote: requireText(input.changeNote, "变更说明"),
      status: "draft",
      testPassed: Boolean(input.testPassed),
      createdAt,
      publishedAt: null,
    };
    await this.database.put("promptTemplates", template);
    return template;
  }

  async comparePromptVersions(leftId, rightId) {
    const [left, right] = await Promise.all([
      this.database.get("promptTemplates", leftId),
      this.database.get("promptTemplates", rightId),
    ]);
    if (!left || !right) {
      throw new AiClientError("请选择两个存在的提示词版本", { code: "NOT_FOUND" });
    }
    return {
      left,
      right,
      changed: left.content !== right.content,
      summary: left.content === right.content ? "两个版本内容相同" : "模板内容存在差异，请人工逐项核对",
    };
  }

  async publishPromptVersion(versionId) {
    const templates = await this.listPromptTemplates();
    const target = templates.find((item) => item.id === versionId);
    if (!target) {
      throw new AiClientError("提示词版本不存在", { code: "NOT_FOUND" });
    }
    if (!target.testPassed) {
      throw new AiClientError("只有明确标记为测试通过的版本才能发布", { code: "REVIEW_REQUIRED" });
    }
    const publishedAt = iso(this.now());
    for (const template of templates) {
      const updated = template.id === target.id
        ? { ...template, status: "official", publishedAt }
        : template.status === "official"
          ? { ...template, status: "archived" }
          : template;
      await this.database.put("promptTemplates", updated);
    }
    return { ...target, status: "official", publishedAt };
  }

  async searchApprovedKnowledge(input) {
    const items = await this.getKnowledgeItems();
    const queryText = JSON.stringify(input ?? {}).toLowerCase();
    const queryTokens = list(input?.query || "").map((item) => item.toLowerCase());
    const approved = items.filter((item) => item.reviewStatus === "approved");
    return approved
      .map((item) => {
        const sourceContent = item.kind === "text" ? item.textContent : item.photo?.caption;
        const searchable = [item.title, item.category, sourceContent, item.tags?.join(" ")]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const score = queryTokens.reduce((total, token) => total + (searchable.includes(token) ? 1 : 0), 0)
          + (queryText.includes(item.category.toLowerCase()) ? 0.25 : 0);
        return {
          knowledgeId: item.id,
          knowledgeRevisionId: `${item.id}@${item.updatedAt}`,
          contentHash: fnvHash(`${item.id}:${item.updatedAt}:${sourceContent}`),
          title: item.title,
          category: item.category,
          excerpt: text(sourceContent).slice(0, 180),
          approvalStatus: "approved",
          approvedAt: item.reviewedAt,
          approvedBy: item.reviewer,
          sourceNote: item.sourceNote,
          source: { type: item.kind, sourceId: item.id },
          score,
        };
      })
      .filter((item) => queryTokens.length === 0 || item.score > 0)
      .sort((left, right) => right.score - left.score);
  }

  async listTasks(projectId = "") {
    const tasks = await this.database.getAll("aiTasks");
    return tasks
      .filter((task) => !projectId || task.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listResults(projectId = "") {
    const results = await this.database.getAll("aiResults");
    return results
      .filter((result) => !projectId || result.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}

export function isTaskTerminal(status) {
  return TASK_TERMINAL_STATES.has(status);
}
