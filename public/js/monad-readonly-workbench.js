const EVIDENCE_ENDPOINT = "/api/web3/monad-testnet/evidence";
const EXPECTED_CHAIN_ID = 10143;
const EXPECTED_MODE = "monad-testnet-readonly";
const ALLOWED_EXPLORER_HOSTS = new Set(["testnet.monadscan.com"]);
const REQUEST_TIMEOUT_MS = 12_000;

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

function shortHash(value, edge = 8) {
  const normalized = text(value);
  if (!normalized) return "—";
  return normalized.length > edge * 2 + 3
    ? `${normalized.slice(0, edge)}…${normalized.slice(-edge)}`
    : normalized;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function validDateString(value) {
  const normalized = text(value);
  if (!normalized || Number.isNaN(new Date(normalized).getTime())) return "";
  return normalized;
}

function safeExplorerUrl(value, expectedKind = null, expectedValue = null) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !ALLOWED_EXPLORER_HOSTS.has(url.hostname)) return "";
    if (expectedKind && !url.pathname.toLowerCase().startsWith(`/${expectedKind}/`)) return "";
    if (expectedValue && !url.pathname.toLowerCase().includes(String(expectedValue).toLowerCase())) return "";
    return url.href;
  } catch {
    return "";
  }
}

class EvidenceError extends Error {
  constructor(message, code = "MONAD_EVIDENCE_UNAVAILABLE") {
    super(message);
    this.name = "EvidenceError";
    this.code = code;
  }
}

async function fetchEvidence() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(EVIDENCE_ENDPOINT, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      throw new EvidenceError("后端返回了无法识别的证据格式", "INVALID_EVIDENCE_RESPONSE");
    }
    if (!response.ok) {
      const error = payload?.error ?? payload?.data?.error ?? {};
      throw new EvidenceError(
        text(error.message) || `只读证据请求失败（HTTP ${response.status}）`,
        text(error.code) || `HTTP_${response.status}`,
      );
    }
    return payload?.data ?? payload;
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    if (error?.name === "AbortError") {
      throw new EvidenceError("只读证据请求超时", "EVIDENCE_REQUEST_TIMEOUT");
    }
    throw new EvidenceError("无法连接同源只读证据接口", "EVIDENCE_BACKEND_UNREACHABLE");
  } finally {
    window.clearTimeout(timeout);
  }
}

function normalizeEvidence(data) {
  if (!data || typeof data !== "object") {
    throw new EvidenceError("后端没有返回证据对象", "EVIDENCE_EMPTY");
  }
  if (data.error) {
    throw new EvidenceError(
      text(data.error.message) || "后端报告测试网证据冲突",
      text(data.error.code) || "EVIDENCE_CONFLICT",
    );
  }
  if (data.mode !== EXPECTED_MODE) {
    throw new EvidenceError("后端模式不是 Monad Testnet 只读模式", "READONLY_MODE_MISMATCH");
  }
  if (data.network?.chainId !== EXPECTED_CHAIN_ID || data.network?.readOnly !== true) {
    throw new EvidenceError("网络或只读边界校验失败", "TESTNET_BOUNDARY_MISMATCH");
  }

  const status = text(data.evidenceStatus).toLowerCase();
  const isLive = status === "live"
    && data.source === "live-public-rpc"
    && data.stale === false;
  const isCached = status === "cached"
    && data.source === "cached-public-evidence"
    && data.stale === true;
  if (!isLive && !isCached) {
    throw new EvidenceError("LIVE / CACHED 状态字段互相冲突", "EVIDENCE_STATE_CONFLICT");
  }
  if (data.checks?.allChecksPass !== true) {
    throw new EvidenceError("后端证据校验未全部通过", "EVIDENCE_CHECKS_FAILED");
  }
  const expectedCodeStatus = isLive ? "PRESENT" : "PRESENT_AT_LAST_VERIFICATION";
  if (!text(data.contract?.address) || data.contract?.codeStatus !== expectedCodeStatus) {
    throw new EvidenceError("测试网合约代码证据不完整", "CONTRACT_EVIDENCE_INCOMPLETE");
  }

  const transactions = Array.isArray(data.transactions) ? data.transactions : [];
  const versions = Array.isArray(data.versions) ? data.versions : [];
  const requiredKinds = ["DEPLOYMENT", "VERSION_V1", "VERSION_V2", "FINALIZATION"];
  if (!requiredKinds.every((kind) => transactions.some((item) => item.kind === kind && item.status === 1))) {
    throw new EvidenceError("四项交易回执不完整或存在失败状态", "TRANSACTION_EVIDENCE_INCOMPLETE");
  }
  if (versions.length !== 2 || data.versionCount !== 2) {
    throw new EvidenceError("版本数量与冻结证据不一致", "VERSION_COUNT_MISMATCH");
  }
  const v1 = versions.find((item) => item.label === "V1" && item.versionNumber === 1);
  const v2 = versions.find((item) => item.label === "V2" && item.versionNumber === 2);
  if (!v1 || !v2 || v1.parentLabel !== null || v2.parentLabel !== "V1") {
    throw new EvidenceError("V1 → V2 父关系校验失败", "PARENT_RELATIONSHIP_MISMATCH");
  }
  if (
    data.final?.versionNumber !== 2
    || data.final?.finalized !== true
    || data.latest?.versionNumber !== 2
    || data.latest?.finalized !== true
    || v2.finalized !== true
  ) {
    throw new EvidenceError("最终版或最新版本证据不一致", "FINAL_VERSION_MISMATCH");
  }

  return {
    raw: data,
    kind: isLive ? "live" : "cached",
    statusLabel: isLive ? "LIVE VERIFIED" : "CACHED VERIFIED",
    sourceLabel: isLive ? "公开 RPC 实时核验" : "历史核验缓存 · 已过期",
    observedAt: data.observedAt,
    lastSuccessfulAt: validDateString(data.lastSuccessfulAt),
    blockNumber: data.block?.number ?? null,
    network: data.network,
    contract: data.contract,
    transactions,
    versions,
    v1,
    v2,
    final: data.final,
    latest: data.latest,
    versionCount: data.versionCount,
    checks: data.checks,
    boundary: text(data.boundary),
  };
}

