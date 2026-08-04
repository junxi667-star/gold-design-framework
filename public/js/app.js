const EXAMPLE = "设计一款适合年轻女性日常佩戴的新中式黄金戒指，使用简化祥云元素，造型轻盈，不要太复杂。";
const RUNTIME_CONFIG = Object.freeze(window.JEWELCHAIN_CONFIG || {});
const API_BASE_URL = String(RUNTIME_CONFIG.apiBaseUrl || "").replace(/\/+$/, "");

function resolveApiUrl(pathname) {
  const value = String(pathname || "");
  if (/^https?:\/\//i.test(value)) return value;
  const normalized = value.startsWith("/") ? value : `/${value}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalized}` : normalized;
}

function resolveAssetUrl(value) {
  const raw = String(value || "");
  if (!raw || /^(https?:|data:|blob:)/i.test(raw)) return raw;
  return resolveApiUrl(raw);
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  serviceBadge: $("#serviceBadge"),
  walletButton: $("#walletButton"),
  walletStatus: $("#walletStatus"),
  imageStatus: $("#imageStatus"),
  storageStatus: $("#storageStatus"),
  chainStatus: $("#chainStatus"),
  refreshStatusButton: $("#refreshStatusButton"),
  customerText: $("#customerText"),
  customerTextCount: $("#customerTextCount"),
  accessCode: $("#accessCode"),
  accessCodeRequirement: $("#accessCodeRequirement"),
  exampleButton: $("#exampleButton"),
  generateButton: $("#generateButton"),
  jobPanel: $("#jobPanel"),
  pipelineSteps: $("#pipelineSteps"),
  progressBar: $("#progressBar"),
  progressText: $("#progressText"),
  progressPercent: $("#progressPercent"),
  errorBox: $("#errorBox"),
  workspace: $("#workspace"),
  projectSummary: $("#projectSummary"),
  timeline: $("#timeline"),
  refreshTimelineButton: $("#refreshTimelineButton"),
  newProjectButton: $("#newProjectButton"),
  copyProjectLinkButton: $("#copyProjectLinkButton"),
  changeRequest: $("#changeRequest"),
  changeRequestCount: $("#changeRequestCount"),
  reviseButton: $("#reviseButton"),
  agentQuestion: $("#agentQuestion"),
  askAgentButton: $("#askAgentButton"),
  agentAnswer: $("#agentAnswer"),
  compareSection: $("#compareSection"),
  compareView: $("#compareView"),
  compareBase: $("#compareBase"),
  compareTop: $("#compareTop"),
  compareOverlay: $("#compareOverlay"),
  compareDivider: $("#compareDivider"),
  compareRange: $("#compareRange"),
  compareLeftLabel: $("#compareLeftLabel"),
  compareRightLabel: $("#compareRightLabel"),
  scrollCreateButton: $("#scrollCreateButton"),
  flowGuideButton: $("#flowGuideButton"),
  mobilePrimaryButton: $("#mobilePrimaryButton"),
  imageModal: $("#imageModal"),
  modalImage: $("#modalImage"),
  modalCaption: $("#modalCaption"),
  modalClose: $("#modalClose"),
  toast: $("#toast"),
  particleCanvas: $("#particleCanvas"),
  offlineNotice: $("#offlineNotice"),
  offlineTitle: $("#offlineTitle"),
  offlineText: $("#offlineText"),
  retryMasterButton: $("#retryMasterButton"),
};

const state = {
  config: null,
  projectId: localStorage.getItem("jewelchain-project-id") || "",
  walletAddress: "",
  timeline: null,
  toastTimer: null,
  statusBusy: false,
  masterOnline: false,
};

elements.accessCode.value = sessionStorage.getItem("jewelchain-access-code") || "";
elements.accessCode.addEventListener("input", () => sessionStorage.setItem("jewelchain-access-code", elements.accessCode.value));

function short(value, left = 8, right = 6) {
  const raw = String(value || "");
  return raw.length > left + right + 3 ? `${raw.slice(0, left)}…${raw.slice(-right)}` : raw;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function iconCopy() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
}

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => { elements.toast.hidden = true; }, isError ? 7000 : 3500);
}

function showError(error) {
  elements.errorBox.hidden = false;
  elements.errorBox.textContent = error?.message || String(error);
  showToast(error?.message || "操作失败", true);
}

function clearError() {
  elements.errorBox.hidden = true;
  elements.errorBox.textContent = "";
}

