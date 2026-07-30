import {
  AiClientError,
  HttpAiClient,
  LocalAiClient,
  isTaskTerminal,
} from "./ai-client.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function splitList(value) {
  return [...new Set(text(value).split(/[，,、;；\n]/).map((item) => item.trim()).filter(Boolean))];
}

function createId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function fileMetadata(fileList) {
  return [...(fileList ?? [])].map((file) => ({
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
  }));
}

function formatDate(value) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function shortId(value) {
  const normalized = String(value ?? "");
  return normalized.length > 18 ? `${normalized.slice(0, 8)}…${normalized.slice(-6)}` : normalized;
}

function safeImageUrl(value) {
  if (!value) {
    return "";
  }
  try {
    const resolved = new URL(value, window.location.origin);
    if (resolved.origin === window.location.origin || resolved.protocol === "blob:") {
      return resolved.href;
    }
  } catch {
    return "";
  }
  return "";
}

const TASK_LABELS = {
  queued: "排队中",
  running: "运行中",
  cancel_requested: "正在取消",
  succeeded: "已完成",
  partial_succeeded: "部分完成",
  partial_success: "部分完成",
  partially_succeeded: "部分完成",
  "partial-success": "部分完成",
  failed: "失败",
  cancelled: "已取消",
};

const DIRECTION_TEMPLATES = [
  {
    name: "方向 A｜轻雅留白",
    description: "以克制轮廓和清晰主视觉建立基础方向，便于继续讨论比例、细节与佩戴感。",
    previewKey: "minimal",
  },
  {
    name: "方向 B｜文化叙事",
    description: "以主题纹样和文化线索建立层次关系，便于继续选择寓意、装饰密度与工艺语言。",
    previewKey: "narrative",
  },
  {
    name: "方向 C｜结构新意",
    description: "以现代结构和视觉重心形成差异化讨论起点，便于继续探索几何关系与识别度。",
    previewKey: "structural",
  },
  {
    name: "方向 D｜轻奢日常",
    description: "以日常佩戴和精致细节为重点，兼顾轻量表达、辨识度与更多使用场景。",
    previewKey: "minimal",
  },
];

const DIRECTION_STATUS_LABELS = {
  queued: "等待生成",
  pending: "等待生成",
  running: "生成中",
  cancel_requested: "正在取消",
  succeeded: "生成完成",
  partial_succeeded: "部分完成",
  partial_success: "部分完成",
  failed: "生成失败",
  cancelled: "已取消",
};

function normalizedStatus(value, fallback = "queued") {
  const status = text(value).toLowerCase().replaceAll("-", "_");
  if (["success", "complete", "completed", "done"].includes(status)) return "succeeded";
  if (["error", "errored"].includes(status)) return "failed";
  if (["processing", "in_progress"].includes(status)) return "running";
  if (status === "canceled") return "cancelled";
  if (["partial_succeeded", "partial_success", "partially_succeeded"].includes(status)) return "partial_success";
  return status || fallback;
}

function statusCssClass(value) {
  const status = normalizedStatus(value);
  return new Set(["queued", "pending", "running", "cancel_requested", "succeeded", "failed", "cancelled", "partial_success"]).has(status)
    ? status
    : "queued";
}