class MonadReadonlyWorkbench {
  constructor() {
    this.mode = "local";
    this.evidence = null;
    this.loading = false;
    this.loadedOnce = false;
    this.elements = {
      modeButtons: [...document.querySelectorAll("[data-registry-mode]")],
      localSurface: document.querySelector("#registry-local-surface"),
      monadSurface: document.querySelector("#registry-monad-surface"),
      refresh: document.querySelector("#monad-evidence-refresh"),
      state: document.querySelector("#monad-evidence-state"),
      sourcePill: document.querySelector("#monad-source-pill"),
      chainName: document.querySelector("#monad-chain-name"),
      chainId: document.querySelector("#monad-chain-id"),
      source: document.querySelector("#monad-source"),
      block: document.querySelector("#monad-observed-block"),
      observedAt: document.querySelector("#monad-observed-at"),
      contractAddress: document.querySelector("#monad-contract-address"),
      contractExplorer: document.querySelector("#monad-contract-explorer"),
      grid: document.querySelector("#monad-evidence-grid"),
      v1Parent: document.querySelector("#monad-v1-parent"),
      v2Parent: document.querySelector("#monad-v2-parent"),
      finalState: document.querySelector("#monad-final-state"),
      latestVersion: document.querySelector("#monad-latest-version"),
      finalVersion: document.querySelector("#monad-final-version"),
      versionCount: document.querySelector("#monad-version-count"),
      eventCounts: document.querySelector("#monad-event-counts"),
      checksPill: document.querySelector("#monad-checks-pill"),
      boundary: document.querySelector("#monad-boundary-copy"),
      toast: document.querySelector("#toast"),
    };
  }

  initialize() {
    if (!this.elements.monadSurface || !this.elements.localSurface) return;
    this.elements.modeButtons.forEach((button) => {
      button.addEventListener("click", () => this.activateMode(button.dataset.registryMode));
    });
    this.elements.refresh.addEventListener("click", () => this.load());
    this.elements.monadSurface.addEventListener("click", (event) => this.handleReadonlyAction(event));
    const requestedMode = new URLSearchParams(window.location.search).get("registryMode");
    this.activateMode(requestedMode === "monad" ? "monad" : "local");
  }