async function copyText(value, successMessage = "已复制") {
  const text = String(value || "");
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  showToast(successMessage);
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const code = elements.accessCode.value.trim();
  if (code) headers["X-Demo-Access-Code"] = code;
  let response;
  try {
    response = await fetch(resolveApiUrl(path), {
      method,
      headers,
      mode: "cors",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const target = API_BASE_URL || "当前域名";
    throw new Error(`Master（调度服务）暂时离线（${target}）。网站仍可浏览，实时生图与 Agent 功能将在服务恢复后可用。`, { cause: error });
  }
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { payload = { error: { message: raw || `HTTP ${response.status}` } }; }
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `请求失败（HTTP ${response.status}）`);
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    throw error;
  }
  return payload?.data ?? payload;
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent.trim();
  button.disabled = busy;
  const labelNode = button.querySelector("span:last-child");
  if (labelNode && button.id === "generateButton") labelNode.textContent = busy ? label : button.dataset.originalText;
  else button.textContent = busy ? label : button.dataset.originalText;
}

function setPipeline(activeStep, complete = false) {
  if (!elements.pipelineSteps) return;
  elements.pipelineSteps.querySelectorAll("[data-pipeline-step]").forEach((item) => {
    const step = Number(item.dataset.pipelineStep);
    item.classList.toggle("done", complete || step < activeStep);
    item.classList.toggle("active", !complete && step === activeStep);
  });
}

function progressToStep(progress, message = "") {
  const lower = String(message).toLowerCase();
  if (lower.includes("保存") || lower.includes("上传") || lower.includes("完成")) return 4;
  if (lower.includes("worker") || lower.includes("生成") || lower.includes("seedream") || lower.includes("图片")) return 3;
  if (lower.includes("prompt") || lower.includes("提示词")) return 2;
  if (lower.includes("解析") || lower.includes("理解") || lower.includes("创建")) return 1;
  if (progress >= 96) return 5;
  if (progress >= 78) return 4;
  if (progress >= 32) return 3;
  if (progress >= 16) return 2;
  return 1;
}

function setProgress(progress, message) {
  const value = Math.max(0, Math.min(100, Number(progress) || 0));
  elements.jobPanel.hidden = false;
  elements.progressBar.style.width = `${value}%`;
  elements.progressPercent.textContent = `${Math.round(value)}%`;
  elements.progressText.textContent = message || "处理中";
  setPipeline(progressToStep(value, message), value >= 100);
}

function updateCounter(input, counter, max) {
  if (!input || !counter) return;
  counter.textContent = `${input.value.length} / ${max}`;
}

function statusLabel(status) {
  return ({
    generating: "正在生成",
    generation_failed: "生成失败",
    awaiting_confirmation: "等待您确认设计",
    awaiting_wallet_signature: "等待钱包签名",
    tx_submitted: "交易已提交，等待链上确认",
    chain_confirmed: "已登记到 Monad",
    registration_failed: "登记失败",
    finalized: "最终版已确认",
  })[status] || status || "未知";
}

function stateClass(status) {
  if (["chain_confirmed", "finalized"].includes(status)) return status;
  if (["generation_failed", "registration_failed"].includes(status)) return "failed";
  return "";
}

function updateWalletUi(address) {
  state.walletAddress = address?.toLowerCase?.() || "";
  const walletLabel = elements.walletButton.querySelector("span");
  if (walletLabel) walletLabel.textContent = state.walletAddress ? short(state.walletAddress, 6, 4) : "连接钱包";
  elements.walletStatus.textContent = state.walletAddress ? short(state.walletAddress, 6, 4) : "未连接";
  elements.walletButton.classList.toggle("connected", Boolean(state.walletAddress));
}

function setMasterAvailability(online, message = "") {
  state.masterOnline = Boolean(online);
  if (elements.offlineNotice) elements.offlineNotice.hidden = state.masterOnline;
  if (elements.offlineTitle) elements.offlineTitle.textContent = state.masterOnline ? "Master（调度服务）已恢复" : "Master（调度服务）暂时离线";
  if (elements.offlineText && message) elements.offlineText.textContent = message;
  for (const button of [elements.generateButton, elements.reviseButton, elements.askAgentButton, elements.refreshTimelineButton]) {
    if (!button) continue;
    button.disabled = !state.masterOnline;
    button.title = state.masterOnline ? "" : "Master（调度服务）离线，服务恢复后自动可用";
  }
}

