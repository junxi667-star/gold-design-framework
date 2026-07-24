import { buildGoldImagePrompts } from "./gold-prompt-builder.js";
import { LocalRequirementParser } from "./requirement-parser.js";
import {
  apiError,
  clone,
  createId,
  iso,
  list,
  requireText,
  text,
} from "./utils.js";

const TASK_TERMINAL_STATES = new Set(["succeeded", "partial_succeeded", "failed", "cancelled"]);
const DIRECTION_TERMINAL_STATES = new Set(["succeeded", "partial_succeeded", "failed", "cancelled"]);
const REQUEST_TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);

const DEMO_MODEL = Object.freeze({
  id: "backend-contract-v1",
  provider: "local-demo",
  displayName: "本地流程演示模型（不生成真实图片）",
  status: "available",
  isDefault: true,
  isDemo: true,
  recommendedUse: "验证需求、三方向、任务、版本与反馈流程；结果是明确标注的占位卡片，不是 AI 生图。",
  capabilities: {
    operations: ["generate", "refine"],
    inputModalities: ["text", "image-reference"],
    maxReferenceImages: 6,
    aspectRatios: ["1:1", "4:5", "16:9"],
    outputCount: { min: 1, max: 12 },
    textToImage: false,
    imageToImage: false,
    inpainting: false,
  },
});

const COMFY_MODEL = Object.freeze({
  id: "local-comfyui-sdxl-base-refiner-v1",
  provider: "local-comfyui",
  displayName: "本地 ComfyUI · SDXL Base + Refiner",
  status: "unavailable",
  isDefault: false,
  isDemo: false,
  recommendedUse: "仅在本机 ComfyUI 健康检查通过后提供真实文生图；离线时不会伪装成功。",
  capabilities: {
    operations: ["generate"],
    inputModalities: ["text"],
    maxReferenceImages: 0,
    aspectRatios: ["1:1"],
    outputCount: { min: 1, max: 9 },
    textToImage: true,
    imageToImage: false,
    inpainting: false,
  },
});

const DEFAULT_DIRECTIONS = Object.freeze([
  {
    previewKey: "minimal",
    name: "现代留白",
    description: "以克制比例、清晰主元素和充足留白建立年轻、易佩戴的方向。",
  },
  {
    previewKey: "narrative",
    name: "文化叙事",
    description: "强化图案寓意和文化识别，同时控制装饰密度，避免符号堆叠。",
  },
  {
    previewKey: "structural",
    name: "结构创新",
    description: "从轮廓、连接和层次探索差异，仍以可佩戴结构和安全边缘为前提。",
  },
]);