function formatDuration(milliseconds, startedAt, completedAt) {
  let value = Number(milliseconds);
  if (!Number.isFinite(value) && startedAt && completedAt) {
    value = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  }
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} 秒`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
}

function endpointIsUnsupported(error) {
  return error instanceof AiClientError
    && (new Set([404, 405, 501]).has(error.httpStatus)
      || new Set(["NOT_FOUND", "ENDPOINT_NOT_FOUND", "METHOD_NOT_ALLOWED"]).has(error.code));
}

export class AiWorkbench {
  constructor({
    database,
    getProjects,
    getKnowledgeItems,
    showToast,
    selectProjectDirection = null,
  }) {
    this.database = database;
    this.getProjects = getProjects;
    this.getKnowledgeItems = getKnowledgeItems;
    this.showToast = showToast;
    this.selectProjectDirection = selectProjectDirection;
    this.mode = "demo";
    this.client = null;
    this.models = [];
    this.prompts = [];
    this.publishedPrompt = null;
    this.providerStatus = null;
    this.parsedRequirement = null;
    this.confirmedRequirement = null;
    this.knowledgeHits = [];
    this.tasks = [];
    this.results = [];
    this.versions = [];
    this.selectedDirection = null;
    this.knownTaskIds = new Set();
    this.pollTimer = null;
    this.polling = false;
    this.acceptanceRetryState = new Map();

    this.elements = {
      mode: document.querySelector("#ai-client-mode"),
      connection: document.querySelector("#ai-connection-state"),
      requirementForm: document.querySelector("#ai-requirement-form"),
      reviewForm: document.querySelector("#ai-requirement-review-form"),
      reviewFields: document.querySelector("#ai-requirement-review-fields"),
      reviewStatus: document.querySelector("#requirement-review-status"),
      modeHint: document.querySelector("#requirement-mode-hint"),
      projectSelect: document.querySelector("#ai-project-select"),
      knowledgeForm: document.querySelector("#ai-knowledge-search-form"),
      knowledgeResults: document.querySelector("#ai-knowledge-results"),
      generationForm: document.querySelector("#ai-generation-form"),
      modelSelect: document.querySelector("#ai-model-select"),
      refineModelSelect: document.querySelector("#ai-refine-model-select"),
      promptSelect: document.querySelector("#ai-prompt-select"),
      runtimeSnapshot: document.querySelector("#runtime-snapshot"),
      taskList: document.querySelector("#ai-task-list"),
      resultsGrid: document.querySelector("#ai-results-grid"),
      resultsSummary: document.querySelector("#ai-results-summary"),
      selectedDirection: document.querySelector("#ai-selected-direction"),
      refineForm: document.querySelector("#ai-refine-form"),
      refineStatus: document.querySelector("#refine-baseline-status"),
      feedbackForm: document.querySelector("#ai-feedback-form"),
      feedbackStatus: document.querySelector("#feedback-target-status"),
      versionTrack: document.querySelector("#ai-version-track"),
      modelDirectory: document.querySelector("#ai-model-directory"),
      refreshModels: document.querySelector("#refresh-ai-models"),
      promptList: document.querySelector("#prompt-version-list"),
      publishedPromptStatus: document.querySelector("#published-prompt-status"),
      promptForm: document.querySelector("#prompt-version-form"),
      compareLeft: document.querySelector("#prompt-compare-left"),
      compareRight: document.querySelector("#prompt-compare-right"),
      compareButton: document.querySelector("#compare-prompts"),
      promptDiff: document.querySelector("#prompt-diff"),
    };
  }

  async initialize() {
    this.bindEvents();
    this.refreshProjectOptions();
    await this.switchMode("demo");
    return this;
  }

  bindEvents() {
    this.elements.mode.addEventListener("change", () => this.switchMode(this.elements.mode.value));
    this.elements.projectSelect.addEventListener("change", async () => {
      this.prefillFromProject();
      this.loadSelectedDirection();
      this.parsedRequirement = null;
      this.confirmedRequirement = null;
      this.resetRequirementReview();
      await this.loadProjectRuntime();
    });
    this.elements.requirementForm.addEventListener("submit", (event) => this.handleRequirementParse(event));
    this.elements.reviewForm.addEventListener("submit", (event) => this.handleRequirementConfirm(event));
    this.elements.knowledgeForm.addEventListener("submit", (event) => this.handleKnowledgeSearch(event));
    this.elements.generationForm.addEventListener("submit", (event) => this.handleCreateGeneration(event));
    this.elements.taskList.addEventListener("click", (event) => this.handleTaskAction(event));
    this.elements.resultsGrid.addEventListener("click", (event) => this.handleResultAction(event));
    this.elements.refineForm.addEventListener("submit", (event) => this.handleRefine(event));
    this.elements.feedbackForm.addEventListener("submit", (event) => this.handleFeedback(event));
    this.elements.refreshModels.addEventListener("click", () => this.loadResources());
    this.elements.promptForm.addEventListener("submit", (event) => this.handlePromptCreate(event));
    this.elements.promptList.addEventListener("click", (event) => this.handlePromptPublish(event));
    this.elements.compareButton.addEventListener("click", () => this.handlePromptCompare());
  }

  createClient(mode) {
    if (mode === "remote") {
      return new HttpAiClient();
    }
    return new LocalAiClient({
      database: this.database,
      getKnowledgeItems: this.getKnowledgeItems,
    });
  }

  selectionStorageKey() {
    return `gold-ai:selected-direction:${this.mode}:${this.elements.projectSelect.value || "none"}`;
  }

  loadSelectedDirection() {
    try {
      this.selectedDirection = JSON.parse(window.localStorage.getItem(this.selectionStorageKey())) || null;
    } catch {
      this.selectedDirection = null;
    }
    if (!this.selectedDirection && this.mode === "demo") {
      const project = this.getProjects().find((item) => item.id === this.elements.projectSelect.value);
      const direction = project?.directions?.find((item) => item.id === project.selectedDirectionId);
      if (direction) {
        this.selectedDirection = {
          projectId: project.id,
          directionId: direction.id,
          directionIndex: direction.slot,
          name: direction.title,
          description: direction.concept,
          persistence: "project",
          selectedAt: project.updatedAt,
        };
      }
    }
  }

  saveSelectedDirection(selection) {
    this.selectedDirection = selection;
    try {
      window.localStorage.setItem(this.selectionStorageKey(), JSON.stringify(selection));
    } catch {
      // Storage may be disabled; the in-memory selection still remains visible for this session.
    }
    window.dispatchEvent(new CustomEvent("gold-ai:direction-selected", {
      detail: { ...selection },
    }));
  }

  async switchMode(mode) {
    this.stopPolling();
    this.mode = mode === "remote" ? "remote" : "demo";
    this.elements.mode.value = this.mode;
    this.client = this.createClient(this.mode);
    this.models = [];
    this.prompts = [];
    this.publishedPrompt = null;
    this.providerStatus = null;
    this.tasks = [];
    this.results = [];
    this.versions = [];
    this.loadSelectedDirection();
    this.knownTaskIds.clear();
    this.elements.connection.textContent = this.mode === "demo" ? "本地 · 非真实 AI" : "同源 API · 待验证";
    this.elements.connection.className = `connection-pill ${this.mode === "remote" ? "is-remote" : ""}`;
    this.elements.modeHint.textContent = this.mode === "demo"
      ? "本地模式使用确定性规则整理明确输入。"
      : "远端模式将调用同源 /api；连接失败不会自动切回本地。";
    this.elements.generationForm.querySelector("button[type='submit']").textContent = this.mode === "demo"
      ? "创建本地演示任务"
      : "创建后端生成任务";
    await this.loadResources();
    await this.loadProjectRuntime();
  }

  refreshProjectOptions() {
    const projects = this.getProjects();
    const current = this.elements.projectSelect.value;
    if (!projects.length) {
      this.elements.projectSelect.innerHTML = '<option value="">请先在“设计工作台”建立项目</option>';
      this.elements.projectSelect.disabled = true;
      return;
    }
    this.elements.projectSelect.disabled = false;
    this.elements.projectSelect.innerHTML = projects
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.brief.theme)} · ${escapeHtml(project.brief.category || "未限定品类")}</option>`)
      .join("");
    if (projects.some((project) => project.id === current)) {
      this.elements.projectSelect.value = current;
    }
    this.prefillFromProject();
  }

  prefillFromProject() {
    const project = this.getProjects().find((item) => item.id === this.elements.projectSelect.value);
    if (!project) {
      return;
    }
    const form = this.elements.requirementForm.elements;
    if (!text(form.customerText.value)) {
      form.customerText.value = [project.brief.theme, project.brief.notes].filter(Boolean).join("。") || project.brief.theme;
    }
    if (!text(form.productType.value)) form.productType.value = project.brief.category || "";
    if (!text(form.style.value)) form.style.value = project.brief.style || "";
    if (!text(form.targetAudience.value)) form.targetAudience.value = project.brief.audience || "";
    if (!text(form.usageScenario.value)) form.usageScenario.value = project.brief.scene || "";
  }

  async refreshContext() {
    this.refreshProjectOptions();
    if (this.mode === "demo") {
      await this.loadProjectRuntime();
    }
  }

  async loadResources() {
    this.renderResourceLoading();
    try {
      const [models, prompts, publishedPrompt, providerStatus] = await Promise.all([
        this.client.listModels(),
        this.client.listPromptTemplates(),
        this.client.getPublishedPrompt(),
        this.client.getProviderStatus().catch((error) => {
          if (endpointIsUnsupported(error)) {
            return { supported: false, reachable: null, isDemo: this.mode === "demo" };
          }
          return {
            supported: true,
            reachable: false,
            isDemo: false,
            error: { code: error.code, message: error.message },
          };
        }),
      ]);
      this.models = models;
      this.prompts = prompts;
      this.publishedPrompt = publishedPrompt;
      this.providerStatus = providerStatus;
      this.renderModels();
      this.renderPrompts();
      if (this.mode === "demo") {
        this.elements.connection.textContent = "本地 · 非真实 AI";
      } else if (providerStatus?.reachable === true) {
        this.elements.connection.textContent = "同源 API · 生图服务已连接";
      } else if (providerStatus?.reachable === false) {
        this.elements.connection.textContent = "同源 API · 生图服务不可用";
      } else {
        this.elements.connection.textContent = "同源 API · 已连接";
      }
      this.elements.connection.classList.toggle("is-connected", this.mode === "remote" && providerStatus?.reachable !== false);
      this.elements.connection.classList.toggle("is-error", this.mode === "remote" && providerStatus?.reachable === false);
    } catch (error) {
      this.models = [];
      this.prompts = [];
      this.renderModels(error);
      this.renderPrompts(error);
      this.elements.connection.textContent = this.mode === "demo" ? "本地接口异常" : "同源 API · 连接失败";
      this.elements.connection.classList.add("is-error");
      this.reportError(error);
    }
  }

  renderResourceLoading() {
    this.elements.modelDirectory.innerHTML = '<p class="empty-inline">正在加载模型目录…</p>';
    this.elements.promptList.innerHTML = '<p class="empty-inline">正在加载提示词版本…</p>';
  }

  renderModels(error = null) {
    const available = this.models.filter((model) => model.status === "available");
    const generationModels = available.filter((model) => model.capabilities?.operations?.includes("generate"));
    const refineModels = available.filter((model) => model.capabilities?.operations?.includes("refine"));
    const optionHtml = (models) => models.map((model) => `
      <option value="${escapeHtml(model.id)}" ${model.isDefault ? "selected" : ""}>
        ${escapeHtml(model.displayName)}${model.isDemo ? " · DEMO" : ""}
      </option>
    `).join("");
    this.elements.modelSelect.innerHTML = generationModels.length ? optionHtml(generationModels) : '<option value="">无可用生成模型</option>';
    this.elements.refineModelSelect.innerHTML = refineModels.length ? optionHtml(refineModels) : '<option value="">无可用细化模型</option>';

    if (error) {
      this.elements.modelDirectory.innerHTML = `<p class="empty-inline error-inline">模型目录加载失败：${escapeHtml(error.message)}</p>`;
      return;
    }
    if (!this.models.length) {
      this.elements.modelDirectory.innerHTML = '<p class="empty-inline">接口没有返回模型。</p>';
      return;
    }
    this.elements.modelDirectory.innerHTML = this.models.map((model) => {
      const capabilities = model.capabilities ?? {};
      return `
        <article class="model-card ${model.status === "available" ? "is-available" : ""}">
          <div class="card-topline">
            <div><h4>${escapeHtml(model.displayName || model.name)}</h4><code>${escapeHtml(model.id)}</code></div>
            <span class="status-pill ${model.status === "available" ? "approved" : "rejected"}">${escapeHtml(model.status)}</span>
          </div>
          <p>${escapeHtml(model.recommendedUse || "未提供推荐用途")}</p>
          <div class="tag-row">
            ${(capabilities.operations ?? []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
            ${(capabilities.inputModalities ?? []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
          </div>
          <p class="field-help">供应商：${escapeHtml(model.provider || "未声明")} · 最大参考图 ${escapeHtml(capabilities.maxReferenceImages ?? "—")} · ${model.isDemo ? "本地占位模型" : "后端模型"}</p>
          ${!model.isDemo && model.provider === this.providerStatus?.provider ? `
            <p class="model-health ${this.providerStatus?.reachable ? "is-ready" : "is-unavailable"}">
              ${this.providerStatus?.reachable ? "生图服务当前可达" : "生图服务当前不可达，不能创建真实结果"}
            </p>
          ` : ""}
        </article>
      `;
    }).join("");
  }

  renderPrompts(error = null) {
    if (error) {
      this.elements.promptSelect.innerHTML = '<option value="">提示词加载失败</option>';
      this.elements.promptList.innerHTML = `<p class="empty-inline error-inline">提示词加载失败：${escapeHtml(error.message)}</p>`;
      this.elements.publishedPromptStatus.textContent = "加载失败";
      return;
    }
    const official = this.publishedPrompt || this.prompts.find((prompt) => prompt.status === "official");
    const options = this.prompts.map((prompt) => `
      <option value="${escapeHtml(prompt.id)}" ${prompt.status === "official" ? "selected" : ""}>P${escapeHtml(prompt.version)} · ${escapeHtml(prompt.name)} · ${escapeHtml(prompt.status)}</option>
    `).join("");
    this.elements.promptSelect.innerHTML = options || '<option value="">无提示词版本</option>';
    this.elements.compareLeft.innerHTML = options || '<option value="">无版本</option>';
    this.elements.compareRight.innerHTML = options || '<option value="">无版本</option>';
    if (this.prompts.length > 1) {
      this.elements.compareLeft.value = this.prompts[1].id;
      this.elements.compareRight.value = this.prompts[0].id;
    }
    this.elements.publishedPromptStatus.textContent = official ? `P${official.version} · 正式` : "没有正式版本";
    if (!this.prompts.length) {
      this.elements.promptList.innerHTML = '<p class="empty-inline">还没有提示词版本。</p>';
      return;
    }
    this.elements.promptList.innerHTML = this.prompts.map((prompt) => `
      <article class="prompt-card" data-prompt-id="${escapeHtml(prompt.id)}">
        <div class="card-topline">
          <div><h4>P${escapeHtml(prompt.version)} · ${escapeHtml(prompt.name)}</h4><code>${escapeHtml(prompt.id)}</code></div>
          <span class="status-pill ${prompt.status === "official" ? "approved" : "pending"}">${escapeHtml(prompt.status)}</span>
        </div>
        <p>${escapeHtml(prompt.content)}</p>
        <p class="field-help">${escapeHtml(prompt.changeNote)} · ${prompt.testPassed ? "已标记测试通过" : "尚未标记测试通过"} · ${formatDate(prompt.createdAt)}</p>
        ${prompt.status !== "official" ? `<button class="button button-small button-secondary" type="button" data-publish-prompt ${prompt.testPassed ? "" : "disabled"}>发布为正式版</button>` : ""}
      </article>
    `).join("");
  }

  async handleRequirementParse(event) {
    event.preventDefault();
    const form = this.elements.requirementForm;
    const data = new FormData(form);
    const projectId = data.get("projectId");
    if (!projectId) {
      this.showToast("请先在设计工作台建立项目", true);
      return;
    }
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      const input = {
        customerText: data.get("customerText"),
        formFields: {
          productType: data.get("productType"),
          goldType: data.get("goldType"),
          style: data.get("style"),
          targetAudience: data.get("targetAudience"),
          usageScenario: data.get("usageScenario"),
          motifs: data.get("motifs"),
          weightOrBudget: data.get("weightOrBudget"),
          craftRequirements: data.get("craftRequirements"),
          mustKeep: data.get("mustKeep"),
          mustAvoid: data.get("mustAvoid"),
        },
        referenceImages: fileMetadata(form.elements.referenceImages.files),
      };
      const result = await this.client.parseRequirements(input, { signal: new AbortController().signal });
      this.parsedRequirement = {
        id: result.requirementRevisionId || createId("requirement"),
        projectId,
        status: "parsed",
        rawInput: input,
        parsed: result,
        createdAt: new Date().toISOString(),
      };
      await this.database.put("aiRequirements", this.parsedRequirement);
      this.fillReviewForm(result);
      this.elements.reviewFields.disabled = false;
      this.elements.reviewStatus.textContent = `待人工校准 · ${shortId(this.parsedRequirement.id)}`;
      this.elements.reviewStatus.className = "status-pill pending";
      this.showToast("需求解析结果已生成，请人工修改并确认");
    } catch (error) {
      this.reportError(error);
    } finally {
      submit.disabled = false;
    }
  }

  fillReviewForm(result) {
    const form = this.elements.reviewForm.elements;
    const fields = [
      "productType", "goldType", "style", "targetAudience", "usageScenario",
      "motifs", "weightOrBudget", "craftRequirements", "mustKeep", "mustAvoid",
      "missingFields", "understandingSummary",
    ];
    for (const field of fields) {
      const value = field === "understandingSummary"
        ? result.understandingSummary ?? result.aiUnderstandingSummary
        : result[field];
      form[field].value = Array.isArray(value) ? value.join("，") : value || "";
    }
  }

  resetRequirementReview() {
    this.elements.reviewForm.reset();
    this.elements.reviewFields.disabled = true;
    this.elements.reviewStatus.textContent = "等待解析";
    this.elements.reviewStatus.className = "status-pill";
    this.elements.runtimeSnapshot.textContent = "尚未确认需求修订";
  }

  async handleRequirementConfirm(event) {
    event.preventDefault();
    if (!this.parsedRequirement) {
      return;
    }
    const form = this.elements.reviewForm;
    const submit = form.querySelector("button[type='submit']");
    const data = new FormData(form);
    const structuredRequirements = {
      productType: text(data.get("productType")),
      goldType: text(data.get("goldType")),
      style: text(data.get("style")),
      targetAudience: text(data.get("targetAudience")),
      usageScenario: text(data.get("usageScenario")),
      motifs: splitList(data.get("motifs")),
      weightOrBudget: text(data.get("weightOrBudget")),
      craftRequirements: splitList(data.get("craftRequirements")),
      mustKeep: splitList(data.get("mustKeep")),
      mustAvoid: splitList(data.get("mustAvoid")),
      missingFields: splitList(data.get("missingFields")),
      understandingSummary: text(data.get("understandingSummary")),
    };

    submit.disabled = true;
    let savedToBackend = false;
    try {
      if (this.mode === "remote") {
        try {
          const parsedPayload = this.parsedRequirement.parsed ?? {};
          const fullStructuredRequirement = {
            ...(parsedPayload.structuredRequirement ?? {}),
            ...structuredRequirements,
            missingFields: structuredRequirements.missingFields,
            understandingSummary: structuredRequirements.understandingSummary,
          };
          const saved = await this.client.createProjectRequirement(this.parsedRequirement.projectId, {
            sourceRequirementRevisionId: this.parsedRequirement.id,
            customerText: this.parsedRequirement.rawInput.customerText,
            structuredRequirement: fullStructuredRequirement,
            missingFields: structuredRequirements.missingFields,
            clarificationQuestions: parsedPayload.clarificationQuestions ?? [],
            understandingSummary: structuredRequirements.understandingSummary,
            analysisMode: parsedPayload.analysisMode,
            parserVersion: parsedPayload.parserVersion,
            dataSourceVersion: parsedPayload.dataSourceVersion,
            confidence: parsedPayload.confidence,
            ambiguousTerms: parsedPayload.ambiguousTerms ?? [],
            contradictions: parsedPayload.contradictions ?? [],
            doNotInfer: parsedPayload.doNotInfer ?? [],
            evidence: parsedPayload.evidence ?? [],
            warnings: parsedPayload.warnings ?? [],
            createdBy: "local-user",
          });
          const confirmed = await this.client.confirmProjectRequirement(
            this.parsedRequirement.projectId,
            saved.id,
            { confirmedBy: "local-user" },
          );
          this.confirmedRequirement = {
            id: confirmed.id,
            parentRevisionId: this.parsedRequirement.id,
            projectId: confirmed.projectId,
            status: confirmed.status,
            fullStructuredRequirement: confirmed,
            structuredRequirements: {
              productType: confirmed.productType,
              goldType: confirmed.goldType,
              style: confirmed.style,
              targetAudience: confirmed.targetAudience,
              usageScenario: confirmed.usageScenario,
              motifs: confirmed.motifs,
              weightOrBudget: confirmed.weightOrBudget,
              craftRequirements: confirmed.craftRequirements,
              mustKeep: confirmed.mustKeep,
              mustAvoid: confirmed.mustAvoid,
              missingFields: confirmed.missingFields,
              understandingSummary: confirmed.understandingSummary,
            },
            referenceImages: this.parsedRequirement.parsed.referenceImages ?? [],
            confirmedAt: confirmed.confirmedAt,
            persistence: "backend",
          };
          savedToBackend = true;
        } catch (error) {
          if (!endpointIsUnsupported(error)) throw error;
        }
      }

      if (!savedToBackend) {
        this.confirmedRequirement = {
          id: createId("requirement-confirmed"),
          parentRevisionId: this.parsedRequirement.id,
          projectId: this.parsedRequirement.projectId,
          status: "confirmed",
          structuredRequirements,
          referenceImages: this.parsedRequirement.parsed.referenceImages ?? [],
          confirmedAt: new Date().toISOString(),
          persistence: this.mode === "remote" ? "browser_legacy_contract" : "browser_indexeddb",
        };
      }

      await this.database.put("aiRequirements", this.confirmedRequirement);
      this.elements.reviewStatus.textContent = `已人工确认 · ${shortId(this.confirmedRequirement.id)}`;
      this.elements.reviewStatus.className = "status-pill approved";
      this.updateRuntimeSnapshot();
      this.showToast(savedToBackend
        ? "人工校准需求已写入后端并确认"
        : this.mode === "remote"
          ? "旧版后端未提供需求版本端点；本次仅保存在浏览器，生成时以后端响应为准"
          : "人工校准需求已保存为本地修订");
    } catch (error) {
      this.reportError(error);
    } finally {
      submit.disabled = false;
    }
  }

  updateRuntimeSnapshot() {
    if (!this.confirmedRequirement) {
      this.elements.runtimeSnapshot.textContent = "尚未确认需求修订";
      return;
    }
    const model = this.models.find((item) => item.id === this.elements.modelSelect.value);
    const prompt = this.prompts.find((item) => item.id === this.elements.promptSelect.value);
    const selectedKnowledge = this.elements.knowledgeResults.querySelectorAll("input[name='knowledgeRevisionIds']:checked").length;
    this.elements.runtimeSnapshot.innerHTML = `
      <span>R · ${escapeHtml(shortId(this.confirmedRequirement.id))}</span>
      <span>M · ${escapeHtml(model?.displayName || "未选择")}</span>
      <span>P · ${escapeHtml(prompt ? `P${prompt.version}` : "未选择")}</span>
      <span>K · ${selectedKnowledge}</span>
    `;
  }

  async handleKnowledgeSearch(event) {
    event.preventDefault();
    if (!this.confirmedRequirement) {
      this.showToast("请先解析并人工确认需求", true);
      return;
    }
    try {
      const query = new FormData(this.elements.knowledgeForm).get("query");
      this.knowledgeHits = await this.client.searchApprovedKnowledge({
        query,
        structuredRequirements: this.confirmedRequirement.structuredRequirements,
      });
      this.renderKnowledgeHits();
      this.updateRuntimeSnapshot();
      this.showToast(`检索到 ${this.knowledgeHits.length} 条已审核资料`);
    } catch (error) {
      this.reportError(error);
    }
  }

  renderKnowledgeHits() {
    if (!this.knowledgeHits.length) {
      this.elements.knowledgeResults.innerHTML = '<span class="empty-inline">没有匹配的已审核资料；未审核资料不会返回。</span>';
      return;
    }
    this.elements.knowledgeResults.innerHTML = this.knowledgeHits.map((item) => `
      <label class="knowledge-hit-card">
        <input type="checkbox" name="knowledgeRevisionIds" value="${escapeHtml(item.knowledgeRevisionId)}" checked />
        <span>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.category || "未分类")} · 审核人 ${escapeHtml(item.approvedBy || "未记录")} · 来源 ${escapeHtml(item.sourceNote || "未记录")}</small>
          <em>${escapeHtml(item.excerpt || "无摘要")}</em>
        </span>
      </label>
    `).join("");
    this.elements.knowledgeResults.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", () => this.updateRuntimeSnapshot());
    });
  }

  async handleCreateGeneration(event) {
    event.preventDefault();
    if (!this.confirmedRequirement) {
      this.showToast("请先保存人工校准需求", true);
      return;
    }
    const data = new FormData(this.elements.generationForm);
    const modelId = data.get("modelId");
    const promptVersionId = data.get("promptVersionId");
    if (!modelId || !promptVersionId) {
      this.showToast("模型或提示词版本不可用", true);
      return;
    }
    const selectedModel = this.models.find((model) => model.id === modelId);
    if (this.mode === "remote" && !selectedModel?.isDemo && this.providerStatus?.reachable === false) {
      this.showToast("生图服务当前不可达；任务不会伪装成本地结果，请先恢复后端模型服务", true);
      return;
    }
    const submit = this.elements.generationForm.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      const accepted = await this.client.createGeneration({
        projectId: this.confirmedRequirement.projectId,
        requirementRevisionId: this.confirmedRequirement.id,
        structuredRequirements: this.confirmedRequirement.structuredRequirements,
        directionCount: Number(data.get("directionCount")),
        imagesPerDirection: Number(data.get("imagesPerDirection")),
        referenceImages: this.confirmedRequirement.referenceImages,
        modelConfig: { modelId },
        promptVersionId,
        knowledgeRevisionIds: [...this.elements.knowledgeResults.querySelectorAll("input[name='knowledgeRevisionIds']:checked")].map((input) => input.value),
      }, { idempotencyKey: createId("create-generation") });
      this.knownTaskIds.add(accepted.taskId);
      await this.refreshTasks();
      this.startPolling();
      this.elements.taskList.scrollIntoView({ behavior: "smooth", block: "center" });
      this.showToast(`任务已创建：预计 ${accepted.expectedCount} 个结果`);
    } catch (error) {
      this.reportError(error);
    } finally {
      submit.disabled = false;
    }
  }

  async loadProjectRuntime() {
    const projectId = this.elements.projectSelect.value;
    if (!projectId || !this.client) {
      this.renderTasks();
      this.renderResults();
      this.renderVersions();
      return;
    }
    try {
      if (this.mode === "demo") {
        const tasks = await this.client.listTasks(projectId);
        tasks.forEach((task) => this.knownTaskIds.add(task.id));
      }
      await this.refreshTasks();
      await this.loadResultsAndVersions();
      this.startPolling();
    } catch (error) {
      this.reportError(error);
    }
  }

  async refreshTasks() {
    if (this.polling || !this.knownTaskIds.size) {
      if (!this.knownTaskIds.size) this.renderTasks();
      return;
    }
    this.polling = true;
    try {
      const snapshots = await Promise.all([...this.knownTaskIds].map((taskId) => this.client.getTask(taskId)));
      this.tasks = snapshots.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
      this.syncSelectedDirectionFromTasks();
      this.renderTasks();
      this.renderResults();
      if (snapshots.some((task) => (
        normalizedStatus(task.status) === "succeeded"
        || normalizedStatus(task.status) === "partial_success"
        || (task.completedImages ?? []).length
        || (task.directions ?? []).some((direction) => (
          (direction.completedImages ?? direction.images ?? direction.results ?? []).length
        ))
      ))) {
        await this.loadResultsAndVersions();
      }
      if (snapshots.every((task) => isTaskTerminal(task.status))) {
        this.stopPolling();
      }
    } catch (error) {
      if (this.mode === "remote") {
        this.elements.connection.textContent = "同源 API · 状态待同步";
      }
      this.reportError(error, false);
    } finally {
      this.polling = false;
    }
  }

  startPolling() {
    if (this.pollTimer || !this.tasks.some((task) => !isTaskTerminal(task.status))) {
      return;
    }
    this.pollTimer = window.setInterval(() => this.refreshTasks(), 900);
  }

  stopPolling() {
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  syncSelectedDirectionFromTasks() {
    if (this.mode !== "remote") return;
    for (const task of this.tasks) {
      const selectedDirectionId = task.selectedDirectionId
        || task.selection?.directionId
        || task.selectedDirection?.directionId
        || task.selectedDirection?.id;
      if (!selectedDirectionId) continue;
      const selectedResultId = task.selectedResultId
        || task.selection?.resultId
        || task.selectedDirection?.resultId
        || null;
      this.saveSelectedDirection({
        projectId: task.projectId,
        taskId: task.id,
        generationId: task.generationId,
        directionId: selectedDirectionId,
        resultId: selectedResultId,
        selectedAt: task.selection?.selectedAt || task.updatedAt || new Date().toISOString(),
        persistence: "backend",
      });
      break;
    }
  }

  taskDirections(task) {
    const rawDirections = [
      task.directions,
      task.directionResults,
      task.designDirections,
      task.outputs?.directions,
    ].find(Array.isArray) ?? [];
    const failedDirections = [
      task.failedDirections,
      task.directionErrors,
      task.errors?.directions,
    ].find(Array.isArray) ?? [];
    const topImages = [
      ...(Array.isArray(task.completedImages) ? task.completedImages : []),
      ...this.results.filter((result) => (
        result.sourceTaskId === task.id
        || (!result.sourceTaskId && result.generationId && result.generationId === task.generationId)
      )),
    ];
    const imageKeys = new Set();
    const uniqueImages = topImages.filter((image, index) => {
      const key = image.resultId || image.id || image.imageUrl || `${image.directionIndex || 0}:${image.imageIndex || index}`;
      if (imageKeys.has(key)) return false;
      imageKeys.add(key);
      return true;
    });
    const imagesPerDirection = Math.max(1, Number(task.payload?.imagesPerDirection || task.imagesPerDirection || 1));
    const inferredDirectionCount = Math.max(
      rawDirections.length,
      Number(task.payload?.directionCount || task.directionCount || 0),
      ...uniqueImages.map((image) => Number(image.directionIndex || 0)),
      Math.ceil(Number(task.expectedCount || uniqueImages.length || 1) / imagesPerDirection),
      1,
    );
    const directionSources = rawDirections.length
      ? rawDirections
      : Array.from({ length: inferredDirectionCount }, (_, index) => ({
        directionIndex: index + 1,
      }));
    const taskStatus = normalizedStatus(task.status);

    return directionSources.map((source, offset) => {
      const directionIndex = Number(source.directionIndex || source.index || source.slot || offset + 1);
      const failure = failedDirections.find((item, failedIndex) => (
        item.directionId && item.directionId === (source.directionId || source.id)
        || Number(item.directionIndex || failedIndex + 1) === directionIndex
      ));
      const explicitDirectionId = source.directionId || source.id || failure?.directionId;
      const positionalImages = uniqueImages.filter((image, imageOffset) => {
        if (explicitDirectionId && image.directionId) return image.directionId === explicitDirectionId;
        if (Number(image.directionIndex || 0)) return Number(image.directionIndex) === directionIndex;
        return Math.floor(imageOffset / imagesPerDirection) + 1 === directionIndex;
      });
      const nestedImages = [
        source.completedImages,
        source.images,
        source.results,
        source.outputs,
      ].find(Array.isArray) ?? [];
      const combinedImages = [...nestedImages, ...positionalImages];
      const nestedKeys = new Set();
      const images = combinedImages.filter((image, imageIndex) => {
        const key = image.resultId || image.id || image.imageUrl || `${directionIndex}:${image.imageIndex || imageIndex}`;
        if (nestedKeys.has(key)) return false;
        nestedKeys.add(key);
        return true;
      });
      const firstImage = images[0] ?? null;
      const template = DIRECTION_TEMPLATES[(Math.max(1, directionIndex) - 1) % DIRECTION_TEMPLATES.length];
      const directionId = explicitDirectionId
        || firstImage?.directionId
        || `${task.id}:direction:${directionIndex}`;
      const error = source.error || failure?.error || failure || (
        taskStatus === "failed" && !images.length ? task.error : null
      );
      let status = normalizedStatus(source.status || failure?.status, "");
      if (!status) {
        if (error) status = "failed";
        else if (images.some((image) => normalizedStatus(image.status, "succeeded") === "failed")) {
          status = images.some((image) => normalizedStatus(image.status, "succeeded") === "succeeded")
            ? "partial_success"
            : "failed";
        } else if (images.length) status = "succeeded";
        else if (taskStatus === "partial_success") status = "failed";
        else if (taskStatus === "succeeded") status = "succeeded";
        else status = taskStatus;
      }
      const retryable = status === "failed"
        && (source.retryable ?? failure?.retryable ?? task.retryable ?? taskStatus === "partial_success");
      const name = text(
        source.directionName
        || source.name
        || source.title
        || firstImage?.directionName
        || firstImage?.name,
      ) || template.name;
      const description = text(
        source.directionDescription
        || source.description
        || source.explanation
        || source.rationale
        || source.concept
        || source.summary
        || firstImage?.directionDescription
        || firstImage?.description,
      ) || template.description;
      const modelSnapshot = source.modelSnapshot
        || source.model
        || firstImage?.modelSnapshot
        || task.modelSnapshot
        || null;
      const primaryResult = images.find((image) => normalizedStatus(image.status, "succeeded") === "succeeded")
        || firstImage
        || (source.resultId || source.imageUrl ? source : null);

      return {
        task,
        taskId: task.id,
        generationId: source.generationId || primaryResult?.generationId || task.generationId,
        projectId: task.projectId,
        directionId,
        directionIndex,
        name,
        description,
        status,
        retryable,
        error,
        images,
        primaryResult,
        modelSnapshot,
        modelName: source.modelName
          || modelSnapshot?.displayName
          || modelSnapshot?.name
          || task.modelName
          || "未返回模型信息",
        previewKey: source.previewKey || firstImage?.previewKey || template.previewKey,
        latencyMs: source.latencyMs
          ?? source.durationMs
          ?? source.elapsedMs
          ?? primaryResult?.latencyMs
          ?? primaryResult?.durationMs
          ?? task.latencyMs,
        startedAt: source.startedAt || task.startedAt,
        completedAt: source.completedAt || primaryResult?.createdAt || task.completedAt,
        expectedImageCount: Number(source.expectedImageCount || imagesPerDirection),
        isDemoPlaceholder: Boolean(
          source.isDemoPlaceholder
          || (images.length && images.every((image) => image.isDemoPlaceholder)),
        ),
      };
    });
  }

  allDirectionCards() {
    const runtimeDirections = this.tasks.flatMap((task) => this.taskDirections(task));
    if (runtimeDirections.length || this.mode !== "demo") return runtimeDirections;
    const demoRequested = new URLSearchParams(window.location.search).get("demo") === "1";
    const project = this.getProjects().find((item) => item.id === this.elements.projectSelect.value);
    if (!demoRequested || !project?.directions?.length) return [];
    return project.directions.map((direction, index) => {
      const template = DIRECTION_TEMPLATES[index % DIRECTION_TEMPLATES.length];
      const resultId = `acceptance-result:${project.id}:${direction.id}`;
      const retryState = this.acceptanceRetryState.get(direction.id);
      const status = retryState || (index === 2 ? "failed" : "succeeded");
      const succeeded = status === "succeeded";
      return {
        task: null,
        taskId: `acceptance-task:${project.id}`,
        generationId: `acceptance-generation:${project.id}`,
        projectId: project.id,
        directionId: direction.id,
        directionIndex: Number(direction.slot || index + 1),
        name: direction.title || template.name,
        description: direction.concept || template.description,
        status,
        retryable: status === "failed",
        error: status === "failed" ? {
          code: "ACCEPTANCE_DIRECTION_FAILURE",
          message: "验收模拟：仅此方向失败，其他两个方向保持可选。",
        } : null,
        images: succeeded ? [{
          id: resultId,
          resultId,
          directionId: direction.id,
          directionIndex: Number(direction.slot || index + 1),
          previewKey: direction.placeholderKey || template.previewKey,
          isDemoPlaceholder: true,
          status: "succeeded",
        }] : [],
        primaryResult: succeeded ? {
          id: resultId,
          resultId,
          generationId: `acceptance-generation:${project.id}`,
          isDemoPlaceholder: true,
        } : null,
        modelSnapshot: null,
        modelName: "验收模拟 · 非真实 AI",
        previewKey: direction.placeholderKey || template.previewKey,
        latencyMs: null,
        startedAt: null,
        completedAt: succeeded ? project.updatedAt : null,
        expectedImageCount: 1,
        isDemoPlaceholder: true,
        isAcceptanceFixture: true,
      };
    });
  }

  renderTasks() {
    if (!this.tasks.length) {
      const demoRequested = new URLSearchParams(window.location.search).get("demo") === "1";
      const project = this.getProjects().find((item) => item.id === this.elements.projectSelect.value);
      this.elements.taskList.innerHTML = demoRequested && project?.directions?.length
        ? '<p class="empty-inline">验收模拟：下方方向卡用于验证部分成功、显式选择与单方向重试；没有创建真实生成任务。</p>'
        : '<p class="empty-inline">还没有生成任务。</p>';
      return;
    }
    this.elements.taskList.innerHTML = this.tasks.map((task) => {
      const taskStatus = normalizedStatus(task.status);
      const directions = this.taskDirections(task);
      const succeededCount = directions.filter((direction) => direction.status === "succeeded").length;
      const failedCount = directions.filter((direction) => direction.status === "failed").length;
      const canCancel = new Set(["queued", "running", "cancel_requested"]).has(taskStatus);
      const canRetry = new Set(["failed", "cancelled"]).has(taskStatus) && task.retryable;
      return `
        <article class="ai-task-card" data-task-id="${escapeHtml(task.id)}">
          <div class="card-topline">
            <div>
              <h4>${task.operation === "refine" ? "细化任务" : "设计生成任务"} · ${escapeHtml(shortId(task.id))}</h4>
              <code>${escapeHtml(task.generationId)}</code>
            </div>
            <span class="task-status task-status-${escapeHtml(statusCssClass(taskStatus))}">${escapeHtml(TASK_LABELS[taskStatus] || taskStatus)}</span>
          </div>
          <progress class="task-progress" max="100" value="${Math.max(0, Math.min(100, Number(task.progress) || 0))}" aria-label="完成进度 ${escapeHtml(task.progress)}%">${escapeHtml(task.progress)}%</progress>
          <div class="task-meta-grid">
            <span>步骤 <strong>${escapeHtml(task.currentStep || "—")}</strong></span>
            <span>进度 <strong>${escapeHtml(task.progress ?? 0)}%</strong></span>
            <span>方向 <strong>${escapeHtml(succeededCount)} 成功 · ${escapeHtml(failedCount)} 失败</strong></span>
            <span>开始 <strong>${formatDate(task.startedAt)}</strong></span>
            <span>完成 <strong>${formatDate(task.completedAt)}</strong></span>
          </div>
          ${task.error ? `<p class="task-error"><strong>${escapeHtml(task.error.code || "TASK_FAILED")}</strong> · ${escapeHtml(task.error.message || task.error)}</p>` : ""}
          <div class="task-actions">
            ${canCancel ? `<button class="button button-small button-danger-quiet" type="button" data-cancel-task ${task.status === "cancel_requested" ? "disabled" : ""}>${task.status === "cancel_requested" ? "正在取消" : "取消任务"}</button>` : ""}
            ${canRetry ? '<button class="button button-small button-secondary" type="button" data-retry-task>新建重试任务</button>' : ""}
          </div>
        </article>
      `;
    }).join("");
  }

  async handleTaskAction(event) {
    const card = event.target.closest("[data-task-id]");
    if (!card) return;
    const actionButton = event.target.closest("button");
    if (actionButton) actionButton.disabled = true;
    try {
      if (event.target.closest("[data-cancel-task]")) {
        await this.client.cancelTask(card.dataset.taskId, {}, { idempotencyKey: createId("cancel-task") });
        await this.refreshTasks();
        this.startPolling();
        this.showToast("已提交取消请求，最终状态以任务服务返回为准");
      }
      if (event.target.closest("[data-retry-task]")) {
        const accepted = await this.client.retryTask(card.dataset.taskId, {}, { idempotencyKey: createId("retry-task") });
        this.knownTaskIds.add(accepted.taskId);
        await this.refreshTasks();
        this.startPolling();
        this.showToast("已创建新的重试任务，旧任务保持不变");
      }
    } catch (error) {
      if (actionButton) actionButton.disabled = false;
      this.reportError(error);
    }
  }

  async loadResultsAndVersions() {
    const projectId = this.elements.projectSelect.value;
    if (!projectId) return;
    if (this.mode === "demo") {
      this.results = await this.client.listResults(projectId);
    } else {
      const results = this.tasks.flatMap((task) => {
        const nested = (task.directions ?? task.directionResults ?? task.designDirections ?? [])
          .flatMap((direction) => (
            direction.completedImages
            ?? direction.images
            ?? direction.results
            ?? []
          ))
          .map((result) => ({ ...result }));
        return [...(task.completedImages ?? []), ...nested].map((result) => ({
          ...result,
          sourceTaskId: task.id,
          generationId: result.generationId || task.generationId,
          projectId: task.projectId,
          modelSnapshot: result.modelSnapshot || task.modelSnapshot,
          promptVersionId: task.promptVersionId,
          knowledgeRevisionIds: task.knowledgeRevisionIds ?? [],
        }));
      });
      this.results = results;
    }
    const versionPayload = await this.client.listProjectVersions(projectId);
    this.versions = Array.isArray(versionPayload) ? versionPayload : versionPayload?.items ?? [];
    this.renderResults();
    this.renderVersions();
  }

  renderResults() {
    const directions = this.allDirectionCards();
    if (!directions.length) {
      this.elements.resultsGrid.innerHTML = '<p class="empty-inline">创建任务后，每个设计方向会以独立卡片显示在这里。</p>';
      if (this.elements.resultsSummary) this.elements.resultsSummary.textContent = "等待生成方向";
      if (this.elements.selectedDirection) this.elements.selectedDirection.textContent = "尚未选择方向";
      return;
    }

    const succeededCount = directions.filter((direction) => direction.status === "succeeded").length;
    const failedCount = directions.filter((direction) => direction.status === "failed").length;
    const runningCount = directions.filter((direction) => new Set(["queued", "pending", "running", "cancel_requested"]).has(direction.status)).length;
    if (this.elements.resultsSummary) {
      this.elements.resultsSummary.textContent = `${directions.length} 个方向 · ${succeededCount} 成功 · ${failedCount} 失败 · ${runningCount} 进行中`;
    }
    if (this.elements.selectedDirection) {
      const selectionLabel = this.selectedDirection?.name || (
        this.selectedDirection?.directionId ? shortId(this.selectedDirection.directionId) : ""
      );
      this.elements.selectedDirection.textContent = selectionLabel
        ? `已选：${selectionLabel}${this.selectedDirection.persistence === "backend" ? " · 已由后端记录" : this.mode === "remote" ? " · 仅本机界面记录" : " · 已写入本地项目"}`
        : "尚未选择方向";
      this.elements.selectedDirection.classList.toggle("has-selection", Boolean(selectionLabel));
    }

    this.elements.resultsGrid.innerHTML = directions.map((direction) => {
      const isSelected = this.selectedDirection?.directionId === direction.directionId
        || (this.selectedDirection?.resultId && this.selectedDirection.resultId === (direction.primaryResult?.resultId || direction.primaryResult?.id));
      const imageUrls = direction.images.map((image) => ({
        image,
        url: safeImageUrl(image.imageUrl || image.url),
      })).filter((item) => item.url);
      let placeholderTitle = "等待后端结果";
      let placeholderDetail = "不会用本地假图替代";
      if (direction.status === "failed") {
        placeholderTitle = "此方向生成失败";
        placeholderDetail = "未生成图片";
      } else if (direction.isAcceptanceFixture) {
        placeholderTitle = "方向卡验收模拟";
        placeholderDetail = "非真实生成图片";
      } else if (direction.isDemoPlaceholder || this.mode === "demo") {
        placeholderTitle = "本地合同演示";
        placeholderDetail = "非真实生成图片";
      } else if (direction.status === "succeeded") {
        placeholderTitle = "后端未返回可显示图片";
        placeholderDetail = "请检查任务详情";
      }
      const media = imageUrls.length
        ? `<div class="direction-media-grid ${imageUrls.length > 1 ? "has-multiple" : ""}">
            ${imageUrls.map(({ image, url }, imageIndex) => `
              <img src="${escapeHtml(url)}" alt="${escapeHtml(`${direction.name} 图片 ${image.imageIndex || imageIndex + 1}`)}" />
            `).join("")}
          </div>`
        : `<div class="ai-result-placeholder ${escapeHtml(direction.previewKey)} is-${escapeHtml(statusCssClass(direction.status))}">
            <span>${escapeHtml(placeholderTitle)}<small>${escapeHtml(placeholderDetail)}</small></span>
          </div>`;
      const resultId = direction.primaryResult?.resultId || direction.primaryResult?.id || "";
      const versionId = direction.primaryResult?.versionId || "";
      const failureMessage = direction.error?.message || direction.errorMessage || direction.failureReason || "";
      const failureCode = direction.error?.code || "";
      const canSelect = direction.status === "succeeded" && Boolean(resultId);
      const canRefine = canSelect && Boolean(versionId) && Boolean(direction.generationId);
      return `
        <article class="ai-result-card direction-result-card is-${escapeHtml(statusCssClass(direction.status))} ${isSelected ? "is-selected" : ""}"
          data-direction-id="${escapeHtml(direction.directionId)}"
          data-direction-index="${escapeHtml(direction.directionIndex)}"
          data-task-id="${escapeHtml(direction.taskId)}"
          data-result-id="${escapeHtml(resultId)}">
          <div class="direction-card-header">
            <div class="direction-index">0${escapeHtml(direction.directionIndex)}</div>
            <div>
              <p class="direction-eyebrow">DESIGN DIRECTION</p>
              <h4>${escapeHtml(direction.name)}</h4>
            </div>
            <span class="direction-status is-${escapeHtml(statusCssClass(direction.status))}">${escapeHtml(DIRECTION_STATUS_LABELS[direction.status] || direction.status)}</span>
          </div>
          <p class="direction-description">${escapeHtml(direction.description)}</p>
          ${media}
          <div class="ai-result-content">
            <dl class="direction-meta">
              <div><dt>模型</dt><dd>${escapeHtml(direction.modelName)}</dd></div>
              <div><dt>耗时</dt><dd>${escapeHtml(formatDuration(direction.latencyMs, direction.startedAt, direction.completedAt))}</dd></div>
              <div><dt>图片</dt><dd>${escapeHtml(direction.images.length)} / ${escapeHtml(direction.expectedImageCount)}</dd></div>
            </dl>
            ${failureMessage ? `
              <div class="direction-failure" role="alert">
                <strong>${escapeHtml(failureCode || "DIRECTION_FAILED")}</strong>
                <span>${escapeHtml(failureMessage)}</span>
              </div>
            ` : ""}
            ${resultId ? `<p class="field-help">结果 ${escapeHtml(shortId(resultId))}${versionId ? ` · 版本 ${escapeHtml(shortId(versionId))}` : ""}</p>` : ""}
            <div class="result-actions">
              ${direction.retryable ? '<button class="button button-small button-secondary" type="button" data-retry-direction>单独重试此方向</button>' : ""}
              ${canSelect ? `<button class="button button-small ${isSelected ? "button-selected" : "button-primary"}" type="button" data-select-direction ${isSelected ? "disabled" : ""}>${isSelected ? "已选择此方向" : "选择此方向"}</button>` : ""}
              ${canRefine ? '<button class="button button-small button-secondary" type="button" data-refine-result>基于此方向细化</button>' : ""}
              ${resultId && !direction.isAcceptanceFixture ? '<button class="button button-small button-ghost" type="button" data-feedback-result>提交反馈</button>' : ""}
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  async handleResultAction(event) {
    const card = event.target.closest("[data-direction-id]");
    if (!card) return;
    const direction = this.allDirectionCards().find((item) => (
      item.directionId === card.dataset.directionId && item.taskId === card.dataset.taskId
    ));
    if (!direction) return;
    const result = direction.primaryResult;
    const actionButton = event.target.closest("button");
    if (actionButton) actionButton.disabled = true;
    if (event.target.closest("[data-retry-direction]")) {
      if (direction.isAcceptanceFixture) {
        this.acceptanceRetryState.set(direction.directionId, "running");
        this.renderResults();
        this.showToast(`验收模拟：正在单独重试“${direction.name}”，其他方向不会重跑`);
        window.setTimeout(() => {
          this.acceptanceRetryState.set(direction.directionId, "succeeded");
          this.renderResults();
          this.showToast(`验收模拟：“${direction.name}”已单独重试成功`);
        }, 750);
        return;
      }
      try {
        const accepted = await this.client.retryTask(direction.taskId, {
          directionId: direction.directionId,
          failedDirectionId: direction.directionId,
          directionIndex: direction.directionIndex,
        }, { idempotencyKey: createId("retry-direction") });
        this.knownTaskIds.add(accepted.taskId);
        await this.refreshTasks();
        this.startPolling();
        this.showToast(`已为“${direction.name}”创建独立重试任务；其他方向保持不变`);
      } catch (error) {
        if (actionButton) actionButton.disabled = false;
        this.reportError(error);
      }
      return;
    }
    if (event.target.closest("[data-select-direction]")) {
      await this.handleDirectionSelect(direction);
      return;
    }
    if (!result) {
      if (actionButton) actionButton.disabled = false;
      return;
    }
    if (event.target.closest("[data-refine-result]")) {
      const form = this.elements.refineForm;
      form.elements.generationId.value = result.generationId || direction.generationId;
      form.elements.selectedResultId.value = result.id || result.resultId;
      form.elements.parentVersionId.value = result.versionId;
      form.querySelector("button[type='submit']").disabled = false;
      this.elements.refineStatus.textContent = `基线 ${shortId(result.versionId)}`;
      this.elements.refineStatus.className = "status-pill approved";
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (event.target.closest("[data-feedback-result]")) {
      const form = this.elements.feedbackForm;
      form.elements.resultId.value = result.id || result.resultId;
      form.querySelector("button[type='submit']").disabled = false;
      this.elements.feedbackStatus.textContent = `目标 ${shortId(result.id || result.resultId)}`;
      this.elements.feedbackStatus.className = "status-pill approved";
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  async handleDirectionSelect(direction) {
    const result = direction.primaryResult;
    if (!result || direction.status !== "succeeded") return;
    const selection = {
      projectId: direction.projectId,
      taskId: direction.taskId,
      generationId: direction.generationId,
      directionId: direction.directionId,
      directionIndex: direction.directionIndex,
      name: direction.name,
      description: direction.description,
      resultId: result.resultId || result.id,
      versionId: result.versionId || null,
      imageSha256: result.imageSha256 || result.imageAsset?.sha256 || result.sha256 || null,
      metadataUri: result.metadataUri || result.imageAsset?.metadataUri || null,
      parentVersionId: result.parentVersionId || null,
      isDemoPlaceholder: Boolean(result.isDemoPlaceholder || direction.isDemoPlaceholder),
      isAcceptanceFixture: Boolean(direction.isAcceptanceFixture),
      sourceMode: this.mode,
      selectedAt: new Date().toISOString(),
      persistence: this.mode === "remote" ? "browser_only" : "browser_indexeddb",
    };

    try {
      if (this.mode === "demo" && this.selectProjectDirection) {
        const receipt = await this.selectProjectDirection(selection);
        selection.persistence = receipt?.persisted ? "project" : "browser_indexeddb";
        selection.projectDirectionId = receipt?.selectedDirectionId || null;
        selection.projectVersionId = receipt?.versionId || null;
      }
      const task = this.tasks.find((item) => item.id === direction.taskId);
      if (task) {
        task.selectedDirectionId = direction.directionId;
        task.selectedResultId = selection.resultId;
      }
      this.saveSelectedDirection(selection);
      if (selection.versionId && direction.generationId) {
        const form = this.elements.refineForm;
        form.elements.generationId.value = direction.generationId;
        form.elements.selectedResultId.value = selection.resultId;
        form.elements.parentVersionId.value = selection.versionId;
        form.querySelector("button[type='submit']").disabled = false;
        this.elements.refineStatus.textContent = `已选 ${direction.name}`;
        this.elements.refineStatus.className = "status-pill approved";
      }
      this.renderResults();
      this.showToast(this.mode === "remote"
        ? `已在本机界面选择“${direction.name}”；当前接口没有选择端点，尚未写入服务器版本`
        : selection.persistence === "project"
          ? `已选择“${direction.name}”，并写入旧版项目方向与版本记录`
          : `已选择“${direction.name}”，本地界面已记录`);
    } catch (error) {
      this.reportError(error);
      this.renderResults();
    }
  }

  async handleRefine(event) {
    event.preventDefault();
    const form = this.elements.refineForm;
    const data = new FormData(form);
    const generationId = data.get("generationId");
    if (!generationId) return;
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      const selectedResult = this.results.find((item) => (item.id || item.resultId) === data.get("selectedResultId"))
        || this.allDirectionCards()
          .map((direction) => direction.primaryResult)
          .find((item) => item && (item.id || item.resultId) === data.get("selectedResultId"));
      const accepted = await this.client.refineGeneration(generationId, {
        selectedResultId: data.get("selectedResultId"),
        originalResultId: data.get("selectedResultId"),
        originalImage: selectedResult?.imageUrl
          ? { url: selectedResult.imageUrl }
          : { resultId: data.get("selectedResultId"), isDemoPlaceholder: Boolean(selectedResult?.isDemoPlaceholder) },
        parentVersionId: data.get("parentVersionId"),
        expectedParentRevision: data.get("parentVersionId"),
        mustKeep: splitList(data.get("mustKeep")),
        changeRequest: text(data.get("changeRequest")),
        customerChangeRequest: text(data.get("customerChangeRequest")),
        referenceImages: fileMetadata(form.elements.referenceImages.files),
        strength: data.get("strength"),
        modelConfig: { modelId: data.get("modelId") },
      }, { idempotencyKey: createId("refine-generation") });
      this.knownTaskIds.add(accepted.taskId);
      await this.refreshTasks();
      this.startPolling();
      form.reset();
      form.querySelector("button[type='submit']").disabled = true;
      this.elements.refineStatus.textContent = "未选择基线";
      this.elements.refineStatus.className = "status-pill";
      this.showToast("已创建子版本任务，父版本关系已固定");
    } catch (error) {
      submit.disabled = false;
      this.reportError(error);
    }
  }

  async handleFeedback(event) {
    event.preventDefault();
    const form = this.elements.feedbackForm;
    const data = new FormData(form);
    const resultId = data.get("resultId");
    if (!resultId) return;
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      const receipt = await this.client.submitResultFeedback(resultId, {
        role: data.get("role"),
        dimensions: {
          requirementMatch: Number(data.get("requirementMatch")),
          directionQuality: Number(data.get("directionQuality")),
          communicationValue: Number(data.get("communicationValue")),
        },
        problemTags: splitList(data.get("problemTags")),
        mustKeep: splitList(data.get("mustKeep")),
        changeSuggestions: data.get("changeSuggestions"),
        passed: data.get("passed") === "on",
        qualitySampleCandidate: data.get("qualitySampleCandidate") === "on",
      }, { idempotencyKey: createId("feedback") });
      await this.loadResultsAndVersions();
      form.reset();
      form.querySelector("button[type='submit']").disabled = true;
      this.elements.feedbackStatus.textContent = "未选择结果";
      this.elements.feedbackStatus.className = "status-pill";
      this.showToast(receipt.notice || "反馈已记录，不会自动进入训练");
    } catch (error) {
      submit.disabled = false;
      this.reportError(error);
    }
  }

  renderVersions() {
    if (!this.versions.length) {
      this.elements.versionTrack.innerHTML = '<p class="empty-inline">完成生成任务后会出现版本关系。</p>';
      return;
    }
    this.elements.versionTrack.innerHTML = this.versions.map((version) => `
      <article class="ai-version-node">
        <div class="version-node-marker">V${escapeHtml(version.number || "?")}</div>
        <div>
          <div class="card-topline"><h4>${escapeHtml(shortId(version.id))}</h4><span class="status-pill ${version.isDemoPlaceholder ? "pending" : "approved"}">${version.isDemoPlaceholder ? "DEMO" : "结果"}</span></div>
          <p>父版本：<code>${escapeHtml(version.parentVersionId ? shortId(version.parentVersionId) : "ROOT")}</code></p>
          <p class="field-help">任务 ${escapeHtml(shortId(version.sourceTaskId))} · 模型 ${escapeHtml(version.modelSnapshot?.displayName || version.modelId || "—")} · Prompt ${escapeHtml(shortId(version.promptVersionId))} · K ${escapeHtml(version.knowledgeRevisionIds?.length ?? 0)} · 反馈 ${escapeHtml(version.feedbackCount ?? 0)}</p>
        </div>
      </article>
    `).join("");
  }

  async handlePromptCreate(event) {
    event.preventDefault();
    const form = this.elements.promptForm;
    const data = new FormData(form);
    try {
      await this.client.createPromptVersion({
        name: data.get("name"),
        content: data.get("content"),
        changeNote: data.get("changeNote"),
        testPassed: data.get("testPassed") === "on",
      }, { idempotencyKey: createId("prompt-version") });
      form.reset();
      await this.loadResources();
      this.showToast("提示词草稿已创建，历史版本未覆盖");
    } catch (error) {
      this.reportError(error);
    }
  }

  async handlePromptPublish(event) {
    const card = event.target.closest("[data-prompt-id]");
    if (!card || !event.target.closest("[data-publish-prompt]")) return;
    try {
      await this.client.publishPromptVersion(card.dataset.promptId, {
        expectedCurrentVersionId: this.prompts.find((item) => item.status === "official")?.id || null,
      }, { idempotencyKey: createId("publish-prompt") });
      await this.loadResources();
      this.showToast("测试通过的提示词版本已设为正式版");
    } catch (error) {
      this.reportError(error);
    }
  }

  async handlePromptCompare() {
    const leftId = this.elements.compareLeft.value;
    const rightId = this.elements.compareRight.value;
    if (!leftId || !rightId || leftId === rightId) {
      this.showToast("请选择两个不同的提示词版本", true);
      return;
    }
    try {
      const diff = await this.client.comparePromptVersions(leftId, rightId);
      this.elements.promptDiff.innerHTML = `
        <div class="prompt-diff-summary">${escapeHtml(diff.summary || "请人工核对两个版本")}</div>
        <div class="prompt-diff-columns">
          <article><strong>P${escapeHtml(diff.left.version)} · ${escapeHtml(diff.left.name)}</strong><pre>${escapeHtml(diff.left.content)}</pre></article>
          <article><strong>P${escapeHtml(diff.right.version)} · ${escapeHtml(diff.right.name)}</strong><pre>${escapeHtml(diff.right.content)}</pre></article>
        </div>
      `;
      this.elements.promptDiff.classList.remove("is-hidden");
    } catch (error) {
      this.reportError(error);
    }
  }

  async removeProjectData(projectId) {
    this.stopPolling();
    try {
      window.localStorage.removeItem(this.selectionStorageKey());
    } catch {
      // Ignore storage restrictions while clearing project-local runtime state.
    }
    if (this.mode === "demo") {
      for (const storeName of ["aiRequirements", "aiTasks", "aiResults", "aiFeedback"]) {
        const records = await this.database.getAll(storeName);
        for (const record of records.filter((item) => item.projectId === projectId)) {
          await this.database.delete(storeName, record.id);
        }
      }
    }
    this.parsedRequirement = null;
    this.confirmedRequirement = null;
    this.knowledgeHits = [];
    this.tasks = [];
    this.results = [];
    this.versions = [];
    this.selectedDirection = null;
    this.knownTaskIds.clear();
    this.resetRequirementReview();
    this.renderKnowledgeHits();
    this.renderTasks();
    this.renderResults();
    this.renderVersions();
    this.refreshProjectOptions();
  }

  async resetAfterClear() {
    this.stopPolling();
    try {
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith("gold-ai:selected-direction:"))
        .forEach((key) => window.localStorage.removeItem(key));
    } catch {
      // Ignore storage restrictions; IndexedDB cleanup remains authoritative.
    }
    this.parsedRequirement = null;
    this.confirmedRequirement = null;
    this.knowledgeHits = [];
    this.tasks = [];
    this.results = [];
    this.versions = [];
    this.selectedDirection = null;
    this.knownTaskIds.clear();
    this.elements.requirementForm.reset();
    this.elements.refineForm.reset();
    this.elements.feedbackForm.reset();
    this.resetRequirementReview();
    this.renderKnowledgeHits();
    this.renderTasks();
    this.renderResults();
    this.renderVersions();
    this.refreshProjectOptions();
    await this.loadResources();
  }

  reportError(error, toast = true) {
    const prefix = error instanceof AiClientError && error.code ? `[${error.code}] ` : "";
    if (toast) {
      this.showToast(`${prefix}${error.message}`, true);
    }
  }
}

export async function initializeAiWorkbench(options) {
  return new AiWorkbench(options).initialize();
}