async function loadConfig() {
  if (state.statusBusy) return;
  state.statusBusy = true;
  elements.refreshStatusButton?.classList.add("spinning");
  try {
    const config = await api("/api/hackathon/config");
    state.config = config;
    setMasterAvailability(true);
    const generation = config.generation || {};
    const workerMode = generation.mode === "worker";
    const onlineWorkers = Number(config.workerStatus?.onlineWorkers || generation.worker?.onlineWorkers || 0);
    const directConfigured = Boolean(generation.directProvider?.configured || config.imageProvider?.configured);
    const imageOk = workerMode ? onlineWorkers > 0 : generation.mode === "hybrid" ? (onlineWorkers > 0 || directConfigured) : directConfigured;

    if (workerMode) {
      elements.imageStatus.textContent = onlineWorkers > 0 ? `生图端在线（${onlineWorkers}）` : "等待生图端上线";
    } else if (generation.mode === "hybrid") {
      elements.imageStatus.textContent = onlineWorkers > 0 ? `生图端优先（${onlineWorkers} 在线）` : directConfigured ? "Master API 直接调用（备用）" : "生图端未配置";
    } else {
      elements.imageStatus.textContent = directConfigured ? `${generation.directProvider?.model || config.imageProvider?.model || "图片模型"} 已配置` : "未配置 API Key";
    }

    elements.storageStatus.textContent = config.storage?.effectiveMode === "supabase" ? "Supabase 云端存储" : "本地安全存储";
    elements.serviceBadge.innerHTML = `<i></i>${imageOk ? "调度服务与生图端已就绪" : workerMode ? "调度服务在线，等待生图端" : "调度服务在线，生图配置待检查"}`;
    elements.serviceBadge.className = `badge ${imageOk ? "ok" : "warning"}`;
    if (config.demoAccessCodeRequired) {
      elements.accessCode.placeholder = "该项目需要访问码，请填写";
      if (elements.accessCodeRequirement) elements.accessCodeRequirement.textContent = "必填";
    } else {
      elements.accessCode.placeholder = "如无需访问码，请留空";
      if (elements.accessCodeRequirement) elements.accessCodeRequirement.textContent = "选填";
    }

    const chain = await api("/api/hackathon/chain/status");
    elements.chainStatus.textContent = chain.reachable && chain.contractCodePresent ? "Monad 合约可访问" : "正在检查链上合约";
  } catch (error) {
    setMasterAvailability(false, "网站介绍与动画效果仍可正常浏览；实时生图、项目数据和 Agent 问答将在调度服务恢复后自动可用。");
    elements.serviceBadge.innerHTML = "<i></i>Master（调度服务）暂时离线";
    elements.serviceBadge.className = "badge warning";
    elements.imageStatus.textContent = "等待调度服务 / 生图端";
    elements.storageStatus.textContent = "调度服务离线";
    elements.chainStatus.textContent = "实时检查暂停";
  } finally {
    state.statusBusy = false;
    elements.refreshStatusButton?.classList.remove("spinning");
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("当前浏览器没有检测到 MetaMask。电脑请安装 MetaMask；手机请在 MetaMask 内置浏览器中打开本页面。");
  }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new Error("没有获得钱包地址");
  updateWalletUi(accounts[0]);
  return state.walletAddress;
}

async function restoreWallet() {
  if (!window.ethereum) return;
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    if (accounts?.[0]) updateWalletUi(accounts[0]);
  } catch { /* wallet restoration is optional */ }
}

async function ensureMonadNetwork() {
  if (!state.config) await loadConfig();
  if (!window.ethereum) throw new Error("未检测到 MetaMask");
  const chain = state.config.chain;
  const current = await window.ethereum.request({ method: "eth_chainId" });
  if (String(current).toLowerCase() === String(chain.chainIdHex).toLowerCase()) return;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainIdHex }] });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: chain.chainIdHex,
        chainName: chain.chainName,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls,
        blockExplorerUrls: chain.blockExplorerUrls,
      }],
    });
  }
}

