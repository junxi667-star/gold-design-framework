const EXAMPLE = "设计一款适合年轻女性日常佩戴的新中式黄金戒指，使用简化祥云元素，不要太复杂。";
const TERMINAL_JOBS = new Set(["succeeded", "failed"]);

const $ = (selector) => document.querySelector(selector);
const elements = {
  serviceBadge: $("#serviceBadge"), walletButton: $("#walletButton"), walletStatus: $("#walletStatus"),
  imageStatus: $("#imageStatus"), storageStatus: $("#storageStatus"), chainStatus: $("#chainStatus"),
  customerText: $("#customerText"), accessCode: $("#accessCode"), exampleButton: $("#exampleButton"), generateButton: $("#generateButton"),
  jobPanel: $("#jobPanel"), progressBar: $("#progressBar"), progressText: $("#progressText"), progressPercent: $("#progressPercent"), errorBox: $("#errorBox"),
  workspace: $("#workspace"), projectSummary: $("#projectSummary"), timeline: $("#timeline"), refreshTimelineButton: $("#refreshTimelineButton"),
  changeRequest: $("#changeRequest"), reviseButton: $("#reviseButton"), agentQuestion: $("#agentQuestion"), askAgentButton: $("#askAgentButton"), agentAnswer: $("#agentAnswer"),
  toast: $("#toast"),
};

const state = {
  config: null,
  projectId: localStorage.getItem("jewelchain-project-id") || "",
  walletAddress: "",
  busy: false,
  timeline: null,
  toastTimer: null,
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

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => { elements.toast.hidden = true; }, isError ? 7000 : 3200);
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

async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const code = elements.accessCode.value.trim();
  if (code) headers["X-Demo-Access-Code"] = code;
  let response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    throw new Error("无法连接 JewelChain 后端，请确认项目已经启动。", { cause: error });
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
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.originalText;
}

function setProgress(progress, message) {
  const value = Math.max(0, Math.min(100, Number(progress) || 0));
  elements.jobPanel.hidden = false;
  elements.progressBar.style.width = `${value}%`;
  elements.progressPercent.textContent = `${Math.round(value)}%`;
  elements.progressText.textContent = message || "处理中";
}

function statusLabel(status) {
  return ({
    generating: "正在生成", generation_failed: "生成失败", awaiting_confirmation: "等待确认",
    awaiting_wallet_signature: "等待钱包签名", tx_submitted: "交易确认中", chain_confirmed: "已登记 Monad",
    registration_failed: "登记失败", finalized: "最终确认版",
  })[status] || status || "未知";
}

function stateClass(status) {
  if (["chain_confirmed", "finalized"].includes(status)) return status;
  if (["generation_failed", "registration_failed"].includes(status)) return "failed";
  return "";
}

async function loadConfig() {
  try {
    const config = await api("/api/hackathon/config");
    state.config = config;
    const generation = config.generation || {};
    const workerMode = generation.mode === "worker";
    const onlineWorkers = Number(config.workerStatus?.onlineWorkers || generation.worker?.onlineWorkers || 0);
    const directConfigured = Boolean(generation.directProvider?.configured || config.imageProvider?.configured);
    const imageOk = workerMode ? onlineWorkers > 0 : generation.mode === "hybrid" ? (onlineWorkers > 0 || directConfigured) : directConfigured;
    if (workerMode) {
      elements.imageStatus.textContent = onlineWorkers > 0 ? `Image Worker 在线（${onlineWorkers}）` : "等待 Image Worker 上线";
    } else if (generation.mode === "hybrid") {
      elements.imageStatus.textContent = onlineWorkers > 0 ? `Worker 优先（${onlineWorkers} 在线）` : directConfigured ? "Master API 直调兜底" : "生图端未配置";
    } else {
      elements.imageStatus.textContent = directConfigured ? `${generation.directProvider?.model || config.imageProvider?.model || "图片模型"} 已配置` : "未配置 API Key";
    }
    elements.storageStatus.textContent = config.storage?.effectiveMode === "supabase" ? "Supabase" : "本地存储";
    elements.serviceBadge.textContent = imageOk ? "Master 与生图端已就绪" : workerMode ? "Master 已启动，Worker 未上线" : "需要配置 .env";
    elements.serviceBadge.className = `badge ${imageOk ? "ok" : "error"}`;
    if (config.demoAccessCodeRequired) elements.accessCode.placeholder = "必须填写项目访问码";
  } catch {
    elements.serviceBadge.textContent = "后端连接失败";
    elements.serviceBadge.className = "badge error";
    elements.imageStatus.textContent = "检查失败";
    elements.storageStatus.textContent = "检查失败";
    elements.chainStatus.textContent = "检查失败";
    return;
  }
  api("/api/hackathon/chain/status").then((chain) => {
    elements.chainStatus.textContent = chain.reachable && chain.contractCodePresent ? "Monad 合约可访问" : "链或合约待检查";
  }).catch(() => {
    elements.chainStatus.textContent = "RPC 暂时不可访问";
  });
}

