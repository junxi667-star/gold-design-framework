import {
  buildProjectExport,
  confirmVersion,
  createKnowledgeItem,
  createProject,
  refinementOptions,
  reviewKnowledgeItem,
  selectDirection,
} from "./domain.js";
import { LocalDatabase } from "./db.js";
import { isDemoMode, seedDemoDataIfRequested } from "./demo-seed.js";
import { frameworkCapabilities, MockDesignProvider } from "./providers.js";
import { initializeAiWorkbench } from "./ai-workbench.js";

const database = new LocalDatabase();
const designProvider = new MockDesignProvider();
const photoUrls = new Set();

let projects = [];
let knowledgeItems = [];
let activeProject = null;
let toastTimer = null;
let pendingPreviewUrl = null;
let aiWorkbench = null;

const briefForm = document.querySelector("#brief-form");
const directionsSection = document.querySelector("#directions-section");
const directionsGrid = document.querySelector("#directions-grid");
const refinementSection = document.querySelector("#refinement-section");
const refinementForm = document.querySelector("#refinement-form");
const versionsSection = document.querySelector("#versions-section");
const versionsList = document.querySelector("#versions-list");
const knowledgeForm = document.querySelector("#knowledge-form");
const knowledgeList = document.querySelector("#knowledge-list");
const approvedKnowledgeOptions = document.querySelector("#approved-knowledge-options");
const photoPreview = document.querySelector("#photo-preview");
const toast = document.querySelector("#toast");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function setCurrentStep(step) {
  const order = ["brief", "direction", "refine", "confirm"];
  const currentIndex = order.indexOf(step);
  document.querySelectorAll(".stepper li").forEach((item) => {
    item.classList.toggle("is-current", order.indexOf(item.dataset.step) <= currentIndex);
  });
}

function setBriefFormLocked(locked) {
  briefForm.querySelectorAll("input, select, textarea, button").forEach((control) => {
    control.disabled = locked;
  });
}

function renderApprovedKnowledge() {
  const approved = knowledgeItems.filter((item) => item.reviewStatus === "approved");
  if (approved.length === 0) {
    approvedKnowledgeOptions.innerHTML = '<span class="empty-inline">目前没有已批准资料，可先到“专家资料”录入并审核。</span>';
    return;
  }

  approvedKnowledgeOptions.innerHTML = approved
    .map(
      (item) => `
        <label class="check-card">
          <input type="checkbox" name="knowledgeRefs" value="${escapeHtml(item.id)}" />
          <span>${escapeHtml(item.title)} · ${escapeHtml(item.sourceNote)}</span>
        </label>
      `,
    )
    .join("");
}