async function pollJob(jobId) {
  const started = Date.now();
  const foregroundWaitMs = 75 * 1000;
  while (Date.now() - started < foregroundWaitMs) {
    const job = await api(`/api/hackathon/jobs/${encodeURIComponent(jobId)}`);
    setProgress(job.progress, job.currentStep);
    if (job.status === "succeeded") {
      setProgress(100, "设计版本已生成并保存");
      return job;
    }
    if (job.status === "failed") throw new Error(job.error?.message || "图片生成失败");
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const job = await api(`/api/hackathon/jobs/${encodeURIComponent(jobId)}`);
  setProgress(Math.max(30, Number(job.progress || 0)), "任务已保存在 Master 队列；Image Worker 上线后会自动领取并继续执行");
  return { ...job, deferredToWorker: true };
}

async function createDesign() {
  clearError();
  if (!state.masterOnline) return showError(new Error("Master（调度服务）暂时离线。网站仍可浏览，服务恢复后再提交生图任务。"));
  const customerText = elements.customerText.value.trim();
  if (customerText.length < 6) return showError(new Error("请输入更详细的需求描述，至少包含一句完整描述"));
  setBusy(elements.generateButton, true, "正在生成第一版设计（V1）…");
  setProgress(3, "正在创建设计项目");
  elements.generateButton.scrollIntoView({ behavior: "smooth", block: "center" });
  try {
    const result = await api("/api/hackathon/designs", { method: "POST", body: { customerText } });
    state.projectId = result.projectId;
    localStorage.setItem("jewelchain-project-id", state.projectId);
    const job = await pollJob(result.jobId);
    await refreshTimeline();
    showToast(job.deferredToWorker ? "任务已进入 Master 队列，Image Worker 上线后会自动领取" : "V1 已生成，请连接钱包并登记到 Monad");
    elements.workspace.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showError(error);
  } finally {
    setBusy(elements.generateButton, false);
  }
}

async function reviseDesign() {
  clearError();
  if (!state.masterOnline) return showError(new Error("Master（调度服务）暂时离线，暂时无法创建新版本。"));
  if (!state.projectId || !state.timeline) return showError(new Error("请先创建 V1"));
  const changeRequest = elements.changeRequest.value.trim();
  if (changeRequest.length < 2) return showError(new Error("请填写修改要求"));
  const versions = state.timeline.versions || [];
  const parent = [...versions].reverse().find((item) => ["chain_confirmed", "finalized"].includes(item.status));
  if (!parent) return showError(new Error("请先登记当前版本。登记后，系统才能将它记录为下一版的来源。"));
  setBusy(elements.reviseButton, true, "Agent 正在生成下一版…");
  setProgress(3, "正在创建修改任务");
  try {
    const result = await api(`/api/hackathon/designs/${encodeURIComponent(state.projectId)}/revisions`, {
      method: "POST",
      body: { parentVersionId: parent.id, changeRequest },
    });
    const job = await pollJob(result.jobId);
    elements.changeRequest.value = "";
    updateCounter(elements.changeRequest, elements.changeRequestCount, 400);
    await refreshTimeline();
    showToast(job.deferredToWorker ? `V${result.versionNumber} 已排队，Worker 上线后自动生成` : `V${result.versionNumber} 已生成`);
    elements.compareSection?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    showError(error);
  } finally {
    setBusy(elements.reviseButton, false);
  }
}

async function sendPreparedTransaction(versionId, kind) {
  clearError();
  const wallet = state.walletAddress || await connectWallet();
  await ensureMonadNetwork();
  const preparePath = kind === "finalize" ? "prepare-finalize" : "prepare-registration";
  showToast(kind === "finalize" ? "正在准备最终确认交易" : "Agent 正在保存版本并计算 Hash");
  const prepared = await api(`/api/hackathon/versions/${encodeURIComponent(versionId)}/${preparePath}`, {
    method: "POST",
    body: { walletAddress: wallet },
  });
  if (prepared.alreadyConfirmed || prepared.alreadyFinalized) {
    await refreshTimeline();
    return;
  }
  const transaction = { ...prepared.transaction, from: wallet };
  const txHash = await window.ethereum.request({ method: "eth_sendTransaction", params: [transaction] });
  await api(`/api/hackathon/versions/${encodeURIComponent(versionId)}/chain-submission`, {
    method: "POST",
    body: { txHash, walletAddress: wallet, kind },
  });
  showToast("交易已提交，正在等待 Monad 确认");
  await pollChain(versionId, kind);
}

async function pollChain(versionId, kind) {
  const started = Date.now();
  while (Date.now() - started < 2 * 60 * 1000) {
    const status = await api(`/api/hackathon/versions/${encodeURIComponent(versionId)}/chain-status?kind=${kind}`);
    if (status.status === "confirmed") {
      showToast(kind === "finalize" ? "最终版本已在 Monad 确认" : "设计版本已登记到 Monad");
      await refreshTimeline();
      return status;
    }
    if (status.status === "failed") throw new Error(status.errorMessage || "Monad 交易失败");
    await new Promise((resolve) => setTimeout(resolve, 1600));
  }
  throw new Error("交易已提交，但等待链上确认超时。稍后点击刷新可继续检查。");
}

function hashField(label, value, fallback) {
  const raw = value || "";
  return `<div><span>${escapeHtml(label)}</span><div class="hash-row"><code title="${escapeHtml(raw)}">${escapeHtml(short(raw || fallback))}</code>${raw ? `<button class="copy-mini" type="button" data-action="copy" data-copy="${escapeHtml(raw)}" title="复制${escapeHtml(label)}">${iconCopy()}</button>` : ""}</div></div>`;
}

function renderVersion(version) {
  const requirement = version.structuredRequirement || {};
  const records = version.chainRecords || [];
  const registerRecord = records.find((item) => item.kind === "register");
  const finalRecord = records.find((item) => item.kind === "finalize");
  const registerAction = ["awaiting_confirmation", "awaiting_wallet_signature", "registration_failed"].includes(version.status)
    ? `<button class="button primary" data-action="register" data-version-id="${escapeHtml(version.id)}">登记 V${version.versionNumber} 到 Monad</button>`
    : version.status === "tx_submitted"
      ? `<button class="button secondary" data-action="check-register" data-version-id="${escapeHtml(version.id)}">检查登记状态</button>`
      : "";
  const finalizeAction = version.status === "chain_confirmed"
    ? `<button class="button secondary" data-action="finalize" data-version-id="${escapeHtml(version.id)}">确认为最终版</button>`
    : "";
  const explorer = finalRecord?.explorerUrl || registerRecord?.explorerUrl;
  const transactionHash = registerRecord?.txHash || version.txHash || "";
  const imageUrl = resolveAssetUrl(version.imageUrl || "");
  return `
    <article class="version-card" data-version-number="${version.versionNumber}">
      <button class="version-media" type="button" data-action="preview" data-image="${escapeHtml(imageUrl)}" data-caption="V${version.versionNumber} · ${escapeHtml(version.changeRequest || "初始设计版本")}">
        <img class="version-image" src="${escapeHtml(imageUrl)}" alt="V${version.versionNumber} 珠宝设计效果图" loading="lazy" />
      </button>
      <div class="version-body">
        <div class="version-top">
          <div class="version-title">
            <span class="version-number">V${version.versionNumber}</span>
            <div><h3>${version.versionNumber === 1 ? "初始设计" : "迭代设计"}</h3><span class="muted">${escapeHtml(version.changeRequest || "AI 根据客户需求生成")}</span></div>
          </div>
          <span class="version-state ${stateClass(version.status)}">${escapeHtml(statusLabel(version.status))}</span>
        </div>
        <p class="version-description">${escapeHtml(version.understandingSummary || `${requirement.style || ""}${requirement.productType || "珠宝设计"}`)}</p>
        <div class="version-fields">
          <div><span>产品 / 形状</span><b>${escapeHtml(requirement.productType || "-")} · ${escapeHtml(requirement.shape || requirement.structureForms?.[0] || "-")}</b></div>
          <div><span>风格 / 元素</span><b>${escapeHtml(requirement.style || "-")} · ${escapeHtml((requirement.motifs || []).join("、") || "-")}</b></div>
          ${hashField("内容指纹 (contentHash)", version.contentHash, "尚未生成")}
          ${hashField("上一版指纹", version.parentContentHash, "首版无上一版本")}
          ${hashField("交易哈希", transactionHash, "尚未提交")}
          <div><span>链下存储</span><b>${escapeHtml(version.storageMode || "尚未存储")}</b></div>
        </div>
        <div class="version-actions">
          ${registerAction}${finalizeAction}
          ${explorer ? `<a class="button glass" href="${escapeHtml(explorer)}" target="_blank" rel="noreferrer">在 Explorer 查看</a>` : ""}
          ${version.metadataUri ? `<a class="button glass" href="${escapeHtml(resolveAssetUrl(version.metadataUri))}" target="_blank" rel="noreferrer">查看版本信息</a>` : ""}
        </div>
        ${version.storageWarning ? `<div class="version-warning">${escapeHtml(version.storageWarning)}</div>` : ""}
      </div>
    </article>`;
}

function updateCompare(versions) {
  const usable = versions.filter((item) => item.imageUrl);
  if (usable.length < 2) {
    elements.compareSection.hidden = true;
    return;
  }
  const first = usable[0];
  const latest = usable.at(-1);
  elements.compareSection.hidden = false;
  elements.compareBase.src = resolveAssetUrl(latest.imageUrl);
  elements.compareTop.src = resolveAssetUrl(first.imageUrl);
  elements.compareLeftLabel.textContent = `V${first.versionNumber} 初始`;
  elements.compareRightLabel.textContent = `V${latest.versionNumber} 最新`;
  elements.compareRange.value = "50";
  updateComparePosition(50);
  requestAnimationFrame(syncCompareImageWidth);
}

function syncCompareImageWidth() {
  if (!elements.compareView || elements.compareSection.hidden) return;
  const width = elements.compareView.clientWidth;
  elements.compareTop.style.width = `${width}px`;
}

function updateComparePosition(value) {
  const position = Math.max(0, Math.min(100, Number(value) || 0));
  elements.compareOverlay.style.width = `${position}%`;
  elements.compareDivider.style.left = `${position}%`;
}

async function refreshTimeline() {
  if (!state.projectId || !state.masterOnline) return;
  try {
    const timeline = await api(`/api/hackathon/designs/${encodeURIComponent(state.projectId)}/timeline`);
    state.timeline = timeline;
    elements.workspace.hidden = false;
    elements.mobilePrimaryButton.classList.add("hidden-by-workspace");
    const finalText = timeline.project.finalVersionId ? "最终版已确认" : "等待最终确认";
    elements.projectSummary.innerHTML = `
      <strong>${escapeHtml(timeline.project.title)}</strong><br>
      <span>${escapeHtml(timeline.project.localDesignId)}</span>
      <div class="summary-badges"><span>${timeline.versions.length} 个设计版本</span><span>${escapeHtml(finalText)}</span><span>Monad Testnet</span></div>
      ${timeline.project.finalVersionId ? '<button class="button secondary" data-download-certificate type="button">下载最终凭证 JSON</button>' : ""}`;
    elements.timeline.innerHTML = timeline.versions.map(renderVersion).join("") || "<p>暂无版本</p>";
    updateCompare(timeline.versions);
    const latest = timeline.versions.at(-1);
    elements.reviseButton.disabled = !latest || latest.status !== "chain_confirmed" || Boolean(timeline.project.finalVersionId);
  } catch (error) {
    if (error.code === "PROJECT_NOT_FOUND") {
      resetProject(false);
      return;
    }
    if (!state.masterOnline || String(error.message || "").includes("Master 暂时离线")) return;
    showError(error);
  }
}

async function downloadCertificate() {
  if (!state.projectId) return;
  const certificate = await api(`/api/hackathon/designs/${encodeURIComponent(state.projectId)}/certificate`);
  const blob = new Blob([JSON.stringify(certificate, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${certificate.project.localDesignId}_certificate.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast("最终确认凭证已下载");
}

async function askAgent(question) {
  if (!state.masterOnline) {
    elements.agentAnswer.innerHTML = '<span class="agent-answer-icon">!</span><p>Master（调度服务）暂时离线。网站介绍与动画效果仍可浏览，Agent 问答将在服务恢复后可用。</p>';
    return;
  }
  if (!state.projectId) return showError(new Error("请先创建设计项目"));
  const query = String(question || "").trim();
  if (!query) return;
  elements.agentAnswer.innerHTML = '<span class="agent-answer-icon">AI</span><p>Agent 正在查询版本记录与链上交易证据…</p>';
  try {
    const result = await api("/api/hackathon/agent/query", { method: "POST", body: { projectId: state.projectId, question: query } });
    elements.agentAnswer.innerHTML = `<span class="agent-answer-icon">AI</span><div><strong>${escapeHtml(result.answer)}</strong><div class="evidence">${(result.evidence || []).map((item) => `<div><b>${escapeHtml(item.label)}：</b>${item.value?.startsWith?.("http") ? `<a href="${escapeHtml(item.value)}" target="_blank" rel="noreferrer">${escapeHtml(item.value)}</a>` : escapeHtml(item.value)}</div>`).join("")}</div></div>`;
  } catch (error) {
    elements.agentAnswer.innerHTML = `<span class="agent-answer-icon">!</span><p>${escapeHtml(error.message)}</p>`;
  }
}

function resetProject(scroll = true) {
  localStorage.removeItem("jewelchain-project-id");
  state.projectId = "";
  state.timeline = null;
  elements.workspace.hidden = true;
  elements.compareSection.hidden = true;
  elements.jobPanel.hidden = true;
  elements.customerText.value = "";
  elements.changeRequest.value = "";
  elements.timeline.innerHTML = "";
  elements.mobilePrimaryButton.classList.remove("hidden-by-workspace");
  updateCounter(elements.customerText, elements.customerTextCount, 600);
  updateCounter(elements.changeRequest, elements.changeRequestCount, 400);
  if (scroll) {
    $("#create").scrollIntoView({ behavior: "smooth", block: "start" });
    elements.customerText.focus({ preventScroll: true });
    showToast("已切换到新设计，历史项目仍保存在数据库中");
  }
}

function openImageModal(src, caption) {
  if (!src) return;
  elements.modalImage.src = src;
  elements.modalCaption.textContent = caption || "设计预览";
  elements.imageModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeImageModal() {
  elements.imageModal.hidden = true;
  elements.modalImage.src = "";
  document.body.style.overflow = "";
}

function initRevealAnimations() {
  const revealItems = $$(".reveal");
  if (!("IntersectionObserver" in window)) {
    revealItems.forEach((item) => item.classList.add("visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: .09, rootMargin: "0px 0px -40px" });
  revealItems.forEach((item) => observer.observe(item));
}


function updateMobilePrimary() {
  if (!elements.mobilePrimaryButton) return;
  const shouldShow = window.innerWidth <= 640 && window.scrollY > 520 && elements.workspace.hidden;
  elements.mobilePrimaryButton.classList.toggle("is-visible", shouldShow);
}

function initParticles() {
  const canvas = elements.particleCanvas;
  if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  const pointer = { x: -1000, y: -1000 };
  const palette = ["214,179,106", "139,102,255", "85,214,194", "245,228,190"];

  function buildParticles() {
    const count = window.innerWidth < 640 ? 34 : Math.min(120, Math.round(window.innerWidth / 15));
    particles = Array.from({ length: count }, (_, index) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 2.2 + .6,
      vx: (Math.random() - .5) * .22,
      vy: -(Math.random() * .28 + .04),
      alpha: Math.random() * .28 + .10,
      color: palette[index % palette.length],
      pulse: Math.random() * Math.PI * 2,
      drift: Math.random() * Math.PI * 2,
    }));
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildParticles();
  }

  function drawLinks(time) {
    for (let i = 0; i < particles.length; i += 1) {
      const a = particles[i];
      for (let j = i + 1; j < Math.min(i + 7, particles.length); j += 1) {
        const b = particles[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > 110) continue;
        const alpha = (1 - distance / 110) * .085 * (0.7 + Math.sin(time * .001 + a.pulse) * .3);
        context.beginPath();
        context.strokeStyle = `rgba(214,179,106,${alpha})`;
        context.lineWidth = .9;
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
    }
  }

  function frame(time) {
    context.clearRect(0, 0, width, height);
    drawLinks(time);
    for (const particle of particles) {
      const dx = particle.x - pointer.x;
      const dy = particle.y - pointer.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 120 && distance > 0) {
        particle.x += (dx / distance) * .42;
        particle.y += (dy / distance) * .42;
      }
      particle.x += particle.vx + Math.sin(time * .00055 + particle.drift) * .08;
      particle.y += particle.vy;
      if (particle.y < -10) { particle.y = height + 10; particle.x = Math.random() * width; }
      if (particle.x < -10) particle.x = width + 10;
      if (particle.x > width + 10) particle.x = -10;
      const glow = Math.sin(time * .0014 + particle.pulse) * .10;
      context.beginPath();
      context.fillStyle = `rgba(${particle.color},${Math.max(.05, particle.alpha + glow)})`;
      context.shadowColor = `rgba(${particle.color},.55)`;
      context.shadowBlur = particle.r * 7;
      context.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.strokeStyle = `rgba(${particle.color},${Math.max(.02, particle.alpha * .18)})`;
      context.lineWidth = .7;
      context.moveTo(particle.x, particle.y + particle.r * 4);
      context.lineTo(particle.x - particle.vx * 18, particle.y - 14);
      context.stroke();
    }
    context.shadowBlur = 0;
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", (event) => { pointer.x = event.clientX; pointer.y = event.clientY; }, { passive: true });
  window.addEventListener("pointerleave", () => { pointer.x = -1000; pointer.y = -1000; }, { passive: true });
  resize();
  requestAnimationFrame(frame);
}

// Input helpers
updateCounter(elements.customerText, elements.customerTextCount, 600);
updateCounter(elements.changeRequest, elements.changeRequestCount, 400);
elements.customerText.addEventListener("input", () => updateCounter(elements.customerText, elements.customerTextCount, 600));
elements.changeRequest.addEventListener("input", () => updateCounter(elements.changeRequest, elements.changeRequestCount, 400));

$$('[data-preset]').forEach((button) => button.addEventListener("click", () => {
  elements.customerText.value = button.dataset.preset || EXAMPLE;
  updateCounter(elements.customerText, elements.customerTextCount, 600);
  elements.customerText.focus();
}));
$$('[data-change]').forEach((button) => button.addEventListener("click", () => {
  elements.changeRequest.value = button.dataset.change || "";
  updateCounter(elements.changeRequest, elements.changeRequestCount, 400);
  elements.changeRequest.focus();
}));

elements.exampleButton.addEventListener("click", () => {
  elements.customerText.value = EXAMPLE;
  updateCounter(elements.customerText, elements.customerTextCount, 600);
  elements.customerText.focus();
});
elements.generateButton.addEventListener("click", createDesign);
elements.reviseButton.addEventListener("click", reviseDesign);
elements.walletButton.addEventListener("click", () => connectWallet().catch(showError));
elements.refreshTimelineButton.addEventListener("click", refreshTimeline);
elements.refreshStatusButton.addEventListener("click", () => loadConfig().then(() => showToast(state.masterOnline ? "Master 已连接" : "Master 仍未上线", !state.masterOnline)));
elements.retryMasterButton?.addEventListener("click", () => loadConfig().then(() => {
  if (state.masterOnline) {
    showToast("Master 已恢复连接");
    if (state.projectId) refreshTimeline();
  } else showToast("Master 仍未上线，稍后再试", true);
}));
elements.newProjectButton.addEventListener("click", () => resetProject(true));
elements.copyProjectLinkButton.addEventListener("click", () => copyText(window.location.href, "演示链接已复制"));
elements.scrollCreateButton.addEventListener("click", () => $("#create").scrollIntoView({ behavior: "smooth", block: "start" }));
elements.flowGuideButton.addEventListener("click", () => $("#flowGuide").scrollIntoView({ behavior: "smooth", block: "center" }));
elements.mobilePrimaryButton.addEventListener("click", () => $("#create").scrollIntoView({ behavior: "smooth", block: "start" }));
elements.compareRange.addEventListener("input", () => updateComparePosition(elements.compareRange.value));
window.addEventListener("resize", () => { syncCompareImageWidth(); updateMobilePrimary(); }, { passive: true });
window.addEventListener("scroll", updateMobilePrimary, { passive: true });

elements.projectSummary.addEventListener("click", (event) => {
  if (event.target.closest("[data-download-certificate]")) downloadCertificate().catch(showError);
});

elements.askAgentButton.addEventListener("click", () => askAgent(elements.agentQuestion.value));
elements.agentQuestion.addEventListener("keydown", (event) => {
  if (event.key === "Enter") askAgent(elements.agentQuestion.value);
});
$$('[data-question]').forEach((button) => button.addEventListener("click", () => {
  const question = button.dataset.question || "";
  elements.agentQuestion.value = question;
  askAgent(question);
}));

elements.timeline.addEventListener("click", async (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;
  const action = actionTarget.dataset.action;
  if (action === "copy") return copyText(actionTarget.dataset.copy, "内容已复制");
  if (action === "preview") return openImageModal(actionTarget.dataset.image, actionTarget.dataset.caption);
  if (!(actionTarget instanceof HTMLButtonElement)) return;
  actionTarget.disabled = true;
  try {
    if (action === "register") await sendPreparedTransaction(actionTarget.dataset.versionId, "register");
    if (action === "finalize") await sendPreparedTransaction(actionTarget.dataset.versionId, "finalize");
    if (action === "check-register") await pollChain(actionTarget.dataset.versionId, "register");
  } catch (error) {
    showError(error);
  } finally {
    actionTarget.disabled = false;
  }
});

elements.modalClose.addEventListener("click", closeImageModal);
elements.imageModal.addEventListener("click", (event) => { if (event.target === elements.imageModal) closeImageModal(); });
window.addEventListener("keydown", (event) => { if (event.key === "Escape" && !elements.imageModal.hidden) closeImageModal(); });

if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", (accounts) => updateWalletUi(accounts?.[0] || ""));
  window.ethereum.on?.("chainChanged", () => loadConfig());
}

initRevealAnimations();
initParticles();
updateMobilePrimary();
await Promise.all([loadConfig(), restoreWallet()]);
if (state.projectId && state.masterOnline) await refreshTimeline();