function findPrompt(state, promptVersionId) {
  const requested = text(promptVersionId);
  const prompt = requested
    ? state.promptTemplates.find((item) => item.id === requested)
    : state.promptTemplates.find((item) => item.status === "official");
  if (!prompt) {
    throw apiError("提示词模板版本不存在", {
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  }
  return prompt;
}

function modelForId(modelId) {
  if (modelId === COMFY_MODEL.id) return COMFY_MODEL;
  if ([DEMO_MODEL.id, "demo-concept-v1", "demo-refine-v1"].includes(modelId)) return DEMO_MODEL;
  throw apiError("所选模型不存在或不支持当前操作", {
    code: "UNSUPPORTED_MODEL_CAPABILITY",
    httpStatus: 400,
  });
}

function normalizedCount(value, fallback, minimum, maximum, label) {
  const count = Number(value ?? fallback);
  if (!Number.isInteger(count) || count < minimum || count > maximum) {
    throw apiError(`${label}必须是 ${minimum}–${maximum} 的整数`, {
      code: "VALIDATION_FAILED",
      httpStatus: 400,
    });
  }
  return count;
}

function hasRequirementContent(requirement) {
  return Boolean(
    text(requirement?.productType)
    || text(requirement?.goldType)
    || text(requirement?.style)
    || text(requirement?.targetAudience)
    || text(requirement?.usageScenario)
    || list(requirement?.motifs).length
    || list(requirement?.mustKeep).length
    || list(requirement?.mustAvoid).length,
  );
}

function normalizeRequirementSnapshot(source = {}) {
  return {
    productType: text(source.productType),
    goldType: text(source.goldType),
    style: text(source.style),
    targetAudience: text(source.targetAudience),
    usageScenario: text(source.usageScenario),
    motifs: list(source.motifs),
    weightOrBudget: text(source.weightOrBudget),
    craftRequirements: list(source.craftRequirements),
    mustKeep: list(source.mustKeep),
    mustAvoid: list(source.mustAvoid),
    taskType: text(source.taskType) || "new_design",
  };
}

function directionBlueprints(payload, directionCount, imagesPerDirection, operation) {
  if (operation === "refine") {
    return [{
      name: "细化方案",
      description: "仅针对已选择父版本执行本轮修改，保留项和修改项分别记录。",
      previewKey: "structural",
      expectedImageCount: 1,
      sourceDirectionId: payload.sourceDirectionId || null,
    }];
  }
  const supplied = Array.isArray(payload.directions)
    ? payload.directions
    : Array.isArray(payload.designDirections)
      ? payload.designDirections
      : [];
  return Array.from({ length: directionCount }, (_, index) => {
    const fallback = DEFAULT_DIRECTIONS[index % DEFAULT_DIRECTIONS.length];
    const value = supplied[index] && typeof supplied[index] === "object" ? supplied[index] : {};
    return {
      name: text(value.name || value.directionName) || (index < DEFAULT_DIRECTIONS.length
        ? fallback.name
        : `探索方向 ${index + 1}`),
      description: text(value.description || value.directionDescription) || fallback.description,
      previewKey: text(value.previewKey) || fallback.previewKey,
      promptAddon: text(value.promptAddon),
      expectedImageCount: normalizedCount(
        value.expectedImageCount,
        imagesPerDirection,
        1,
        4,
        "每方向图片数量",
      ),
      sourceDirectionId: text(value.sourceDirectionId) || null,
    };
  });
}

function newDirection(blueprint, index, model, nowMs, attempt = 1) {
  return {
    id: createId("direction"),
    index: index + 1,
    name: blueprint.name,
    description: blueprint.description,
    previewKey: blueprint.previewKey,
    promptAddon: blueprint.promptAddon || "",
    sourceDirectionId: blueprint.sourceDirectionId || null,
    status: "queued",
    currentStep: "等待处理",
    progress: 0,
    expectedImageCount: blueprint.expectedImageCount,
    completedImages: [],
    resultIds: [],
    providerRequests: [],
    model: model.displayName,
    modelSnapshot: clone(model),
    attempt,
    retryable: false,
    error: null,
    failureReason: null,
    createdAt: iso(nowMs),
    startedAt: null,
    completedAt: null,
    elapsedMs: null,
  };
}

function aggregateDirection(direction, nowMs) {
  if (direction.modelSnapshot?.provider === "local-demo") {
    direction.retryable = ["failed", "cancelled", "partial_succeeded"].includes(direction.status);
    if (direction.startedAt) {
      const end = direction.completedAt ? new Date(direction.completedAt).getTime() : nowMs;
      direction.elapsedMs = Math.max(0, end - new Date(direction.startedAt).getTime());
    }
    return direction;
  }

  const requests = direction.providerRequests || [];
  const succeeded = requests.filter((item) => item.status === "succeeded").length;
  const failed = requests.filter((item) => item.status === "failed").length;
  const cancelled = requests.filter((item) => item.status === "cancelled").length;
  const running = requests.filter((item) => ["queued", "running"].includes(item.status)).length;
  const total = Math.max(requests.length, direction.expectedImageCount || 1);
  const workUnits = succeeded + failed + cancelled + running * 0.4;
  direction.progress = Math.min(100, Math.round((workUnits / total) * 100));

  if (running) {
    direction.status = "running";
    direction.currentStep = "本地 ComfyUI 正在生成此方向";
    direction.retryable = false;
  } else if (succeeded === total) {
    direction.status = "succeeded";
    direction.currentStep = "方向生成完成";
    direction.progress = 100;
    direction.retryable = false;
  } else if (succeeded > 0) {
    direction.status = "partial_succeeded";
    direction.currentStep = "方向部分成功，可仅重试失败部分";
    direction.progress = 100;
    direction.retryable = true;
  } else if (cancelled === total) {
    direction.status = "cancelled";
    direction.currentStep = "方向已取消";
    direction.progress = 100;
    direction.retryable = true;
  } else {
    direction.status = "failed";
    direction.currentStep = "方向生成失败";
    direction.progress = 100;
    direction.retryable = true;
  }

  const firstFailure = requests.find((item) => item.error);
  direction.error = firstFailure?.error || null;
  direction.failureReason = direction.error?.message || null;
  if (DIRECTION_TERMINAL_STATES.has(direction.status) && !direction.completedAt) {
    direction.completedAt = iso(nowMs);
  }
  if (direction.startedAt) {
    const end = direction.completedAt ? new Date(direction.completedAt).getTime() : nowMs;
    direction.elapsedMs = Math.max(0, end - new Date(direction.startedAt).getTime());
  }
  return direction;
}

function aggregateTask(task, nowMs) {
  for (const direction of task.directions) aggregateDirection(direction, nowMs);
  task.completedImages = task.directions.flatMap((direction) => (
    direction.completedImages.map((image) => ({
      ...image,
      directionId: direction.id,
      directionName: direction.name,
      directionDescription: direction.description,
      directionStatus: direction.status,
      model: direction.model,
      elapsedMs: direction.elapsedMs,
      failureReason: direction.failureReason,
    }))
  ));
  task.resultIds = task.directions.flatMap((direction) => direction.resultIds);
  task.expectedCount = task.directions.reduce((total, direction) => total + direction.expectedImageCount, 0);
  task.progress = task.directions.length
    ? Math.round(task.directions.reduce((sum, direction) => sum + direction.progress, 0) / task.directions.length)
    : 0;

  const succeeded = task.directions.filter((direction) => direction.status === "succeeded").length;
  const partial = task.directions.filter((direction) => direction.status === "partial_succeeded").length;
  const failed = task.directions.filter((direction) => direction.status === "failed").length;
  const cancelled = task.directions.filter((direction) => direction.status === "cancelled").length;
  const terminalCount = succeeded + partial + failed + cancelled;
  const hasOutput = task.completedImages.length > 0;

  if (terminalCount < task.directions.length) {
    task.status = task.directions.some((direction) => direction.status === "running") ? "running" : "queued";
    task.currentStep = task.status === "running" ? "正在处理多个设计方向" : "任务排队中";
    task.retryable = false;
  } else if (succeeded === task.directions.length) {
    task.status = "succeeded";
    task.currentStep = "所有设计方向均已完成";
    task.progress = 100;
    task.retryable = false;
  } else if (hasOutput) {
    task.status = "partial_succeeded";
    task.currentStep = "部分方向成功；失败方向可单独重试";
    task.progress = 100;
    task.retryable = true;
  } else if (cancelled === task.directions.length) {
    task.status = "cancelled";
    task.currentStep = "任务已取消";
    task.progress = 100;
    task.retryable = true;
  } else {
    task.status = "failed";
    task.currentStep = "所有设计方向均失败";
    task.progress = 100;
    task.retryable = true;
  }

  task.error = task.status === "failed"
    ? {
      code: "ALL_DIRECTIONS_FAILED",
      message: "所有设计方向均失败，请查看各方向失败原因后重试。",
    }
    : null;
  task.partialFailureCount = failed + cancelled + partial;
  if (TASK_TERMINAL_STATES.has(task.status)) {
    task.completedAt = task.completedAt || iso(nowMs);
  }
  task.updatedAt = iso(nowMs);
  return task;
}

export class GoldAiService {
  constructor(store, {
    provider,
    now = () => Date.now(),
    requirementParser,
    demoCompletionMs = 500,
  } = {}) {
    this.store = store;
    this.provider = provider;
    this.now = now;
    this.requirementParser = requirementParser ?? new LocalRequirementParser();
    this.demoCompletionMs = demoCompletionMs;
    this.taskLocks = new Map();
  }

  async getProviderStatus() {
    if (!this.provider?.healthCheck) {
      return {
        provider: "local-comfyui",
        configured: false,
        reachable: false,
        error: {
          code: "COMFYUI_NOT_CONFIGURED",
          message: "本地 ComfyUI Provider 未配置",
        },
      };
    }
    return this.provider.healthCheck();
  }

  async getCapabilities() {
    const providerStatus = await this.getProviderStatus();
    const parserStatus = this.requirementParser.getStatus();
    const providerReady = Boolean(providerStatus.ready ?? providerStatus.reachable);
    return {
      backendApi: true,
      contractVersion: "1.2",
      requirementParsing: "local_rule_demo",
      requirementParserVersion: parserStatus.parserVersion,
      imageGeneration: providerReady
        ? "local_comfyui_or_explicit_placeholder_demo"
        : "explicit_placeholder_demo_only",
      realImageGenerationAvailable: providerReady,
      imageRefinement: "placeholder_demo_only",
      promptVersioning: true,
      knowledgeRetrieval: "empty_approved_only",
      trainingEnabled: false,
      provider: {
        configured: Boolean(providerStatus.configured),
        reachable: Boolean(providerStatus.reachable),
        ready: providerReady,
      },
    };
  }

  async listModels() {
    const providerStatus = await this.getProviderStatus();
    const providerReady = Boolean(providerStatus.ready ?? providerStatus.reachable);
    return [
      clone(DEMO_MODEL),
      {
        ...clone(COMFY_MODEL),
        status: providerReady ? "available" : "unavailable",
        availabilityReason: providerReady
          ? "本机 ComfyUI、所需模型和工作流检查通过"
          : providerStatus.error?.message || "本机 ComfyUI 当前未就绪",
      },
    ];
  }

  getRequirementParserStatus() {
    return this.requirementParser.getStatus();
  }

  getRequirementSchema() {
    return this.requirementParser.getSchema();
  }

  getRequirementEvaluationCases() {
    return this.requirementParser.getEvaluationCases();
  }

  evaluateRequirementParser(input) {
    return this.requirementParser.evaluate(input);
  }

  parseRequirements(input) {
    return this.requirementParser.parse(input);
  }

  async getIdempotencyRecord(key) {
    const state = await this.store.read();
    return clone(state.idempotency[key] || null);
  }

  saveIdempotencyRecord(key, record) {
    return this.store.update((state) => {
      if (!state.idempotency[key]) state.idempotency[key] = clone(record);
      const entries = Object.entries(state.idempotency);
      if (entries.length > 1000) {
        entries
          .sort((left, right) => String(left[1]?.createdAt).localeCompare(String(right[1]?.createdAt)))
          .slice(0, entries.length - 1000)
          .forEach(([oldKey]) => delete state.idempotency[oldKey]);
      }
      return state.idempotency[key];
    });
  }

  resolveRequirement(state, projectId, payload) {
    const revisionId = text(payload.requirementRevisionId);
    const persisted = revisionId
      ? state.requirements.find((item) => item.id === revisionId && item.projectId === projectId)
      : null;
    if (persisted) {
      if (persisted.status !== "confirmed") {
        throw apiError("只有人工确认后的需求版本才能创建生成任务", {
          code: "REQUIREMENT_NOT_CONFIRMED",
          httpStatus: 409,
        });
      }
      return {
        snapshot: normalizeRequirementSnapshot(persisted),
        source: "persisted_confirmed_revision",
        revisionId: persisted.id,
      };
    }

    const inline = payload.structuredRequirements || payload.structuredRequirement;
    if (inline && hasRequirementContent(inline)) {
      return {
        snapshot: normalizeRequirementSnapshot(inline),
        source: "legacy_client_confirmed_inline",
        revisionId: revisionId || null,
      };
    }
    if (revisionId) {
      throw apiError("需求版本不存在，且请求未携带旧前端兼容的已确认结构化需求", {
        code: "REQUIREMENT_NOT_FOUND",
        httpStatus: 404,
      });
    }
    throw apiError("创建生成任务前必须提供已确认需求", {
      code: "REQUIREMENT_NOT_CONFIRMED",
      httpStatus: 409,
    });
  }

  async createTask(payload = {}, {
    operation = "generate",
    retryOfTaskId = null,
    retryOfGenerationId = null,
    blueprints = null,
    attempt = 1,
  } = {}) {
    const projectId = requireText(payload.projectId, "项目 ID");
    const modelId = payload.modelConfig?.modelId || payload.modelId || DEMO_MODEL.id;
    const model = modelForId(modelId);
    if (!model.capabilities.operations.includes(operation)) {
      throw apiError("所选模型不支持当前操作", {
        code: "UNSUPPORTED_MODEL_CAPABILITY",
        httpStatus: 400,
      });
    }
    const state = await this.store.read();
    const prompt = findPrompt(state, payload.promptVersionId);
    const requirement = this.resolveRequirement(state, projectId, payload);
    const referenceImages = Array.isArray(payload.referenceImages) ? payload.referenceImages : [];
    if (referenceImages.length > model.capabilities.maxReferenceImages) {
      throw apiError(`所选模型最多接收 ${model.capabilities.maxReferenceImages} 张参考图片`, {
        code: "VALIDATION_FAILED",
        httpStatus: 400,
      });
    }
    if (list(payload.knowledgeRevisionIds).length) {
      throw apiError("已审核知识库尚未接入后端生成链路，请取消知识引用后重试", {
        code: "KNOWLEDGE_BACKEND_NOT_CONNECTED",
        httpStatus: 409,
      });
    }

    const directionCount = operation === "refine"
      ? 1
      : normalizedCount(payload.directionCount, 3, 1, 6, "设计方向数量");
    const imagesPerDirection = operation === "refine"
      ? 1
      : normalizedCount(payload.imagesPerDirection, 1, 1, 4, "每方向图片数量");
    const resolvedBlueprints = blueprints
      || directionBlueprints(payload, directionCount, imagesPerDirection, operation);
    const expectedCount = resolvedBlueprints.reduce((sum, item) => sum + item.expectedImageCount, 0);
    if (expectedCount < model.capabilities.outputCount.min || expectedCount > model.capabilities.outputCount.max) {
      throw apiError(`所选模型单次支持 ${model.capabilities.outputCount.min}–${model.capabilities.outputCount.max} 个结果`, {
        code: "VALIDATION_FAILED",
        httpStatus: 400,
      });
    }

    if (model.provider === "local-comfyui") {
      const providerStatus = await this.getProviderStatus();
      const providerReady = Boolean(providerStatus.ready ?? providerStatus.reachable);
      if (!providerReady) {
        throw apiError("本机 ComfyUI 当前不可用，未创建真实生图任务；可启动 ComfyUI 后重试，或明确选择 DEMO 模型查看流程。", {
          code: providerStatus.error?.code || "COMFYUI_UNAVAILABLE",
          httpStatus: 503,
          retryable: true,
          details: {
            provider: providerStatus.provider,
            reachable: Boolean(providerStatus.reachable),
            ready: providerReady,
            missingCheckpoints: providerStatus.missingCheckpoints || [],
          },
        });
      }
    }

    const nowMs = this.now();
    const task = {
      id: createId("task"),
      generationId: createId("generation"),
      projectId,
      operation,
      status: "queued",
      currentStep: "等待任务开始",
      progress: 0,
      expectedCount,
      completedImages: [],
      resultIds: [],
      directions: resolvedBlueprints.map((item, index) => newDirection(item, index, model, nowMs, attempt)),
      error: null,
      retryable: false,
      retryOfTaskId,
      retryOfGenerationId,
      rootTaskId: retryOfTaskId ? (payload.rootTaskId || retryOfTaskId) : null,
      modelSnapshot: clone(model),
      promptVersionId: prompt.id,
      knowledgeRevisionIds: [],
      requirementRevisionId: requirement.revisionId,
      requirementSource: requirement.source,
      requirementSnapshot: clone(requirement.snapshot),
      parentVersionId: payload.parentVersionId || null,
      parentResultId: payload.selectedResultId || null,
      sourceGenerationId: payload.sourceGenerationId || null,
      payload: clone(payload),
      createdAt: iso(nowMs),
      startedAt: null,
      completedAt: null,
      updatedAt: iso(nowMs),
      cancelRequestedAt: null,
    };
    task.rootTaskId = task.rootTaskId || task.id;

    if (model.provider === "local-comfyui") {
      task.status = "running";
      task.startedAt = iso(nowMs);
      for (const direction of task.directions) {
        direction.status = "running";
        direction.currentStep = "正在提交本地 ComfyUI";
        direction.startedAt = iso(nowMs);
        const prompts = buildGoldImagePrompts(task.requirementSnapshot, {
          promptTemplate: prompt,
          direction,
          payload,
        });
        for (let imageIndex = 1; imageIndex <= direction.expectedImageCount; imageIndex += 1) {
          const request = {
            id: createId("provider-request"),
            imageIndex,
            status: "queued",
            providerRequestId: null,
            parameters: null,
            promptSnapshot: clone(prompts),
            resultId: null,
            error: null,
            createdAt: iso(nowMs),
            completedAt: null,
          };
          try {
            const baseSeed = Number(payload.modelConfig?.seed ?? payload.seed ?? 123456);
            const submitted = await this.provider.submitGeneration({
              positivePrompt: prompts.positivePrompt,
              negativePrompt: prompts.negativePrompt,
              width: Number(payload.modelConfig?.width ?? payload.width ?? 1024),
              height: Number(payload.modelConfig?.height ?? payload.height ?? 1024),
              seed: baseSeed + direction.index * 1000 + imageIndex,
              steps: Number(payload.modelConfig?.steps ?? payload.steps ?? 25),
              cfg: Number(payload.modelConfig?.cfg ?? payload.cfg ?? 7),
              sampler: text(payload.modelConfig?.sampler) || "euler",
              scheduler: text(payload.modelConfig?.scheduler) || "normal",
              filenamePrefix: `gold_ai_${task.id}_${direction.index}_${imageIndex}`,
            });
            Object.assign(request, {
              status: "running",
              providerRequestId: submitted.promptId,
              providerClientId: submitted.clientId,
              providerQueueNumber: submitted.queueNumber,
              parameters: clone(submitted.parameters),
            });
          } catch (error) {
            Object.assign(request, {
              status: "failed",
              error: {
                code: error.code || "COMFYUI_SUBMIT_FAILED",
                message: error.message || "ComfyUI 提交失败",
                retryable: error.retryable !== false,
              },
              completedAt: iso(this.now()),
            });
          }
          direction.providerRequests.push(request);
        }
      }
      aggregateTask(task, this.now());
    }

    await this.store.update((next) => {
      next.tasks.push(task);
      return task;
    });
    return {
      taskId: task.id,
      generationId: task.generationId,
      status: task.status,
      expectedCount: task.expectedCount,
      directions: task.directions.map((direction) => ({
        id: direction.id,
        name: direction.name,
        description: direction.description,
        status: direction.status,
      })),
      retryOfTaskId,
    };
  }

  createGeneration(input) {
    return this.createTask(input, { operation: "generate" });
  }

  async completeDemoTask(taskId) {
    return this.store.update((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task || TASK_TERMINAL_STATES.has(task.status)) return task;
      const completedAtMs = this.now();
      for (const direction of task.directions) {
        if (DIRECTION_TERMINAL_STATES.has(direction.status)) continue;
        direction.status = "succeeded";
        direction.currentStep = "本地方向占位演示完成";
        direction.progress = 100;
        direction.startedAt = direction.startedAt || task.startedAt || iso(completedAtMs);
        direction.completedAt = iso(completedAtMs);
        direction.elapsedMs = Math.max(0, completedAtMs - new Date(direction.startedAt).getTime());
        for (let index = 1; index <= direction.expectedImageCount; index += 1) {
          const result = {
            id: createId("result"),
            versionId: createId("ai-version"),
            generationId: task.generationId,
            projectId: task.projectId,
            sourceTaskId: task.id,
            parentVersionId: task.parentVersionId,
            parentResultId: task.parentResultId,
            directionId: direction.id,
            directionIndex: direction.index,
            directionName: direction.name,
            directionDescription: direction.description,
            imageIndex: index,
            title: `${direction.name} · 演示方案 ${index}`,
            status: "succeeded",
            imageUrl: null,
            previewKey: direction.previewKey,
            isDemoPlaceholder: true,
            provider: "local-demo",
            modelSnapshot: clone(task.modelSnapshot),
            promptVersionId: task.promptVersionId,
            knowledgeRevisionIds: [],
            requirementRevisionId: task.requirementRevisionId,
            customerChangeRequest: text(task.payload.customerChangeRequest),
            latencyMs: direction.elapsedMs,
            createdAt: iso(completedAtMs),
          };
          state.results.push(result);
          direction.resultIds.push(result.id);
          direction.completedImages.push({
            id: result.id,
            resultId: result.id,
            versionId: result.versionId,
            generationId: result.generationId,
            title: result.title,
            status: result.status,
            imageUrl: null,
            previewKey: result.previewKey,
            isDemoPlaceholder: true,
          });
        }
      }
      return aggregateTask(task, completedAtMs);
    });
  }

  async refreshDemoTask(task) {
    const nowMs = this.now();
    const ageMs = nowMs - new Date(task.createdAt).getTime();
    if (ageMs >= this.demoCompletionMs) {
      return this.completeDemoTask(task.id);
    }
    return this.store.update((state) => {
      const current = state.tasks.find((item) => item.id === task.id);
      if (!current || TASK_TERMINAL_STATES.has(current.status)) return current;
      current.status = "running";
      current.startedAt = current.startedAt || iso(nowMs);
      current.currentStep = "正在建立三个明确命名的本地演示方向";
      current.progress = Math.max(10, Math.min(90, Math.round((ageMs / this.demoCompletionMs) * 90)));
      current.updatedAt = iso(nowMs);
      for (const direction of current.directions) {
        direction.status = "running";
        direction.startedAt = direction.startedAt || current.startedAt;
        direction.currentStep = "正在生成本地占位卡片";
        direction.progress = current.progress;
      }
      return current;
    });
  }

  async completeProviderRequest(taskId, directionId, requestId, providerStatus) {
    let archived;
    try {
      const task = (await this.store.read()).tasks.find((item) => item.id === taskId);
      const direction = task?.directions.find((item) => item.id === directionId);
      const request = direction?.providerRequests.find((item) => item.id === requestId);
      if (!task || !direction || !request || REQUEST_TERMINAL_STATES.has(request.status)) return;
      if (!providerStatus.images?.length) {
        throw apiError("ComfyUI 没有返回图片", {
          code: "COMFYUI_NO_OUTPUT",
          httpStatus: 502,
          retryable: true,
        });
      }
      archived = await this.provider.archiveImage(providerStatus.images[0], {
        taskId,
        directionId,
        index: request.imageIndex,
      });
    } catch (error) {
      await this.failProviderRequest(taskId, directionId, requestId, error);
      return;
    }

    await this.store.update((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      const direction = task?.directions.find((item) => item.id === directionId);
      const request = direction?.providerRequests.find((item) => item.id === requestId);
      if (!task || !direction || !request || REQUEST_TERMINAL_STATES.has(request.status)) return task;
      const completedAtMs = this.now();
      const result = {
        id: createId("result"),
        versionId: createId("ai-version"),
        generationId: task.generationId,
        projectId: task.projectId,
        sourceTaskId: task.id,
        parentVersionId: task.parentVersionId,
        parentResultId: task.parentResultId,
        directionId: direction.id,
        directionIndex: direction.index,
        directionName: direction.name,
        directionDescription: direction.description,
        imageIndex: request.imageIndex,
        title: `${direction.name} · 生成结果 ${request.imageIndex}`,
        status: "succeeded",
        imageUrl: archived.imageUrl,
        imageAsset: {
          filename: archived.filename,
          mimeType: archived.mimeType,
          sizeBytes: archived.sizeBytes,
          sha256: archived.sha256,
        },
        isDemoPlaceholder: false,
        provider: "local-comfyui",
        providerRequestId: request.providerRequestId,
        modelSnapshot: clone(task.modelSnapshot),
        promptVersionId: task.promptVersionId,
        promptSnapshot: clone(request.promptSnapshot),
        parameters: clone(request.parameters),
        workflowVersion: "sdxl-base-refiner-gold-v1",
        knowledgeRevisionIds: [],
        requirementRevisionId: task.requirementRevisionId,
        customerChangeRequest: "",
        latencyMs: completedAtMs - new Date(direction.startedAt || task.startedAt).getTime(),
        estimatedCost: 0,
        createdAt: iso(completedAtMs),
      };
      state.results.push(result);
      request.status = "succeeded";
      request.resultId = result.id;
      request.completedAt = iso(completedAtMs);
      request.error = null;
      direction.resultIds.push(result.id);
      direction.completedImages.push({
        id: result.id,
        resultId: result.id,
        versionId: result.versionId,
        generationId: result.generationId,
        title: result.title,
        status: result.status,
        imageUrl: result.imageUrl,
        isDemoPlaceholder: false,
      });
      return aggregateTask(task, completedAtMs);
    });
  }

  failProviderRequest(taskId, directionId, requestId, error) {
    return this.store.update((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      const direction = task?.directions.find((item) => item.id === directionId);
      const request = direction?.providerRequests.find((item) => item.id === requestId);
      if (!task || !direction || !request || REQUEST_TERMINAL_STATES.has(request.status)) return task;
      const failedAtMs = this.now();
      request.status = "failed";
      request.completedAt = iso(failedAtMs);
      request.error = {
        code: error?.code || "COMFYUI_EXECUTION_FAILED",
        message: error?.message || "ComfyUI 执行失败",
        retryable: error?.retryable !== false,
        details: error?.details || null,
      };
      return aggregateTask(task, failedAtMs);
    });
  }

  async refreshComfyTaskUnlocked(taskId) {
    let task = (await this.store.read()).tasks.find((item) => item.id === taskId);
    if (!task) {
      throw apiError("任务不存在", { code: "NOT_FOUND", httpStatus: 404 });
    }
    if (TASK_TERMINAL_STATES.has(task.status)) return task;
    for (const direction of task.directions) {
      for (const request of direction.providerRequests) {
        if (REQUEST_TERMINAL_STATES.has(request.status)) continue;
        let providerStatus;
        try {
          providerStatus = await this.provider.getPromptStatus(request.providerRequestId);
        } catch (error) {
          await this.failProviderRequest(taskId, direction.id, request.id, error);
          continue;
        }
        if (providerStatus.status === "completed") {
          await this.completeProviderRequest(taskId, direction.id, request.id, providerStatus);
        } else if (providerStatus.status === "failed") {
          await this.failProviderRequest(
            taskId,
            direction.id,
            request.id,
            apiError(providerStatus.error?.message || "ComfyUI 执行失败", {
              code: providerStatus.error?.code || "COMFYUI_EXECUTION_FAILED",
              httpStatus: 502,
              retryable: true,
              details: providerStatus.error?.details || null,
            }),
          );
        } else {
          await this.store.update((state) => {
            const current = state.tasks.find((item) => item.id === taskId);
            const currentDirection = current?.directions.find((item) => item.id === direction.id);
            const currentRequest = currentDirection?.providerRequests.find((item) => item.id === request.id);
            if (currentRequest && !REQUEST_TERMINAL_STATES.has(currentRequest.status)) {
              currentRequest.status = "running";
              aggregateTask(current, this.now());
            }
            return current;
          });
        }
      }
    }
    task = (await this.store.read()).tasks.find((item) => item.id === taskId);
    return task;
  }

  async refreshComfyTask(taskId) {
    if (this.taskLocks.has(taskId)) return this.taskLocks.get(taskId);
    const operation = this.refreshComfyTaskUnlocked(taskId)
      .finally(() => this.taskLocks.delete(taskId));
    this.taskLocks.set(taskId, operation);
    return operation;
  }

  async getTask(taskId) {
    const state = await this.store.read();
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw apiError("任务不存在", { code: "NOT_FOUND", httpStatus: 404 });
    }
    if (TASK_TERMINAL_STATES.has(task.status)) return task;
    if (task.modelSnapshot?.provider === "local-comfyui") {
      return this.refreshComfyTask(taskId);
    }
    return this.refreshDemoTask(task);
  }

  async cancelTask(taskId) {
    const task = await this.getTask(taskId);
    if (TASK_TERMINAL_STATES.has(task.status)) return task;
    if (task.modelSnapshot?.provider === "local-comfyui") {
      for (const direction of task.directions) {
        for (const request of direction.providerRequests) {
          if (!REQUEST_TERMINAL_STATES.has(request.status)) {
            await this.provider.cancel(request.providerRequestId);
          }
        }
      }
    }
    return this.store.update((state) => {
      const current = state.tasks.find((item) => item.id === taskId);
      const nowMs = this.now();
      for (const direction of current.directions) {
        if (DIRECTION_TERMINAL_STATES.has(direction.status)) continue;
        for (const request of direction.providerRequests || []) {
          if (!REQUEST_TERMINAL_STATES.has(request.status)) {
            request.status = "cancelled";
            request.completedAt = iso(nowMs);
          }
        }
        direction.status = "cancelled";
        direction.currentStep = "方向已取消";
        direction.progress = 100;
        direction.retryable = true;
        direction.completedAt = iso(nowMs);
      }
      return aggregateTask(current, nowMs);
    });
  }

  async retryTask(taskId, input = {}) {
    const task = await this.getTask(taskId);
    if (!["failed", "cancelled", "partial_succeeded"].includes(task.status) || !task.retryable) {
      throw apiError("当前任务没有可重试的失败方向", {
        code: "INVALID_TASK_STATE",
        httpStatus: 409,
      });
    }
    const requestedIds = list(input.directionIds);
    if (text(input.directionId)) requestedIds.push(text(input.directionId));
    const eligible = task.directions.filter((direction) => (
      ["failed", "cancelled", "partial_succeeded"].includes(direction.status)
      && (!requestedIds.length || requestedIds.includes(direction.id))
    ));
    if (!eligible.length) {
      throw apiError("指定方向不存在或不是可重试状态", {
        code: "DIRECTION_NOT_RETRYABLE",
        httpStatus: 409,
        details: { requestedDirectionIds: requestedIds },
      });
    }
    if (requestedIds.some((id) => !task.directions.some((direction) => direction.id === id))) {
      throw apiError("指定方向不属于当前任务", {
        code: "DIRECTION_NOT_FOUND",
        httpStatus: 404,
      });
    }

    const blueprints = eligible.map((direction) => {
      const failedRequestCount = (direction.providerRequests || [])
        .filter((request) => ["failed", "cancelled"].includes(request.status)).length;
      return {
        name: direction.name,
        description: direction.description,
        previewKey: direction.previewKey,
        promptAddon: direction.promptAddon,
        expectedImageCount: Math.max(1, failedRequestCount || direction.expectedImageCount),
        sourceDirectionId: direction.id,
      };
    });
    const payload = {
      ...clone(task.payload),
      projectId: task.projectId,
      requirementRevisionId: task.requirementRevisionId,
      structuredRequirements: clone(task.requirementSnapshot),
      promptVersionId: task.promptVersionId,
      modelConfig: { ...(task.payload.modelConfig || {}), modelId: task.modelSnapshot.id },
      rootTaskId: task.rootTaskId,
      directionCount: blueprints.length,
      imagesPerDirection: 1,
      referenceImages: [],
      knowledgeRevisionIds: [],
    };
    const receipt = await this.createTask(payload, {
      operation: task.operation,
      retryOfTaskId: task.id,
      retryOfGenerationId: task.generationId,
      blueprints,
      attempt: Math.max(...eligible.map((direction) => direction.attempt || 1)) + 1,
    });
    return {
      ...receipt,
      retriedDirectionIds: eligible.map((direction) => direction.id),
      preservedSuccessfulDirectionIds: task.directions
        .filter((direction) => direction.status === "succeeded")
        .map((direction) => direction.id),
    };
  }

  async refineGeneration(generationId, input = {}) {
    const state = await this.store.read();
    const result = state.results.find(
      (item) => item.id === input.selectedResultId && item.generationId === generationId,
    );
    if (!result) {
      throw apiError("细化基线结果不存在", { code: "NOT_FOUND", httpStatus: 404 });
    }
    if (input.parentVersionId && input.parentVersionId !== result.versionId) {
      throw apiError("父版本已经变化，请刷新版本关系后重试", {
        code: "STALE_PARENT_VERSION",
        httpStatus: 409,
      });
    }
    return this.createTask({
      ...input,
      projectId: result.projectId,
      sourceGenerationId: generationId,
      requirementRevisionId: result.requirementRevisionId,
      structuredRequirements: state.tasks.find((task) => task.id === result.sourceTaskId)?.requirementSnapshot,
      promptVersionId: input.promptVersionId || result.promptVersionId,
      knowledgeRevisionIds: [],
      selectedResultId: result.id,
      parentVersionId: result.versionId,
      modelConfig: input.modelConfig || { modelId: DEMO_MODEL.id },
    }, { operation: "refine" });
  }

  submitFeedback(resultId, input = {}) {
    return this.store.update((state) => {
      const result = state.results.find((item) => item.id === resultId);
      if (!result) {
        throw apiError("反馈目标不存在", { code: "NOT_FOUND", httpStatus: 404 });
      }
      const createdAt = iso(this.now());
      const feedback = {
        id: createId("feedback"),
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
      state.feedback.push(feedback);
      return {
        feedbackId: feedback.id,
        acceptedAt: createdAt,
        notice: "反馈只保存在本机后端，不会自动训练、发布知识或晋升提示词。",
      };
    });
  }

  createRequirementRevision(projectId, input = {}) {
    return this.store.update((state) => {
      const normalizedProjectId = requireText(projectId, "项目 ID");
      const source = input.structuredRequirement && typeof input.structuredRequirement === "object"
        ? input.structuredRequirement
        : input;
      const snapshot = normalizeRequirementSnapshot(source);
      if (!text(input.customerText) && !hasRequirementContent(snapshot)) {
        throw apiError("客户原话或结构化需求至少填写一项", {
          code: "VALIDATION_FAILED",
          httpStatus: 400,
        });
      }
      const createdAt = iso(this.now());
      const requirement = {
        id: createId("requirement"),
        projectId: normalizedProjectId,
        version: state.requirements.filter((item) => item.projectId === normalizedProjectId).length + 1,
        sourceRequirementRevisionId: text(input.sourceRequirementRevisionId || input.requirementRevisionId),
        customerText: text(input.customerText),
        ...snapshot,
        missingFields: list(input.missingFields ?? source.missingFields),
        clarificationQuestions: list(input.clarificationQuestions ?? source.clarificationQuestions),
        referenceAssetIds: list(input.referenceAssetIds ?? source.referenceAssetIds),
        understandingSummary: text(input.understandingSummary ?? source.understandingSummary),
        analysisMode: text(input.analysisMode ?? source.analysisMode),
        parserVersion: text(input.parserVersion ?? source.parserVersion),
        warnings: list(input.warnings ?? source.warnings),
        status: "needs_confirmation",
        createdBy: text(input.createdBy) || "local-user",
        confirmedBy: null,
        createdAt,
        confirmedAt: null,
      };
      state.requirements.push(requirement);
      return requirement;
    });
  }

  async listProjectRequirements(projectId) {
    const state = await this.store.read();
    return state.requirements
      .filter((item) => item.projectId === projectId)
      .sort((left, right) => left.version - right.version);
  }

  async getProjectRequirement(projectId, revisionId) {
    const state = await this.store.read();
    const requirement = state.requirements.find(
      (item) => item.projectId === projectId && item.id === revisionId,
    );
    if (!requirement) {
      throw apiError("需求版本不存在", { code: "NOT_FOUND", httpStatus: 404 });
    }
    return requirement;
  }

  confirmProjectRequirement(projectId, revisionId, input = {}) {
    return this.store.update((state) => {
      const requirement = state.requirements.find(
        (item) => item.projectId === projectId && item.id === revisionId,
      );
      if (!requirement) {
        throw apiError("需求版本不存在", { code: "NOT_FOUND", httpStatus: 404 });
      }
      if (requirement.status === "confirmed") return requirement;
      const confirmedAt = iso(this.now());
      for (const item of state.requirements) {
        if (item.projectId === projectId && item.status === "confirmed") item.status = "superseded";
      }
      requirement.status = "confirmed";
      requirement.confirmedBy = text(input.confirmedBy) || "local-user";
      requirement.confirmedAt = confirmedAt;
      return requirement;
    });
  }

  async listProjectVersions(projectId) {
    const state = await this.store.read();
    return state.results
      .filter((result) => result.projectId === projectId)
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
        directionId: result.directionId,
        directionName: result.directionName,
        modelSnapshot: result.modelSnapshot,
        promptVersionId: result.promptVersionId,
        knowledgeRevisionIds: result.knowledgeRevisionIds,
        feedbackCount: state.feedback.filter((item) => item.resultId === result.id).length,
        isDemoPlaceholder: result.isDemoPlaceholder,
        createdAt: result.createdAt,
      }));
  }

  async listPromptTemplates() {
    const state = await this.store.read();
    return [...state.promptTemplates].sort((left, right) => right.version - left.version);
  }

  async getPublishedPrompt() {
    return (await this.listPromptTemplates()).find((item) => item.status === "official") ?? null;
  }

  createPromptVersion(input = {}) {
    return this.store.update((state) => {
      const createdAt = iso(this.now());
      const template = {
        id: createId("prompt"),
        scope: "gold-design",
        version: Math.max(...state.promptTemplates.map((item) => item.version), 0) + 1,
        name: requireText(input.name, "模板名称"),
        content: requireText(input.content, "模板内容"),
        changeNote: requireText(input.changeNote, "变更说明"),
        status: "draft",
        testPassed: Boolean(input.testPassed),
        createdAt,
        publishedAt: null,
      };
      state.promptTemplates.push(template);
      return template;
    });
  }

  async comparePromptVersions(leftId, rightId) {
    const state = await this.store.read();
    const left = state.promptTemplates.find((item) => item.id === leftId);
    const right = state.promptTemplates.find((item) => item.id === rightId);
    if (!left || !right) {
      throw apiError("请选择两个存在的提示词版本", { code: "NOT_FOUND", httpStatus: 404 });
    }
    return {
      left,
      right,
      changed: left.content !== right.content,
      summary: left.content === right.content ? "两个版本内容相同" : "模板内容存在差异，请人工逐项核对",
    };
  }

  publishPromptVersion(versionId, input = {}) {
    return this.store.update((state) => {
      const target = state.promptTemplates.find((item) => item.id === versionId);
      if (!target) {
        throw apiError("提示词版本不存在", { code: "NOT_FOUND", httpStatus: 404 });
      }
      if (!target.testPassed) {
        throw apiError("只有明确标记为测试通过的版本才能发布", {
          code: "REVIEW_REQUIRED",
          httpStatus: 409,
        });
      }
      const current = state.promptTemplates.find((item) => item.status === "official");
      if (input.expectedCurrentVersionId && current && input.expectedCurrentVersionId !== current.id) {
        throw apiError("正式提示词版本已经变化，请刷新后重试", {
          code: "STALE_PROMPT_VERSION",
          httpStatus: 409,
        });
      }
      const publishedAt = iso(this.now());
      for (const template of state.promptTemplates) {
        if (template.id === target.id) {
          template.status = "official";
          template.publishedAt = publishedAt;
        } else if (template.status === "official") {
          template.status = "archived";
        }
      }
      return target;
    });
  }

  searchApprovedKnowledge() {
    return [];
  }
}