async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("当前浏览器没有检测到 MetaMask。电脑请安装 MetaMask；手机请在 MetaMask 内置浏览器中打开本页面。");
  }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new Error("没有获得钱包地址");
  state.walletAddress = accounts[0].toLowerCase();
  elements.walletButton.textContent = short(state.walletAddress, 6, 4);
  elements.walletStatus.textContent = short(state.walletAddress, 6, 4);
  return state.walletAddress;
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
  while (Date.now() - started < 6 * 60 * 1000) {
    const job = await api(`/api/hackathon/jobs/${encodeURIComponent(jobId)}`);
    setProgress(job.progress, job.currentStep);
    if (job.status === "succeeded") return job;
    if (job.status === "failed") throw new Error(job.error?.message || "图片生成失败");
    await new Promise((resolve) => setTimeout(resolve, 1300));
  }
  throw new Error("图片生成等待超过 6 分钟，请检查火山方舟状态后刷新。" );
}

async function createDesign() {
  clearError();
  const customerText = elements.customerText.value.trim();
  if (customerText.length < 6) return showError(new Error("请至少输入一句完整需求"));
  setBusy(elements.generateButton, true, "Agent 正在创建 V1…");
  setProgress(3, "正在创建设计项目");
  try {
    const result = await api("/api/hackathon/designs", { method: "POST", body: { customerText } });
    state.projectId = result.projectId;
    localStorage.setItem("jewelchain-project-id", state.projectId);
    await pollJob(result.jobId);
    await refreshTimeline();
    showToast("V1 已生成，请连接钱包并登记到 Monad");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(elements.generateButton, false);
  }
}