function renderDirections() {
  if (!activeProject?.directions?.length) {
    directionsSection.classList.add("is-hidden");
    directionsGrid.innerHTML = "";
    return;
  }

  directionsSection.classList.remove("is-hidden");
  directionsGrid.innerHTML = activeProject.directions
    .map((direction) => {
      const isSelected = direction.id === activeProject.selectedDirectionId;
      const knowledgeNote = direction.knowledgeRefs.length
        ? `关联 ${direction.knowledgeRefs.length} 条已审核资料（首版仅记录引用）`
        : "未关联专家资料";
      return `
        <article class="direction-card ${isSelected ? "is-selected" : ""}">
          <div class="placeholder-art ${escapeHtml(direction.placeholderKey)}">
            <span>DEMO 占位 · 非 AI 图片</span>
          </div>
          <div class="direction-content">
            <h4>${escapeHtml(direction.title)}</h4>
            <p>${escapeHtml(direction.concept)}</p>
            <div class="tag-row">
              ${direction.keywords.map((keyword) => `<span class="tag">${escapeHtml(keyword)}</span>`).join("")}
            </div>
            <p class="field-help">${escapeHtml(knowledgeNote)}</p>
            <button class="button ${isSelected ? "button-secondary" : "button-primary"}" type="button" data-direction-id="${escapeHtml(direction.id)}" ${isSelected ? "disabled" : ""}>
              ${isSelected ? "当前方向" : activeProject.selectedDirectionId ? "切换到此方向" : "选择这个方向"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderRefinement() {
  const visible = Boolean(activeProject?.selectedDirectionId);
  refinementSection.classList.toggle("is-hidden", !visible);
  if (!visible) {
    return;
  }

  document.querySelector("#refinement-options").innerHTML = refinementOptions
    .map(
      (option) => `
        <label class="chip" title="${escapeHtml(option.group)}">
          <input type="checkbox" name="optionIds" value="${escapeHtml(option.id)}" />
          <span>${escapeHtml(option.label)}</span>
        </label>
      `,
    )
    .join("");
}

function renderVersions() {
  const versions = activeProject?.versions ?? [];
  versionsSection.classList.toggle("is-hidden", versions.length === 0);
  if (versions.length === 0) {
    versionsList.innerHTML = "";
    return;
  }

  versionsList.innerHTML = [...versions]
    .reverse()
    .map((version) => {
      const confirmed = activeProject.confirmedVersionId === version.id;
      const current = activeProject.currentVersionId === version.id;
      return `
        <article class="version-card ${confirmed ? "is-confirmed" : ""}">
          <div class="card-topline">
            <div>
              <h4>V${version.number} ${current ? "· 当前版本" : ""}</h4>
              <span class="status-pill">${version.changeType === "direction_selected" ? "方向选择" : "细化记录"}</span>
            </div>
            ${confirmed ? '<span class="status-pill approved">已确认</span>' : `<button class="button button-small button-secondary" type="button" data-confirm-version="${escapeHtml(version.id)}">确认此版本</button>`}
          </div>
          <p>${escapeHtml(version.changeSummary)}</p>
          ${version.unresolvedRequests.length ? `<p><strong>尚未解析的客户原话：</strong>${escapeHtml(version.unresolvedRequests.join("；"))}</p>` : ""}
          <p class="field-help">${formatDate(version.createdAt)} · 仅记录交互与占位版本</p>
        </article>
      `;
    })
    .join("");
}

function fillBriefFormFromProject() {
  if (!activeProject) {
    setBriefFormLocked(false);
    return;
  }
  for (const [name, value] of Object.entries(activeProject.brief)) {
    const control = briefForm.elements.namedItem(name);
    if (control) {
      control.value = value;
    }
  }
  setBriefFormLocked(true);
}

function renderDesign() {
  renderApprovedKnowledge();
  fillBriefFormFromProject();
  renderDirections();
  renderRefinement();
  renderVersions();

  if (activeProject?.confirmedVersionId) {
    setCurrentStep("confirm");
  } else if (activeProject?.selectedDirectionId) {
    setCurrentStep("refine");
  } else if (activeProject?.directions.length) {
    setCurrentStep("direction");
  } else {
    setCurrentStep("brief");
  }
}

function statusLabel(status) {
  return {
    pending: "待审核",
    approved: "已批准",
    rejected: "已拒绝",
    needs_revision: "需修改",
  }[status] ?? status;
}

function kindLabel(kind) {
  return kind === "photo" ? "参考照片" : "专业文本";
}

async function getPhotoUrl(item) {
  if (item.kind !== "photo") {
    return null;
  }
  const asset = await database.get("assets", item.photo.assetId);
  if (!asset?.blob) {
    return null;
  }
  const url = URL.createObjectURL(asset.blob);
  photoUrls.add(url);
  return url;
}

async function renderKnowledge() {
  for (const url of photoUrls) {
    URL.revokeObjectURL(url);
  }
  photoUrls.clear();

  if (knowledgeItems.length === 0) {
    knowledgeList.innerHTML = '<p class="empty-inline">还没有专家资料。先录入原始文本或照片，再进行人工审核。</p>';
    return;
  }

  const cards = await Promise.all(
    [...knowledgeItems]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(async (item) => {
        const photoUrl = await getPhotoUrl(item);
        const contentPreview = item.kind === "text"
          ? escapeHtml(item.textContent.slice(0, 160))
          : escapeHtml(item.photo.caption);
        return `
          <article class="knowledge-card" data-knowledge-id="${escapeHtml(item.id)}">
            <div class="knowledge-card-header">
              <div>
                <h4>${escapeHtml(item.title)}</h4>
                <div class="knowledge-meta">
                  <span>${kindLabel(item.kind)}</span>
                  <span>${escapeHtml(item.category)}</span>
                  <span>来源：${escapeHtml(item.sourceNote)}</span>
                </div>
              </div>
              <span class="status-pill ${escapeHtml(item.reviewStatus)}">${statusLabel(item.reviewStatus)}</span>
            </div>
            ${photoUrl ? `<img class="knowledge-thumb" src="${photoUrl}" alt="${escapeHtml(item.photo.caption)}" />` : ""}
            <p>${contentPreview}${item.kind === "text" && item.textContent.length > 160 ? "…" : ""}</p>
            <p class="field-help">${formatDate(item.createdAt)} · 仅本地保存，未解析、未训练</p>
            ${item.reviewer ? `<p><strong>审核：</strong>${escapeHtml(item.reviewer)} · ${escapeHtml(item.reviewNote || "无补充说明")}</p>` : ""}
            <div class="knowledge-actions">
              <input class="reviewer-input" aria-label="审核人" placeholder="审核人" maxlength="60" value="${escapeHtml(item.reviewer)}" />
              <input class="review-note-input" aria-label="审核说明" placeholder="审核说明（可选）" maxlength="200" value="${escapeHtml(item.reviewNote)}" />
              <button class="button button-small button-secondary" type="button" data-review="approved">批准</button>
              <button class="button button-small button-secondary" type="button" data-review="needs_revision">需修改</button>
              <button class="button button-small button-secondary" type="button" data-review="rejected">拒绝</button>
              <button class="button button-small button-danger-quiet" type="button" data-delete-knowledge>删除</button>
            </div>
          </article>
        `;
      }),
  );

  knowledgeList.innerHTML = cards.join("");
}

function renderCapabilities() {
  const labels = {
    externalNetwork: ["外部联网", "首版关闭"],
    realImageGeneration: ["真实图片生成", "首版关闭"],
    photoRecognition: ["照片识别", "首版关闭"],
    ocr: ["OCR 文本识别", "首版关闭"],
    modelTraining: ["模型训练", "首版关闭"],
    aiInterfaceContracts: ["AI 接口工作台", "当前可用"],
    localTaskSimulation: ["本地任务模拟", "当前可用"],
    sameOriginApiClient: ["同源 API 客户端", "显式启用"],
    localKnowledgeReview: ["本地专家审核", "当前可用"],
    localVersionHistory: ["设计版本历史", "当前可用"],
  };
  document.querySelector("#capability-grid").innerHTML = Object.entries(frameworkCapabilities)
    .map(([key, enabled]) => `
      <article class="capability-card ${enabled ? "is-on" : ""}">
        <strong>${escapeHtml(labels[key][0])}</strong>
        <span>${enabled ? "●" : "○"} ${escapeHtml(labels[key][1])}</span>
      </article>
    `)
    .join("");
}

function renderStatusSummary() {
  const approvedCount = knowledgeItems.filter((item) => item.reviewStatus === "approved").length;
  document.querySelector("#status-summary").innerHTML = `
    <strong>本地数据概况</strong>
    <p>${projects.length} 个设计项目 · ${knowledgeItems.length} 条专家资料 · ${approvedCount} 条已批准资料</p>
    <p class="field-help">数据只存在当前浏览器；清除浏览器网站数据也会删除这些记录。</p>
  `;
}

async function renderAll() {
  renderDesign();
  await renderKnowledge();
  renderCapabilities();
  renderStatusSummary();
  await aiWorkbench?.refreshContext();
}

async function saveActiveProject() {
  await database.put("projects", activeProject);
  const index = projects.findIndex((project) => project.id === activeProject.id);
  if (index >= 0) {
    projects[index] = activeProject;
  } else {
    projects.push(activeProject);
  }
}

briefForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const formData = new FormData(briefForm);
    const knowledgeRefs = formData.getAll("knowledgeRefs");
    let project = createProject(Object.fromEntries(formData), knowledgeRefs);
    project = await designProvider.prepareDirections(project, knowledgeItems);
    activeProject = project;
    await saveActiveProject();
    renderDesign();
    renderStatusSummary();
    await aiWorkbench?.refreshContext();
    directionsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("已建立 3 个本地演示方向");
  } catch (error) {
    showToast(error.message, true);
  }
});

directionsGrid.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-direction-id]");
  if (!button || !activeProject) {
    return;
  }
  try {
    activeProject = selectDirection(activeProject, button.dataset.directionId);
    await saveActiveProject();
    renderDesign();
    refinementSection.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("已记录方向选择并建立版本");
  } catch (error) {
    showToast(error.message, true);
  }
});

refinementForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeProject) {
    return;
  }
  try {
    const formData = new FormData(refinementForm);
    activeProject = await designProvider.refine(activeProject, {
      optionIds: formData.getAll("optionIds"),
      customerRequest: formData.get("customerRequest"),
    });
    await saveActiveProject();
    refinementForm.reset();
    renderDesign();
    versionsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("已保留客户反馈并建立下一版占位记录");
  } catch (error) {
    showToast(error.message, true);
  }
});

versionsList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-confirm-version]");
  if (!button || !activeProject) {
    return;
  }
  try {
    activeProject = confirmVersion(activeProject, button.dataset.confirmVersion);
    await saveActiveProject();
    renderDesign();
    showToast("已确认当前设计方向；这仍是框架占位版本");
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelector("#export-project").addEventListener("click", () => {
  if (!activeProject) {
    return;
  }
  const content = JSON.stringify(buildProjectExport(activeProject, knowledgeItems), null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `黄金设计-${activeProject.brief.theme}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelector("#reset-project").addEventListener("click", async () => {
  if (!activeProject || !window.confirm("确定清除当前设计及其全部版本吗？专家资料不会删除。")) {
    return;
  }
  await database.delete("projects", activeProject.id);
  projects = projects.filter((project) => project.id !== activeProject.id);
  const removedProjectId = activeProject.id;
  activeProject = null;
  briefForm.reset();
  setBriefFormLocked(false);
  renderDesign();
  renderStatusSummary();
  await aiWorkbench?.removeProjectData(removedProjectId);
  showToast("当前设计已清除");
});

document.querySelector("#knowledge-kind").addEventListener("change", (event) => {
  const isPhoto = event.target.value === "photo";
  document.querySelector("#knowledge-text-group").classList.toggle("is-hidden", isPhoto);
  document.querySelector("#knowledge-photo-group").classList.toggle("is-hidden", !isPhoto);
  knowledgeForm.elements.textContent.required = !isPhoto;
  knowledgeForm.elements.photo.required = isPhoto;
  knowledgeForm.elements.caption.required = isPhoto;
});

knowledgeForm.elements.photo.addEventListener("change", () => {
  if (pendingPreviewUrl) {
    URL.revokeObjectURL(pendingPreviewUrl);
    pendingPreviewUrl = null;
  }
  const file = knowledgeForm.elements.photo.files[0];
  if (!file) {
    photoPreview.classList.add("is-hidden");
    photoPreview.innerHTML = "";
    return;
  }
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type) || file.size > 2 * 1024 * 1024) {
    knowledgeForm.elements.photo.value = "";
    photoPreview.classList.add("is-hidden");
    showToast("照片仅支持 JPG、PNG、WebP，且不能超过 2 MB", true);
    return;
  }
  pendingPreviewUrl = URL.createObjectURL(file);
  photoPreview.innerHTML = `
    <img src="${pendingPreviewUrl}" alt="待保存照片预览" />
    <div><strong>${escapeHtml(file.name)}</strong><p class="field-help">${Math.ceil(file.size / 1024)} KB · 仅预览，不识别内容</p></div>
  `;
  photoPreview.classList.remove("is-hidden");
});

knowledgeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  let savedAssetId = null;
  try {
    const formData = new FormData(knowledgeForm);
    const kind = formData.get("kind");
    let photo = null;

    if (kind === "photo") {
      const file = knowledgeForm.elements.photo.files[0];
      if (!file) {
        throw new Error("请选择一张照片");
      }
      if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type) || file.size > 2 * 1024 * 1024) {
        throw new Error("照片仅支持 JPG、PNG、WebP，且不能超过 2 MB");
      }
      savedAssetId = `asset-${crypto.randomUUID()}`;
      await database.put("assets", {
        id: savedAssetId,
        blob: file,
        name: file.name,
        type: file.type,
        size: file.size,
      });
      photo = {
        assetId: savedAssetId,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        caption: formData.get("caption"),
      };
    }

    const item = createKnowledgeItem({
      ...Object.fromEntries(formData),
      kind,
      rightsConfirmed: formData.get("rightsConfirmed") === "on",
      photo,
    });
    await database.put("knowledge", item);
    knowledgeItems.push(item);
    knowledgeForm.reset();
    document.querySelector("#knowledge-text-group").classList.remove("is-hidden");
    document.querySelector("#knowledge-photo-group").classList.add("is-hidden");
    knowledgeForm.elements.textContent.required = true;
    knowledgeForm.elements.photo.required = false;
    knowledgeForm.elements.caption.required = false;
    photoPreview.classList.add("is-hidden");
    photoPreview.innerHTML = "";
    if (pendingPreviewUrl) {
      URL.revokeObjectURL(pendingPreviewUrl);
      pendingPreviewUrl = null;
    }
    await renderAll();
    showToast("资料已保存为待审核状态；系统没有解析或学习其内容");
  } catch (error) {
    if (savedAssetId) {
      await database.delete("assets", savedAssetId);
    }
    showToast(error.message, true);
  }
});