  activateMode(mode) {
    this.mode = mode === "monad" ? "monad" : "local";
    const isMonad = this.mode === "monad";
    this.elements.localSurface.hidden = isMonad;
    this.elements.monadSurface.hidden = !isMonad;
    this.elements.modeButtons.forEach((button) => {
      const active = button.dataset.registryMode === this.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (isMonad && !this.loadedOnce && !this.loading) this.load();
  }

  async load() {
    if (this.loading) return;
    this.loading = true;
    this.loadedOnce = true;
    this.evidence = null;
    this.renderLoading();
    try {
      this.evidence = normalizeEvidence(await fetchEvidence());
      this.renderEvidence();
    } catch (error) {
      this.evidence = null;
      this.renderError(error);
    } finally {
      this.loading = false;
      this.elements.refresh.disabled = false;
    }
  }

  renderLoading() {
    this.elements.refresh.disabled = true;
    this.elements.state.className = "monad-evidence-state is-loading";
    this.elements.state.innerHTML = `
      <span class="monad-state-symbol" aria-hidden="true">⋯</span>
      <div><strong>LOADING · 正在读取后端证据</strong><p>只发出一个无参数 GET 请求，不调用任何写接口。</p></div>
    `;
    this.elements.sourcePill.className = "monad-source-pill is-loading";
    this.elements.sourcePill.textContent = "LOADING";
    this.clearEvidenceFields();
    this.renderCardPlaceholders("LOADING", "正在等待只读证据");
  }

  renderEvidence() {
    const evidence = this.evidence;
    const stateClass = evidence.kind === "live" ? "is-live" : "is-cached";
    const stateSymbol = evidence.kind === "live" ? "✓" : "⏱";
    const stateCopy = evidence.kind === "live"
      ? `后端在区块 ${evidence.blockNumber ?? "未返回"} 完成公开 RPC 核验。`
      : `当前展示 ${evidence.lastSuccessfulAt ? formatDate(evidence.lastSuccessfulAt) : "未知"} 的历史核验证据；不是实时状态。`;
    this.elements.state.className = `monad-evidence-state ${stateClass}`;
    this.elements.state.innerHTML = `
      <span class="monad-state-symbol" aria-hidden="true">${stateSymbol}</span>
      <div><strong>${escapeHtml(evidence.statusLabel)}</strong><p>${escapeHtml(stateCopy)}</p></div>
    `;
    this.elements.sourcePill.className = `monad-source-pill ${stateClass}`;
    this.elements.sourcePill.textContent = evidence.statusLabel;
    this.elements.chainName.textContent = text(evidence.network.chainName) || "Monad Testnet";
    this.elements.chainId.textContent = String(evidence.network.chainId);
    this.elements.source.textContent = evidence.sourceLabel;
    this.elements.block.textContent = evidence.blockNumber === null ? "—" : String(evidence.blockNumber);
    this.elements.observedAt.textContent = evidence.kind === "live"
      ? formatDate(evidence.observedAt)
      : evidence.lastSuccessfulAt
        ? formatDate(evidence.lastSuccessfulAt)
        : "未知";
    this.elements.contractAddress.textContent = evidence.contract.address;
    this.configureExplorer(
      this.elements.contractExplorer,
      evidence.contract.explorerUrl,
      "address",
      evidence.contract.address,
    );
    const contractCopy = this.elements.monadSurface.querySelector('[data-monad-copy="contract"]');
    contractCopy.disabled = false;
    contractCopy.dataset.copyValue = evidence.contract.address;
    this.renderCards(evidence);
    this.elements.v1Parent.textContent = "ROOT";
    this.elements.v2Parent.textContent = "V1";
    this.elements.finalState.textContent = "V2 · finalized=true";
    this.elements.latestVersion.textContent = `V${evidence.latest.versionNumber}`;
    this.elements.finalVersion.textContent = `V${evidence.final.versionNumber} · finalized=true`;
    this.elements.versionCount.textContent = String(evidence.versionCount);
    const eventCounts = evidence.checks.eventCounts ?? {};
    this.elements.eventCounts.textContent =
      `Registered ${eventCounts.VersionRegistered ?? "—"} · Finalized ${eventCounts.VersionFinalized ?? "—"}`;
    this.elements.checksPill.className = "monad-checks-pill is-pass";
    this.elements.checksPill.textContent = "ALL CHECKS PASS";
    this.elements.boundary.textContent = evidence.boundary
      || "Monad Testnet 只读证据不代表主网、生产环境、版权登记、真实身份或实物材质。";
  }

  renderCards(evidence) {
    const definitions = [
      { kind: "DEPLOYMENT", index: "01", title: "合约部署", detail: "DesignRegistry", version: null },
      { kind: "VERSION_V1", index: "02", title: "V1 版本登记", detail: "父版本：ROOT", version: evidence.v1 },
      { kind: "VERSION_V2", index: "03", title: "V2 版本登记", detail: "父版本：V1", version: evidence.v2 },
      { kind: "FINALIZATION", index: "04", title: "V2 最终确认", detail: "finalized=true", version: evidence.v2 },
    ];
    this.elements.grid.innerHTML = definitions.map((definition) => {
      const transaction = evidence.transactions.find((item) => item.kind === definition.kind);
      const explorer = safeExplorerUrl(transaction?.explorerUrl, "tx", transaction?.transactionHash);
      const evidenceClass = evidence.kind === "live" ? "is-live" : "is-cached";
      return `
        <article class="monad-evidence-card ${evidenceClass}" data-monad-kind="${escapeHtml(definition.kind)}">
          <div class="monad-card-topline"><span>${definition.index}</span><em>${escapeHtml(evidence.statusLabel)}</em></div>
          <h4>${escapeHtml(definition.title)}</h4>
          <p>${escapeHtml(definition.detail)}</p>
          <dl>
            <div><dt>status</dt><dd>${transaction?.status === 1 ? "SUCCESS · 1" : "ERROR"}</dd></div>
            <div><dt>区块</dt><dd>${escapeHtml(transaction?.blockNumber ?? "—")}</dd></div>
            <div><dt>Tx</dt><dd title="${escapeHtml(transaction?.transactionHash)}">${escapeHtml(shortHash(transaction?.transactionHash))}</dd></div>
          </dl>
          <div class="monad-card-actions">
            <button class="monad-copy-button" type="button" data-copy-value="${escapeHtml(transaction?.transactionHash)}">复制 Tx</button>
            <a class="monad-explorer-link ${explorer ? "" : "is-disabled"}"
              ${explorer ? `href="${escapeHtml(explorer)}" target="_blank" rel="noreferrer"` : 'aria-disabled="true"'}>Explorer</a>
          </div>
        </article>
      `;
    }).join("");
  }

  renderError(error) {
    const code = text(error?.code) || "MONAD_EVIDENCE_UNAVAILABLE";
    const message = text(error?.message) || "测试网只读证据不可用";
    this.elements.state.className = "monad-evidence-state is-error";
    this.elements.state.innerHTML = `
      <span class="monad-state-symbol" aria-hidden="true">!</span>
      <div><strong>ERROR · ${escapeHtml(code)}</strong><p>${escapeHtml(message)}。成功卡片已清空，不会回退为伪实时数据。</p></div>
    `;
    this.elements.sourcePill.className = "monad-source-pill is-error";
    this.elements.sourcePill.textContent = "ERROR";
    this.clearEvidenceFields();
    this.renderCardPlaceholders("ERROR", "证据不可用");
    this.elements.checksPill.className = "monad-checks-pill is-fail";
    this.elements.checksPill.textContent = "CHECKS NOT PROVEN";
    this.elements.boundary.textContent =
      "当前没有可展示的可信测试网证据。请检查同源后端状态；前端不会把错误、冲突或空数据标记为 LIVE / CACHED。";
  }

  clearEvidenceFields() {
    this.elements.chainName.textContent = "—";
    this.elements.chainId.textContent = "—";
    this.elements.source.textContent = "—";
    this.elements.block.textContent = "—";
    this.elements.observedAt.textContent = "—";
    this.elements.contractAddress.textContent = "—";
    this.configureExplorer(this.elements.contractExplorer, "");
    const contractCopy = this.elements.monadSurface.querySelector('[data-monad-copy="contract"]');
    contractCopy.disabled = true;
    delete contractCopy.dataset.copyValue;
    this.elements.v1Parent.textContent = "等待证据";
    this.elements.v2Parent.textContent = "等待证据";
    this.elements.finalState.textContent = "等待证据";
    this.elements.latestVersion.textContent = "—";
    this.elements.finalVersion.textContent = "—";
    this.elements.versionCount.textContent = "—";
    this.elements.eventCounts.textContent = "—";
  }

  renderCardPlaceholders(status, detail) {
    const cards = [
      ["01", "合约部署", "DesignRegistry"],
      ["02", "V1 版本登记", "父版本：等待证据"],
      ["03", "V2 版本登记", "父版本：等待证据"],
      ["04", "V2 最终确认", "finalized：等待证据"],
    ];
    this.elements.grid.innerHTML = cards.map(([index, title, description]) => `
      <article class="monad-evidence-card ${status === "ERROR" ? "is-error" : "is-loading"}">
        <div class="monad-card-topline"><span>${index}</span><em>${escapeHtml(status)}</em></div>
        <h4>${escapeHtml(title)}</h4><p>${escapeHtml(description)}</p>
        <dl><div><dt>状态</dt><dd>${escapeHtml(detail)}</dd></div><div><dt>区块</dt><dd>—</dd></div><div><dt>Tx</dt><dd>—</dd></div></dl>
      </article>
    `).join("");
  }

  configureExplorer(anchor, url, expectedKind = null, expectedValue = null) {
    const safeUrl = safeExplorerUrl(url, expectedKind, expectedValue);
    anchor.classList.toggle("is-disabled", !safeUrl);
    anchor.setAttribute("aria-disabled", String(!safeUrl));
    if (safeUrl) {
      anchor.href = safeUrl;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
    } else {
      anchor.removeAttribute("href");
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
    }
  }

  async handleReadonlyAction(event) {
    const button = event.target.closest("[data-copy-value], [data-monad-copy]");
    if (!button || button.disabled) return;
    const value = text(button.dataset.copyValue);
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      this.showToast("只读证据已复制");
    } catch {
      this.showToast("浏览器不允许自动复制，请手动选择文本", true);
    }
  }

  showToast(message, isError = false) {
    const toast = this.elements.toast;
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("is-error", isError);
    toast.classList.add("is-visible");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
  }
}

const workbench = new MonadReadonlyWorkbench();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => workbench.initialize(), { once: true });
} else {
  workbench.initialize();
}