async function reviseDesign() {
  clearError();
  if (!state.projectId || !state.timeline) return showError(new Error("请先创建 V1"));
  const changeRequest = elements.changeRequest.value.trim();
  if (changeRequest.length < 2) return showError(new Error("请填写修改要求"));
  const versions = state.timeline.versions || [];
  const parent = [...versions].reverse().find((item) => item.status === "chain_confirmed");
  if (!parent) return showError(new Error("请先将上一版本成功登记到 Monad"));
  setBusy(elements.reviseButton, true, "Agent 正在生成下一版…");
  setProgress(3, "正在创建修改任务");
  try {
    const result = await api(`/api/hackathon/designs/${encodeURIComponent(state.projectId)}/revisions`, {
      method: "POST",
      body: { parentVersionId: parent.id, changeRequest },
    });
    await pollJob(result.jobId);
    elements.changeRequest.value = "";
    await refreshTimeline();
    showToast(`V${result.versionNumber} 已生成`);
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
  throw new Error("交易已提交，但等待确认超时。稍后点击刷新可继续检查。" );
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
    ? `<button class="button secondary" data-action="finalize" data-version-id="${escapeHtml(version.id)}">设为最终确认版</button>`
    : "";
  const explorer = finalRecord?.explorerUrl || registerRecord?.explorerUrl;
  return `
    <article class="version-card">
      <img class="version-image" src="${escapeHtml(version.imageUrl || "")}" alt="V${version.versionNumber} 珠宝设计效果图" />
      <div>
        <div class="version-top">
          <div><h3>V${version.versionNumber}</h3><span class="muted">${escapeHtml(version.changeRequest || "初始设计版本")}</span></div>
          <span class="version-state ${stateClass(version.status)}">${escapeHtml(statusLabel(version.status))}</span>
        </div>
        <p class="version-description">${escapeHtml(version.understandingSummary || `${requirement.style || ""}${requirement.productType || "珠宝设计"}`)}</p>
        <div class="version-fields">
          <div><span>产品 / 形状</span><b>${escapeHtml(requirement.productType || "-")} · ${escapeHtml(requirement.shape || requirement.structureForms?.[0] || "-")}</b></div>
          <div><span>风格 / 元素</span><b>${escapeHtml(requirement.style || "-")} · ${escapeHtml((requirement.motifs || []).join("、") || "-")}</b></div>
          <div><span>contentHash</span><code title="${escapeHtml(version.contentHash || "")}">${escapeHtml(short(version.contentHash || "尚未冻结"))}</code></div>
          <div><span>父版本 Hash</span><code title="${escapeHtml(version.parentContentHash || "")}">${escapeHtml(short(version.parentContentHash || "-"))}</code></div>
          <div><span>交易 Hash</span><code title="${escapeHtml(registerRecord?.txHash || version.txHash || "")}">${escapeHtml(short(registerRecord?.txHash || version.txHash || "尚未提交"))}</code></div>
          <div><span>链下存储</span><b>${escapeHtml(version.storageMode || "尚未冻结")}</b></div>
        </div>
        <div class="version-actions">
          ${registerAction}${finalizeAction}
          ${explorer ? `<a class="button ghost" href="${escapeHtml(explorer)}" target="_blank" rel="noreferrer">在 Explorer 查看</a>` : ""}
          ${version.metadataUri ? `<a class="button ghost" href="${escapeHtml(version.metadataUri)}" target="_blank" rel="noreferrer">查看 Metadata</a>` : ""}
        </div>
        ${version.storageWarning ? `<div class="version-warning">${escapeHtml(version.storageWarning)}</div>` : ""}
      </div>
    </article>`;
}

async function refreshTimeline() {
  if (!state.projectId) return;
  try {
    const timeline = await api(`/api/hackathon/designs/${encodeURIComponent(state.projectId)}/timeline`);
    state.timeline = timeline;
    elements.workspace.hidden = false;
    elements.projectSummary.innerHTML = `<div><strong>${escapeHtml(timeline.project.title)}</strong><br><span>${escapeHtml(timeline.project.localDesignId)} · 当前 ${timeline.versions.length} 个版本${timeline.project.finalVersionId ? " · 已有最终确认版" : ""}</span></div>${timeline.project.finalVersionId ? '<button class="button secondary" data-download-certificate type="button">下载最终凭证 JSON</button>' : ''}`;
    elements.timeline.innerHTML = timeline.versions.map(renderVersion).join("") || "<p>暂无版本</p>";
    const latest = timeline.versions.at(-1);
    elements.reviseButton.disabled = !latest || latest.status !== "chain_confirmed" || Boolean(timeline.project.finalVersionId);
  } catch (error) {
    if (error.code === "PROJECT_NOT_FOUND") {
      localStorage.removeItem("jewelchain-project-id");
      state.projectId = "";
      elements.workspace.hidden = true;
      return;
    }
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
  if (!state.projectId) return showError(new Error("请先创建设计项目"));
  const query = String(question || "").trim();
  if (!query) return;
  elements.agentAnswer.textContent = "Agent 正在读取版本记录与链上证据…";
  try {
    const result = await api("/api/hackathon/agent/query", { method: "POST", body: { projectId: state.projectId, question: query } });
    elements.agentAnswer.innerHTML = `<strong>${escapeHtml(result.answer)}</strong><div class="evidence">${(result.evidence || []).map((item) => `<div><b>${escapeHtml(item.label)}：</b>${item.value?.startsWith?.("http") ? `<a href="${escapeHtml(item.value)}" target="_blank" rel="noreferrer">${escapeHtml(item.value)}</a>` : escapeHtml(item.value)}</div>`).join("")}</div>`;
  } catch (error) {
    elements.agentAnswer.textContent = error.message;
  }
}

elements.exampleButton.addEventListener("click", () => { elements.customerText.value = EXAMPLE; elements.customerText.focus(); });
elements.generateButton.addEventListener("click", createDesign);
elements.reviseButton.addEventListener("click", reviseDesign);
elements.walletButton.addEventListener("click", () => connectWallet().catch(showError));
elements.refreshTimelineButton.addEventListener("click", refreshTimeline);
elements.projectSummary.addEventListener("click", (event) => {
  if (event.target.closest("[data-download-certificate]")) downloadCertificate().catch(showError);
});

elements.askAgentButton.addEventListener("click", () => askAgent(elements.agentQuestion.value));
document.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => askAgent(button.dataset.question)));
elements.timeline.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  button.disabled = true;
  try {
    if (button.dataset.action === "register") await sendPreparedTransaction(button.dataset.versionId, "register");
    if (button.dataset.action === "finalize") await sendPreparedTransaction(button.dataset.versionId, "finalize");
    if (button.dataset.action === "check-register") await pollChain(button.dataset.versionId, "register");
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
});

if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", (accounts) => {
    state.walletAddress = accounts?.[0]?.toLowerCase?.() || "";
    elements.walletButton.textContent = state.walletAddress ? short(state.walletAddress, 6, 4) : "连接钱包";
    elements.walletStatus.textContent = state.walletAddress ? short(state.walletAddress, 6, 4) : "未连接";
  });
}

await loadConfig();
if (state.projectId) await refreshTimeline();
