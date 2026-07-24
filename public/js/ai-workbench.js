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
  failed: "失败",
  cancelled: "已取消",
};

export class AiWorkbench {
  constructor({ database, getProjects, getKnowledgeItems, showToast }) {
    this.database = database;
    this.getProjects = getProjects;
    this.getKnowledgeItems = getKnowledgeItems;
    this.showToast = showToast;
    this.mode = "demo";
    this.client = null;
    this.models = [];
    this.prompts = [];
    this.publishedPrompt = null;
    this.parsedRequirement = null;
    this.confirmedRequirement = null;
    this.knowledgeHits = [];
    this.tasks = [];
    this.results = [];
    this.versions = [];
    this.knownTaskIds = new Set();
    this.pollTimer = null;
    this.polling = false;

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

  async switchMode(mode) {
    this.stopPolling();
    this.mode = mode === "remote" ? "remote" : "demo";
    this.elements.mode.value = this.mode;
    this.client = this.createClient(this.mode);
    this.models = [];
    this.prompts = [];
    this.publishedPrompt = null;
    this.tasks = [];
    this.results = [];
    this.versions = [];
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
      const [models, prompts, publishedPrompt] = await Promise.all([
        this.client.listModels(),
        this.client.listPromptTemplates(),
        this.client.getPublishedPrompt(),
      ]);
      this.models = models;
      this.prompts = prompts;
      this.publishedPrompt = publishedPrompt;
      this.renderModels();
      this.renderPrompts();
      this.elements.connection.textContent = this.mode === "demo" ? "本地 · 非真实 AI" : "同源 API · 已连接";
      this.elements.connection.classList.toggle("is-connected", this.mode === "remote");
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
          <p class="field-help">供应商：${escapeHtml(model.provider || "未声明")} · 最大参考图 ${escapeHtml(capabilities.maxReferenceImages ?? "—")} · ${model.isDemo ? "本地占位模型" : "接口模型"}</p>
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
    const data = new FormData(this.elements.reviewForm);
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
    this.confirmedRequirement = {
      id: createId("requirement-confirmed"),
      parentRevisionId: this.parsedRequirement.id,
      projectId: this.parsedRequirement.projectId,
      status: "confirmed",
      structuredRequirements,
      referenceImages: this.parsedRequirement.parsed.referenceImages ?? [],
      confirmedAt: new Date().toISOString(),
    };
    await this.database.put("aiRequirements", this.confirmedRequirement);
    this.elements.reviewStatus.textContent = `已人工确认 · ${shortId(this.confirmedRequirement.id)}`;
    this.elements.reviewStatus.className = "status-pill approved";
    this.updateRuntimeSnapshot();
    this.showToast("人工校准需求已保存为新修订");
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
      this.tasks = snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      this.renderTasks();
      if (snapshots.some((task) => task.status === "succeeded")) {
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

  renderTasks() {
    if (!this.tasks.length) {
      this.elements.taskList.innerHTML = '<p class="empty-inline">还没有生成任务。</p>';
      return;
    }
    this.elements.taskList.innerHTML = this.tasks.map((task) => {
      const canCancel = new Set(["queued", "running", "cancel_requested"]).has(task.status);
      const canRetry = new Set(["failed", "cancelled"]).has(task.status) && task.retryable;
      return `
        <article class="ai-task-card" data-task-id="${escapeHtml(task.id)}">
          <div class="card-topline">
            <div>
              <h4>${task.operation === "refine" ? "细化任务" : "设计生成任务"} · ${escapeHtml(shortId(task.id))}</h4>
              <code>${escapeHtml(task.generationId)}</code>
            </div>
            <span class="task-status task-status-${escapeHtml(task.status)}">${escapeHtml(TASK_LABELS[task.status] || task.status)}</span>
          </div>
          <progress class="task-progress" max="100" value="${Math.max(0, Math.min(100, Number(task.progress) || 0))}" aria-label="完成进度 ${escapeHtml(task.progress)}%">${escapeHtml(task.progress)}%</progress>
          <div class="task-meta-grid">
            <span>步骤 <strong>${escapeHtml(task.currentStep || "—")}</strong></span>
            <span>进度 <strong>${escapeHtml(task.progress ?? 0)}%</strong></span>
            <span>结果 <strong>${escapeHtml(task.completedImages?.length ?? 0)} / ${escapeHtml(task.expectedCount ?? "—")}</strong></span>
            <span>开始 <strong>${formatDate(task.startedAt)}</strong></span>
            <span>完成 <strong>${formatDate(task.completedAt)}</strong></span>
          </div>
          ${task.error ? `<p class="task-error">${escapeHtml(task.error.message || task.error)}</p>` : ""}
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
      const results = this.tasks.flatMap((task) => (task.completedImages ?? []).map((result) => ({
        ...result,
        sourceTaskId: task.id,
        generationId: result.generationId || task.generationId,
        projectId: task.projectId,
        modelSnapshot: task.modelSnapshot,
        promptVersionId: task.promptVersionId,
        knowledgeRevisionIds: task.knowledgeRevisionIds ?? [],
      })));
      this.results = results;
    }
    const versionPayload = await this.client.listProjectVersions(projectId);
    this.versions = Array.isArray(versionPayload) ? versionPayload : versionPayload?.items ?? [];
    this.renderResults();
    this.renderVersions();
  }

  renderResults() {
    if (!this.results.length) {
      this.elements.resultsGrid.innerHTML = '<p class="empty-inline">任务完成后，结果会显示在这里。</p>';
      return;
    }
    this.elements.resultsGrid.innerHTML = this.results.map((result) => {
      const imageUrl = safeImageUrl(result.imageUrl);
      return `
        <article class="ai-result-card" data-result-id="${escapeHtml(result.id || result.resultId)}">
          ${imageUrl
            ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(result.title || "设计结果")}" />`
            : `<div class="ai-result-placeholder ${escapeHtml(result.previewKey || "minimal")}"><span>LOCAL CONTRACT DEMO<br />非真实生成图片</span></div>`}
          <div class="ai-result-content">
            <div class="card-topline"><h4>${escapeHtml(result.title || "设计结果")}</h4><span class="status-pill approved">完成</span></div>
            <p class="field-help">结果 ${escapeHtml(shortId(result.id || result.resultId))} · 版本 ${escapeHtml(shortId(result.versionId))}</p>
            <div class="result-actions">
              <button class="button button-small button-primary" type="button" data-refine-result>基于此结果细化</button>
              <button class="button button-small button-secondary" type="button" data-feedback-result>提交反馈</button>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  handleResultAction(event) {
    const card = event.target.closest("[data-result-id]");
    if (!card) return;
    const result = this.results.find((item) => (item.id || item.resultId) === card.dataset.resultId);
    if (!result) return;
    if (event.target.closest("[data-refine-result]")) {
      const form = this.elements.refineForm;
      form.elements.generationId.value = result.generationId;
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

  async handleRefine(event) {
    event.preventDefault();
    const form = this.elements.refineForm;
    const data = new FormData(form);
    const generationId = data.get("generationId");
    if (!generationId) return;
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      const selectedResult = this.results.find((item) => (item.id || item.resultId) === data.get("selectedResultId"));
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
    this.parsedRequirement = null;
    this.confirmedRequirement = null;
    this.knowledgeHits = [];
    this.tasks = [];
    this.results = [];
    this.versions = [];
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