knowledgeList.addEventListener("click", async (event) => {
  const card = event.target.closest("[data-knowledge-id]");
  if (!card) {
    return;
  }
  const item = knowledgeItems.find((candidate) => candidate.id === card.dataset.knowledgeId);
  if (!item) {
    return;
  }

  const reviewButton = event.target.closest("[data-review]");
  const deleteButton = event.target.closest("[data-delete-knowledge]");

  try {
    if (reviewButton) {
      const reviewer = card.querySelector(".reviewer-input").value;
      const note = card.querySelector(".review-note-input").value;
      const updated = reviewKnowledgeItem(item, {
        decision: reviewButton.dataset.review,
        reviewer,
        note,
      });
      await database.put("knowledge", updated);
      knowledgeItems = knowledgeItems.map((candidate) => candidate.id === updated.id ? updated : candidate);
      await renderAll();
      showToast(`资料状态已更新为“${statusLabel(updated.reviewStatus)}”`);
    }

    if (deleteButton && window.confirm(`确定删除资料“${item.title}”吗？此操作无法恢复。`)) {
      await database.delete("knowledge", item.id);
      if (item.kind === "photo") {
        await database.delete("assets", item.photo.assetId);
      }
      knowledgeItems = knowledgeItems.filter((candidate) => candidate.id !== item.id);
      await renderAll();
      showToast("资料已删除");
    }
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-button").forEach((item) => item.classList.toggle("is-active", item === button));
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("is-active", view.id === `view-${button.dataset.view}`));
  });
});

document.querySelector("#clear-all-data").addEventListener("click", async () => {
  if (!window.confirm("确定清除所有本地设计、版本、专家资料和照片吗？此操作无法恢复。")) {
    return;
  }
  await database.clearAll();
  projects = [];
  knowledgeItems = [];
  activeProject = null;
  briefForm.reset();
  knowledgeForm.reset();
  await aiWorkbench?.resetAfterClear();
  await renderAll();
  showToast("全部本地数据已清除");
});

async function initialize() {
  try {
    const demoMode = isDemoMode(window.location.search);
    document.querySelector("#demo-mode-banner").classList.toggle("is-hidden", !demoMode);
    await seedDemoDataIfRequested(database, designProvider, window.location.search);
    [projects, knowledgeItems] = await Promise.all([
      database.getAll("projects"),
      database.getAll("knowledge"),
    ]);
    activeProject = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
    await renderAll();
    aiWorkbench = await initializeAiWorkbench({
      database,
      getProjects: () => [...projects],
      getKnowledgeItems: () => [...knowledgeItems],
      showToast,
    });
  } catch (error) {
    showToast(`初始化失败：${error.message}`, true);
  }
}

initialize();
