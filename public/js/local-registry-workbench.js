const API_TIMEOUT_MS = 10_000;
const SELECTION_PREFIX = "gold-ai:selected-direction:";
const LOCAL_MODE_PATTERN = /(local|anvil|hardhat|development|devnet)/i;
const REMOTE_MODE_PATTERN = /(monad|mainnet|testnet|production|public)/i;

class RegistryApiError extends Error {
  constructor(message, { status = 0, code = "REGISTRY_REQUEST_FAILED", details = null } = {}) {
    super(message);
    this.name = "RegistryApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function valueOf(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStatus(value, fallback = "idle") {
  const status = text(value).toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (["complete", "completed", "success", "succeeded", "mined"].includes(status)) return "confirmed";
  if (["confirmed_offchain", "confirmed_local", "registered_local"].includes(status)) return "confirmed";
  if (["ready", "prepared"].includes(status)) return "ready";
  if (["processing", "submitted", "submitted_local", "broadcast", "broadcasted", "queued"].includes(status)) return "pending";
  if (["checking", "verify", "verification_pending"].includes(status)) return "verifying";
  if (["verified", "valid", "matched"].includes(status)) return "verified";
  if (["error", "errored", "invalid", "mismatch", "reverted", "verification_failed"].includes(status)) return "failed";
  return status || fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortId(value, edge = 8) {
  const normalized = String(value ?? "");
  if (!normalized) return "—";
  return normalized.length > edge * 2 + 3
    ? `${normalized.slice(0, edge)}…${normalized.slice(-edge)}`
    : normalized;
}

function formatDate(value) {
  if (!value) return "时间未返回";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value) {
  return /^(?:sha256:)?[a-f0-9]{64}$/i.test(text(value));
}

function payloadBody(payload) {
  if (!isObject(payload)) return payload;
  return payload.data ?? payload.result ?? payload;
}

async function apiRequest(path, { method = "GET", body } = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined
        ? { Accept: "application/json" }
        : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new RegistryApiError("后端返回了无法识别的响应格式", {
          status: response.status,
          code: "INVALID_JSON_RESPONSE",
        });
      }
    }
    if (!response.ok) {
      const error = payload?.error ?? payload;
      throw new RegistryApiError(
        text(error?.message) || text(payload?.message) || `请求失败（HTTP ${response.status}）`,
        {
          status: response.status,
          code: text(error?.code) || text(payload?.code) || `HTTP_${response.status}`,
          details: error?.details ?? payload?.details ?? null,
        },
      );
    }
    return payloadBody(payload) ?? {};
  } catch (error) {
    if (error instanceof RegistryApiError) throw error;
    if (error?.name === "AbortError") {
      throw new RegistryApiError("本地后端响应超时，操作已停止", {
        code: "LOCAL_BACKEND_TIMEOUT",
      });
    }
    throw new RegistryApiError("无法连接同源本地后端，操作已安全停止", {
      code: "LOCAL_BACKEND_UNREACHABLE",
      details: error?.message || null,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function normalizeConfig(payload) {
  const config = payload?.config ?? payload ?? {};
  const network = config.network ?? config.chain ?? {};
  const signer = config.signer ?? config.localSigner ?? {};
  const contract = config.contract ?? config.registryContract ?? {};
  const mode = String(valueOf(
    config.mode,
    config.executionMode,
    config.networkMode,
    config.scope,
    network.mode,
    network.type,
    "",
  ));
  const chainName = text(valueOf(network.name, config.chainName, config.networkName)) || "Local EVM";
  const status = normalizeStatus(valueOf(
    config.status,
    network.status,
    config.connectionStatus,
    config.connected === true ? "ready" : "",
    network.connected === true ? "ready" : "",
  ), "offline");
  const explicitLocal = config.localOnly === true
    || config.isLocal === true
    || network.localOnly === true
    || LOCAL_MODE_PATTERN.test(mode)
    || LOCAL_MODE_PATTERN.test(chainName);
  const explicitlyRemote = REMOTE_MODE_PATTERN.test(mode) || REMOTE_MODE_PATTERN.test(chainName);
  const connected = valueOf(config.connected, network.connected, status === "ready" || status === "confirmed") === true;
  const contractAddress = text(valueOf(
    contract.address,
    config.contractAddress,
    config.registryAddress,
  ));
  const signerAddress = text(valueOf(
    signer.address,
    config.signerAddress,
    config.developerSignerAddress,
  ));
  const safeLocal = explicitLocal
    && !explicitlyRemote
    && connected
    && config.enabled !== false
    && contractAddress
    && signerAddress;

  return {
    raw: config,
    mode: mode || "未声明",
    chainName: chainName || "本地 EVM",
    chainId: valueOf(network.chainId, network.id, config.chainId, "—"),
    status,
    connected,
    contractAddress,
    signerAddress,
    safeLocal: Boolean(safeLocal),
    explicitLocal,
    explicitlyRemote,
  };
}

function normalizeConfirmation(payload, requested) {
  const root = payload?.confirmation ?? payload?.confirmedVersion ?? payload?.version ?? payload ?? {};
  const status = normalizeStatus(valueOf(
    root.status,
    payload?.status,
    root.confirmed === true ? "confirmed" : "",
    payload?.confirmed === true ? "confirmed" : "",
  ));
  const versionId = text(valueOf(
    root.versionId,
    root.id,
    payload?.confirmedVersionId,
    payload?.versionId,
    requested.versionId,
  ));
  const explicitConfirmation = status === "confirmed"
    || root.confirmed === true
    || payload?.confirmed === true
    || Boolean(root.confirmedAt ?? payload?.confirmedAt);
  if (!explicitConfirmation || !versionId) {
    throw new RegistryApiError("后端未返回明确的版本确认状态，前端不会继续准备登记", {
      code: "CONFIRMATION_NOT_PROVEN",
      details: payload,
    });
  }
  return {
    raw: payload,
    status: "confirmed",
    projectId: text(valueOf(root.projectId, payload?.projectId, requested.projectId)),
    versionId,
    sourceVersionId: text(valueOf(root.sourceVersionId, root.candidateVersionId, requested.versionId)),
    resultId: text(valueOf(root.resultId, root.selectedResultId, requested.resultId)),
    parentVersionId: text(valueOf(root.parentVersionId, payload?.parentVersionId)),
    confirmedAt: valueOf(root.confirmedAt, payload?.confirmedAt),
    isFinal: valueOf(root.isFinal, root.final, payload?.isFinal, payload?.final),
  };
}

function normalizeRegistration(payload, fallback = {}) {
  const root = payload?.registration ?? payload ?? {};
  const manifest = root.manifest ?? root.designManifest ?? payload?.manifest ?? null;
  const contentHash = text(valueOf(
    root.contentHash,
    root.manifestHash,
    payload?.contentHash,
    manifest?.contentHash,
  ));
  const registrationId = text(valueOf(
    root.registrationId,
    root.id,
    payload?.registrationId,
    fallback.registrationId,
  ));
  const receipt = root.receipt ?? root.transactionReceipt ?? payload?.receipt ?? {};
  const transaction = root.transaction ?? root.transactionRequest ?? payload?.transaction ?? {};
  const status = normalizeStatus(valueOf(
    root.status,
    payload?.status,
    receipt.status === 1 ? "confirmed" : "",
    receipt.status === 0 ? "failed" : "",
  ), fallback.status || "idle");
  return {
    raw: payload,
    registrationId,
    projectId: text(valueOf(root.projectId, payload?.projectId, fallback.projectId)),
    versionId: text(valueOf(root.versionId, payload?.versionId, fallback.versionId)),
    resultId: text(valueOf(root.resultId, payload?.resultId, fallback.resultId)),
    manifest,
    contentHash,
    parentVersionId: text(valueOf(
      root.parentVersionId,
      payload?.parentVersionId,
      manifest?.parentVersionId,
      fallback.parentVersionId,
    )),
    parentContentHash: text(valueOf(
      root.parentContentHash,
      payload?.parentContentHash,
      manifest?.parentContentHash,
      fallback.parentContentHash,
    )),
    isFinal: valueOf(root.isFinal, root.final, payload?.isFinal, payload?.final, fallback.isFinal),
    finalizeRequested: valueOf(
      root.finalizeRequested,
      payload?.finalizeRequested,
      fallback.finalizeRequested,
    ) === true,
    versionNumber: valueOf(root.versionNumber, payload?.versionNumber, fallback.versionNumber),
    transaction,
    status,
    contractAddress: text(valueOf(
      receipt.contractAddress,
      root.contractAddress,
      payload?.contractAddress,
      transaction.to,
      fallback.contractAddress,
    )),
    transactionHash: text(valueOf(
      receipt.transactionHash,
      receipt.txHash,
      root.transactionHash,
      root.txHash,
      payload?.transactionHash,
      payload?.txHash,
      fallback.transactionHash,
    )),
    blockNumber: valueOf(
      receipt.blockNumber,
      root.blockNumber,
      payload?.blockNumber,
      fallback.blockNumber,
    ),
    error: root.error ?? payload?.error ?? null,
  };
}

function normalizeVerification(payload, registration) {
  const root = payload?.verification ?? payload ?? {};
  const onchain = root.onchain ?? payload?.onchain ?? {};
  const status = normalizeStatus(valueOf(root.status, payload?.status));
  const verified = root.verified === true
    || payload?.verified === true
    || root.matches === true
    || payload?.matches === true
    || status === "verified";
  const mismatch = root.verified === false
    || payload?.verified === false
    || root.matches === false
    || payload?.matches === false
    || status === "failed";
  if (!verified && !mismatch) {
    throw new RegistryApiError("验证接口未返回明确的 matched / verified 结论", {
      code: "VERIFICATION_NOT_PROVEN",
      details: payload,
    });
  }
  return {
    raw: payload,
    verified,
    status: verified ? "verified" : "failed",
    message: text(valueOf(
      root.message,
      payload?.message,
      verified ? "本地链记录与准备清单一致" : "本地链记录与准备清单不一致",
    )),
    expectedHash: text(valueOf(root.expectedHash, payload?.expectedHash, registration?.contentHash)),
    actualHash: text(valueOf(
      root.actualHash,
      root.onChainHash,
      payload?.actualHash,
      payload?.onChainHash,
      onchain.contentHash,
    )),
    onchainFinalized: onchain.finalized === true,
  };
}

function normalizeTimeline(payload) {
  const root = payload?.timeline ?? payload?.items ?? payload?.versions ?? payload ?? [];
  const items = Array.isArray(root)
    ? root
    : Array.isArray(root?.items)
      ? root.items
      : [];
  return items.map((item) => {
    const registration = isObject(item.registration) ? item.registration : {};
    const verification = isObject(registration.verification) ? registration.verification : {};
    return {
      raw: item,
      id: text(item.versionId),
      versionNumber: item.versionNumber ?? null,
      parentVersionId: text(item.parentVersionId),
      contentHash: text(item.contentHash),
      status: normalizeStatus(valueOf(
        verification.status,
        registration.status,
        item.status,
      )),
      isFinal: item.isFinal === true,
      transactionHash: text(valueOf(
        item.transactionHash,
        registration.transactionHash,
      )),
      blockNumber: valueOf(item.blockNumber, registration.blockNumber),
      confirmedAt: valueOf(item.confirmedAt, registration.verifiedAt),
    };
  });
}

class LocalRegistryWorkbench {
  constructor() {
    this.elements = {
      view: document.querySelector("#view-registry"),
      connectionState: document.querySelector("#registry-connection-state"),
      connectionAlert: document.querySelector("#registry-connection-alert"),
      configMode: document.querySelector("#registry-config-mode"),
      configChain: document.querySelector("#registry-config-chain"),
      configChainId: document.querySelector("#registry-config-chain-id"),
      configSigner: document.querySelector("#registry-config-signer"),
      configContract: document.querySelector("#registry-config-contract"),
      refreshConfig: document.querySelector("#registry-refresh-config"),
      candidateForm: document.querySelector("#registry-candidate-form"),
      projectId: document.querySelector("#registry-project-id"),
      versionId: document.querySelector("#registry-version-id"),
      resultId: document.querySelector("#registry-result-id"),
      imageSha256: document.querySelector("#registry-image-sha256"),
      parentVersionId: document.querySelector("#registry-parent-version-id"),
      metadataUri: document.querySelector("#registry-metadata-uri"),
      projectOptions: document.querySelector("#registry-project-options"),
      versionOptions: document.querySelector("#registry-version-options"),
      importSelection: document.querySelector("#registry-import-selection"),
      selectionReceipt: document.querySelector("#registry-selection-receipt"),
      confirmVersion: document.querySelector("#registry-confirm-version"),
      prepareRegistration: document.querySelector("#registry-prepare-registration"),
      prepareStatus: document.querySelector("#registry-prepare-status"),
      contentHash: document.querySelector("#registry-content-hash"),
      copyHash: document.querySelector("#registry-copy-hash"),
      currentVersion: document.querySelector("#registry-current-version"),
      parentVersion: document.querySelector("#registry-parent-version"),
      finalState: document.querySelector("#registry-final-state"),
      finalizeVersion: document.querySelector("#registry-finalize-version"),
      manifestPreview: document.querySelector("#registry-manifest-preview code"),
      submitLocal: document.querySelector("#registry-submit-local"),
      submitStatus: document.querySelector("#registry-submit-status"),
      transactionStatus: document.querySelector("#registry-transaction-status"),
      receiptContract: document.querySelector("#registry-receipt-contract"),
      receiptTx: document.querySelector("#registry-receipt-tx"),
      receiptBlock: document.querySelector("#registry-receipt-block"),
      verificationResult: document.querySelector("#registry-verification-result"),
      verifyRegistration: document.querySelector("#registry-verify-registration"),
      refreshTimeline: document.querySelector("#registry-refresh-timeline"),
      timelineSummary: document.querySelector("#registry-timeline-summary"),
      timeline: document.querySelector("#registry-timeline"),
      flow: [...document.querySelectorAll("[data-registry-flow]")],
      toast: document.querySelector("#toast"),
    };
    this.state = {
      config: null,
      selection: null,
      confirmation: null,
      registration: null,
      verification: null,
      timeline: [],
      busy: null,
      failedStage: null,
    };
  }

  initialize() {
    if (!this.elements.view) return;
    this.bindEvents();
    this.populateSelectionOptions();
    this.importLatestSelection({ silent: true });
    this.render();
    this.loadConfig();
  }

  bindEvents() {
    this.elements.refreshConfig.addEventListener("click", () => this.loadConfig());
    this.elements.importSelection.addEventListener("click", () => this.importLatestSelection());
    this.elements.confirmVersion.addEventListener("click", () => this.confirmVersion());
    this.elements.prepareRegistration.addEventListener("click", () => this.prepareRegistration());
    this.elements.submitLocal.addEventListener("click", () => this.submitLocal());
    this.elements.verifyRegistration.addEventListener("click", () => this.verifyRegistration());
    this.elements.refreshTimeline.addEventListener("click", () => this.loadTimeline());
    this.elements.copyHash.addEventListener("click", () => this.copyHash());
    this.elements.finalizeVersion.addEventListener("change", () => this.render());
    [
      this.elements.projectId,
      this.elements.versionId,
      this.elements.resultId,
      this.elements.imageSha256,
      this.elements.parentVersionId,
      this.elements.metadataUri,
    ].forEach((input) => {
      input.addEventListener("input", () => this.handleManualSelection());
    });
    window.addEventListener("gold-ai:direction-selected", (event) => {
      const selection = event.detail;
      if (!this.isEligibleSelection(selection, "event")) return;
      this.applySelection(selection, { source: "AI 任务中心刚刚选择" });
      this.showToast("已将 AI 任务中心的主动选择带入本地登记区");
    });
    document.querySelector('.nav-button[data-view="registry"]')?.addEventListener("click", () => {
      this.populateSelectionOptions();
      if (!this.state.config?.safeLocal && !this.state.busy) this.loadConfig();
    });
  }

  showToast(message, isError = false) {
    const toast = this.elements.toast;
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("is-error", isError);
    toast.classList.add("is-visible");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3000);
  }

  selectionEntries() {
    const entries = [];
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key?.startsWith(SELECTION_PREFIX)) continue;
        const parsed = JSON.parse(window.localStorage.getItem(key));
        if (isObject(parsed)) entries.push({ ...parsed, storageKey: key });
      }
    } catch {
      return entries;
    }
    return entries;
  }

  isEligibleSelection(selection, sourceKey = "") {
    if (!isObject(selection)) return false;
    if (!text(selection.projectId)) return false;
    const versionId = text(valueOf(selection.versionId, selection.projectVersionId));
    if (!versionId) return false;
    const demoSource = selection.isDemoPlaceholder === true
      || selection.isAcceptanceFixture === true
      || selection.sourceMode === "demo"
      || String(sourceKey).includes(":demo:");
    return !demoSource;
  }

  populateSelectionOptions() {
    const entries = this.selectionEntries();
    const eligible = entries.filter((entry) => this.isEligibleSelection(entry, entry.storageKey));
    const projects = [...new Set(eligible.map((entry) => text(entry.projectId)).filter(Boolean))];
    const versions = [...new Set(eligible.map((entry) => text(valueOf(entry.versionId, entry.projectVersionId))).filter(Boolean))];
    this.elements.projectOptions.innerHTML = projects
      .map((value) => `<option value="${escapeHtml(value)}"></option>`)
      .join("");
    this.elements.versionOptions.innerHTML = versions
      .map((value) => `<option value="${escapeHtml(value)}"></option>`)
      .join("");
  }

  importLatestSelection({ silent = false } = {}) {
    const eligible = this.selectionEntries()
      .filter((entry) => this.isEligibleSelection(entry, entry.storageKey))
      .sort((left, right) => String(right.selectedAt || "").localeCompare(String(left.selectedAt || "")));
    if (!eligible.length) {
      if (!silent) {
        this.showToast("没有找到可登记的真实候选；本地 DEMO、验收占位和图库素材已被排除", true);
      }
      return false;
    }
    this.applySelection(eligible[0], { source: "AI 任务中心主动选择" });
    if (!silent) this.showToast("已读取最近一次符合条件的 AI 方向选择");
    return true;
  }

  applySelection(selection, { source = "手动选择" } = {}) {
    const normalized = {
      projectId: text(selection.projectId),
      versionId: text(valueOf(selection.versionId, selection.projectVersionId)),
      resultId: text(selection.resultId),
      imageSha256: text(valueOf(selection.imageSha256, selection.imageAsset?.sha256)),
      parentVersionId: text(selection.parentVersionId),
      metadataUri: text(selection.metadataUri),
      directionName: text(selection.name),
      selectedAt: selection.selectedAt,
      source,
      manual: false,
    };
    this.elements.projectId.value = normalized.projectId;
    this.elements.versionId.value = normalized.versionId;
    this.elements.resultId.value = normalized.resultId;
    this.elements.imageSha256.value = normalized.imageSha256;
    this.elements.parentVersionId.value = normalized.parentVersionId;
    this.elements.metadataUri.value = normalized.metadataUri;
    this.resetAfterSelection();
    this.state.selection = normalized;
    this.render();
    if (this.state.config?.safeLocal) this.loadTimeline({ quiet: true });
  }

  handleManualSelection() {
    const next = this.readCandidate();
    const previous = this.state.selection;
    const changed = !previous
      || previous.projectId !== next.projectId
      || previous.versionId !== next.versionId
      || previous.resultId !== next.resultId
      || previous.imageSha256 !== next.imageSha256
      || previous.parentVersionId !== next.parentVersionId
      || previous.metadataUri !== next.metadataUri;
    if (changed) this.resetAfterSelection();
    this.state.selection = {
      ...next,
      source: "手动填写",
      manual: true,
    };
    this.render();
  }

  readCandidate() {
    return {
      projectId: text(this.elements.projectId.value),
      versionId: text(this.elements.versionId.value),
      resultId: text(this.elements.resultId.value),
      imageSha256: text(this.elements.imageSha256.value),
      parentVersionId: text(this.elements.parentVersionId.value),
      metadataUri: text(this.elements.metadataUri.value),
    };
  }

  resetAfterSelection() {
    this.state.confirmation = null;
    this.state.registration = null;
    this.state.verification = null;
    this.state.failedStage = null;
    this.elements.finalizeVersion.checked = false;
  }

  async loadConfig() {
    if (this.state.busy) return;
    this.state.busy = "config";
    this.state.failedStage = null;
    this.render();
    try {
      const payload = await apiRequest("/api/web3/config");
      const config = normalizeConfig(payload);
      this.state.config = config;
      if (!config.safeLocal) {
        const reason = config.explicitlyRemote
          ? "后端返回了非本地网络配置，前端已拒绝连接"
          : !config.explicitLocal
            ? "后端没有明确声明 LOCAL EVM 边界"
            : !config.connected
              ? "本地链或后端适配器尚未启动"
              : !config.contractAddress
                ? "本地 Registry 合约地址未就绪"
                : "本地开发签名器未就绪";
        throw new RegistryApiError(reason, { code: "LOCAL_EVM_NOT_READY", details: payload });
      }
      this.showToast("本地 EVM、开发签名器与 Registry 合约已由后端确认就绪");
      if (this.readCandidate().projectId) await this.loadTimeline({ quiet: true, allowBusy: true });
    } catch (error) {
      this.state.config = {
        ...(this.state.config ?? {}),
        safeLocal: false,
        error: this.describeError(error),
      };
      this.state.failedStage = "config";
    } finally {
      this.state.busy = null;
      this.render();
    }
  }

  async confirmVersion() {
    if (!this.canConfirm()) return;
    const candidate = this.readCandidate();
    this.state.busy = "confirm";
    this.state.failedStage = null;
    this.render();
    try {
      const payload = await apiRequest(
        `/api/projects/${encodeURIComponent(candidate.projectId)}/versions/${encodeURIComponent(candidate.versionId)}/confirm`,
        {
          method: "POST",
          body: {
            resultId: candidate.resultId || null,
            imageSha256: candidate.imageSha256,
            metadataUri: candidate.metadataUri || null,
            parentVersionId: candidate.parentVersionId || null,
          },
        },
      );
      this.state.confirmation = normalizeConfirmation(payload, candidate);
      this.state.selection = {
        ...(this.state.selection ?? candidate),
        ...candidate,
      };
      this.showToast("版本确认记录已由后端明确返回；尚未发送本地链交易");
    } catch (error) {
      this.state.confirmation = null;
      this.state.failedStage = "confirm";
      this.showToast(this.describeError(error), true);
    } finally {
      this.state.busy = null;
      this.render();
    }
  }

  async prepareRegistration() {
    if (!this.canPrepare()) return;
    const candidate = this.readCandidate();
    this.state.busy = "prepare";
    this.state.failedStage = null;
    this.state.registration = null;
    this.state.verification = null;
    this.render();
    try {
      const confirmation = this.state.confirmation;
      const payload = await apiRequest("/api/web3/registrations/prepare", {
        method: "POST",
        body: {
          projectId: candidate.projectId,
          versionId: confirmation.versionId,
          finalize: this.elements.finalizeVersion.checked,
        },
      });
      const registration = normalizeRegistration(payload, {
        projectId: candidate.projectId,
        versionId: confirmation.versionId,
        resultId: candidate.resultId,
        parentVersionId: confirmation.parentVersionId,
        isFinal: confirmation.isFinal,
        finalizeRequested: this.elements.finalizeVersion.checked,
        contractAddress: this.state.config.contractAddress,
      });
      if (!registration.registrationId || !registration.contentHash || !isObject(registration.manifest)) {
        throw new RegistryApiError("准备接口没有返回完整的 registrationId、Manifest 与 contentHash", {
          code: "INCOMPLETE_PREPARATION",
          details: payload,
        });
      }
      if (!["ready", "pending"].includes(registration.status)) {
        throw new RegistryApiError(`准备状态不可提交：${registration.status || "未返回"}`, {
          code: "PREPARATION_NOT_READY",
          details: payload,
        });
      }
      registration.status = "ready";
      this.state.registration = registration;
      this.showToast("Manifest、内容哈希与本地交易参数已准备；尚未发送交易");
    } catch (error) {
      this.state.registration = null;
      this.state.failedStage = "prepare";
      this.showToast(this.describeError(error), true);
    } finally {
      this.state.busy = null;
      this.render();
    }
  }

  async submitLocal() {
    if (!this.canSubmit()) return;
    const registration = this.state.registration;
    const approved = window.confirm(
      "确认只使用当前后端配置的本地开发签名器发送这笔本地 EVM 登记吗？\n\n这不是 Monad 测试网或主网上链，也不会使用真实钱包资产。",
    );
    if (!approved) return;
    this.state.busy = "submit";
    this.state.failedStage = null;
    this.state.registration = { ...registration, status: "pending" };
    this.render();
    try {
      const payload = await apiRequest(
        `/api/web3/registrations/${encodeURIComponent(registration.registrationId)}/submit-local`,
        {
          method: "POST",
          body: {
            acknowledgedLocalDevelopmentSigner: true,
            expectedContentHash: registration.contentHash,
            ...(registration.finalizeRequested ? { finalize: true } : {}),
          },
        },
      );
      const submitted = normalizeRegistration(payload, registration);
      if (!["pending", "confirmed"].includes(submitted.status)) {
        throw new RegistryApiError(
          text(submitted.error?.message) || `本地提交返回失败状态：${submitted.status || "未返回"}`,
          {
            code: text(submitted.error?.code) || "LOCAL_SUBMISSION_FAILED",
            details: payload,
          },
        );
      }
      if (submitted.status === "confirmed"
        && (!submitted.transactionHash || submitted.blockNumber === undefined || submitted.blockNumber === null)) {
        throw new RegistryApiError("后端声称 confirmed，但没有返回交易哈希和区块号", {
          code: "CONFIRMATION_RECEIPT_INCOMPLETE",
          details: payload,
        });
      }
      this.state.registration = submitted;
      this.showToast(submitted.status === "confirmed"
        ? "本地交易回执已返回；请继续从本地链重新验证"
        : "本地交易已提交，当前仍是 pending；请稍后重新验证");
      await this.loadTimeline({ quiet: true, allowBusy: true });
    } catch (error) {
      this.state.registration = { ...registration, status: "failed", error };
      this.state.failedStage = "submit";
      this.showToast(this.describeError(error), true);
    } finally {
      this.state.busy = null;
      this.render();
    }
  }

  async verifyRegistration() {
    if (!this.canVerify()) return;
    const registration = this.state.registration;
    this.state.busy = "verify";
    this.state.failedStage = null;
    this.state.verification = null;
    this.render();
    try {
      const payload = await apiRequest(
        `/api/web3/registrations/${encodeURIComponent(registration.registrationId)}/verify`,
        {
          method: "POST",
          body: {
            expectedContentHash: registration.contentHash,
          },
        },
      );
      this.state.verification = normalizeVerification(payload, registration);
      if (!this.state.verification.verified) {
        this.state.failedStage = "verify";
        this.showToast(this.state.verification.message, true);
      } else {
        this.showToast("已从本地链重新读取并验证内容哈希");
      }
      await this.loadTimeline({ quiet: true, allowBusy: true });
    } catch (error) {
      this.state.verification = {
        verified: false,
        status: "failed",
        message: this.describeError(error),
      };
      this.state.failedStage = "verify";
      this.showToast(this.describeError(error), true);
    } finally {
      this.state.busy = null;
      this.render();
    }
  }

  async loadTimeline({ quiet = false, allowBusy = false } = {}) {
    const projectId = this.readCandidate().projectId;
    if (!projectId || !this.state.config?.safeLocal) return;
    if (this.state.busy && !allowBusy) return;
    const previousBusy = this.state.busy;
    if (!allowBusy) this.state.busy = "timeline";
    this.render();
    try {
      const payload = await apiRequest(
        `/api/projects/${encodeURIComponent(projectId)}/chain-timeline`,
      );
      this.state.timeline = normalizeTimeline(payload);
      if (!quiet) {
        this.showToast(this.state.timeline.length
          ? `已读取 ${this.state.timeline.length} 条本地版本记录`
          : "后端已连接，但当前项目没有本地登记记录");
      }
    } catch (error) {
      this.state.timeline = [];
      if (!quiet) this.showToast(this.describeError(error), true);
    } finally {
      if (!allowBusy) this.state.busy = previousBusy;
      this.render();
    }
  }

  async copyHash() {
    const hash = this.state.registration?.contentHash;
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      this.showToast("内容哈希已复制");
    } catch {
      this.showToast("浏览器不允许自动复制，请手动选择哈希文本", true);
    }
  }

  canConfirm() {
    const candidate = this.readCandidate();
    return Boolean(
      this.state.config?.safeLocal
      && candidate.projectId
      && candidate.versionId
      && isSha256(candidate.imageSha256)
      && !this.state.busy
      && !this.state.confirmation,
    );
  }

  canPrepare() {
    return Boolean(
      this.state.config?.safeLocal
      && this.state.confirmation?.status === "confirmed"
      && !this.state.busy
      && !this.state.registration,
    );
  }

  canSubmit() {
    return Boolean(
      this.state.config?.safeLocal
      && this.state.registration?.status === "ready"
      && this.state.registration?.registrationId
      && !this.state.busy,
    );
  }

  canVerify() {
    return Boolean(
      this.state.config?.safeLocal
      && this.state.registration?.registrationId
      && ["pending", "confirmed", "failed"].includes(this.state.registration?.status)
      && !this.state.busy,
    );
  }

  describeError(error) {
    if (error instanceof RegistryApiError) {
      return `${error.code}：${error.message}`;
    }
    return error?.message || "未知错误，操作已安全停止";
  }

  render() {
    this.renderConfig();
    this.renderSelection();
    this.renderManifest();
    this.renderSubmission();
    this.renderTimeline();
    this.renderFlow();
    this.elements.confirmVersion.disabled = !this.canConfirm();
    this.elements.prepareRegistration.disabled = !this.canPrepare();
    this.elements.submitLocal.disabled = !this.canSubmit();
    this.elements.verifyRegistration.disabled = !this.canVerify();
    this.elements.refreshTimeline.disabled = !(
      this.state.config?.safeLocal
      && this.readCandidate().projectId
      && !this.state.busy
    );
    this.elements.finalizeVersion.disabled = !(
      this.state.confirmation?.status === "confirmed"
      && !this.state.registration
      && !this.state.busy
    );
  }

  renderConfig() {
    const config = this.state.config;
    const isLoading = this.state.busy === "config";
    const connected = Boolean(config?.safeLocal);
    this.elements.connectionState.textContent = isLoading
      ? "正在检查本地服务"
      : connected
        ? "本地环境已验证"
        : "本地环境未就绪";
    this.elements.connectionState.className = `registry-connection-state ${
      isLoading ? "is-checking" : connected ? "is-connected" : "is-error"
    }`;
    this.elements.configMode.textContent = config?.explicitLocal ? "LOCAL EVM ONLY" : "未验证";
    this.elements.configChain.textContent = config?.chainName || "待连接";
    this.elements.configChainId.textContent = config?.chainId ?? "—";
    this.elements.configSigner.textContent = config?.signerAddress || "—";
    this.elements.configContract.textContent = config?.contractAddress || "—";
    this.elements.connectionAlert.classList.toggle("is-connected", connected);
    if (connected) {
      this.elements.connectionAlert.innerHTML = `
        <strong>本地开发环境已由后端确认</strong>
        <p>只允许调用 LOCAL EVM 和开发签名器；网络、签名器或合约任一变化后请重新检查。</p>
      `;
    } else {
      this.elements.connectionAlert.innerHTML = `
        <strong>${isLoading ? "正在检查后端" : "后端或本地链尚未连接"}</strong>
        <p>${escapeHtml(config?.error || "确认、准备和提交按钮保持关闭；不会生成伪交易哈希或假成功记录。")}</p>
      `;
    }
  }

  renderSelection() {
    const selection = this.state.selection ?? this.readCandidate();
    const valid = Boolean(selection.projectId && selection.versionId);
    const confirmed = this.state.confirmation?.status === "confirmed";
    this.elements.selectionReceipt.classList.toggle("has-selection", valid);
    if (!valid) {
      this.elements.selectionReceipt.innerHTML = `
        <span class="registry-receipt-mark" aria-hidden="true">—</span>
        <div>
          <strong>尚未选择候选</strong>
          <p>请先在 AI 任务中心选择一个成功结果，或填写后端已存在的项目和版本 ID。</p>
        </div>
      `;
      return;
    }
    const label = selection.directionName || shortId(selection.versionId);
    const source = selection.source || (selection.manual ? "手动填写" : "当前输入");
    this.elements.selectionReceipt.innerHTML = `
      <span class="registry-receipt-mark" aria-hidden="true">${confirmed ? "✓" : "→"}</span>
      <div>
        <strong>${confirmed ? "版本已确认" : "候选已带入"} · ${escapeHtml(label)}</strong>
        <p>项目 ${escapeHtml(shortId(selection.projectId))} · 版本 ${escapeHtml(shortId(selection.versionId))}
          ${selection.resultId ? ` · 结果 ${escapeHtml(shortId(selection.resultId))}` : " · 未提供结果 ID"}
          · ${isSha256(selection.imageSha256) ? "图片摘要已就绪" : "缺少有效图片 SHA-256，确认按钮保持关闭"}
          · 来源：${escapeHtml(source)}</p>
      </div>
    `;
  }

  renderManifest() {
    const registration = this.state.registration;
    const preparing = this.state.busy === "prepare";
    const failed = this.state.failedStage === "prepare";
    const status = preparing ? "pending" : failed ? "failed" : registration ? "ready" : "idle";
    this.elements.prepareStatus.className = `registry-stage-pill is-${status}`;
    this.elements.prepareStatus.textContent = preparing
      ? "正在准备"
      : failed
        ? "准备失败"
        : registration
          ? "已准备 · 未提交"
          : this.state.confirmation
            ? "等待准备"
            : "等待版本确认";
    this.elements.contentHash.textContent = registration?.contentHash || "尚未准备";
    this.elements.copyHash.disabled = !registration?.contentHash;
    this.elements.currentVersion.textContent = shortId(
      valueOf(registration?.versionId, this.state.confirmation?.versionId, this.readCandidate().versionId),
    );
    this.elements.parentVersion.textContent = registration?.parentVersionId
      ? shortId(registration.parentVersionId)
      : this.state.confirmation?.parentVersionId
        ? shortId(this.state.confirmation.parentVersionId)
        : "ROOT / 未返回";
    const timelineFinal = this.state.timeline.some((item) => (
      item.id === valueOf(registration?.versionId, this.state.confirmation?.versionId)
      && item.isFinal === true
    ));
    const verifiedFinal = this.state.verification?.verified === true
      && this.state.verification?.onchainFinalized === true;
    this.elements.finalState.textContent = verifiedFinal || timelineFinal
      ? "本地链已验证最终版"
      : registration?.finalizeRequested
        ? "最终版请求 · 待链上验证"
        : this.elements.finalizeVersion.checked
          ? "计划标记最终版"
          : "非最终版";
    const preview = registration?.manifest ?? {
      state: preparing
        ? "preparing_on_local_backend"
        : failed
          ? "preparation_failed"
          : this.state.confirmation
            ? "waiting_for_prepare_action"
            : "waiting_for_confirmed_version",
    };
    this.elements.manifestPreview.textContent = JSON.stringify(preview, null, 2);
  }

  renderSubmission() {
    const registration = this.state.registration;
    const verification = this.state.verification;
    const submitting = this.state.busy === "submit";
    const verifying = this.state.busy === "verify";
    const submitStatus = submitting
      ? "pending"
      : registration?.status || "idle";
    this.elements.submitStatus.className = `registry-stage-pill is-${submitStatus}`;
    this.elements.submitStatus.textContent = submitting
      ? "提交中"
      : ({
        idle: "尚未准备",
        ready: "等待明确确认",
        pending: "PENDING",
        confirmed: "CONFIRMED",
        failed: "FAILED",
      })[submitStatus] || submitStatus;
    this.elements.transactionStatus.textContent = ({
      ready: "已准备 · 未发送",
      pending: "pending",
      confirmed: "confirmed",
      failed: "failed",
    })[registration?.status] || "未提交";
    this.elements.receiptContract.textContent = registration?.contractAddress
      || this.state.config?.contractAddress
      || "—";
    this.elements.receiptTx.textContent = registration?.transactionHash || "—";
    this.elements.receiptBlock.textContent = registration?.blockNumber ?? "—";

    const box = this.elements.verificationResult;
    if (verifying) {
      box.className = "registry-verification-result is-verifying";
      box.innerHTML = `
        <span aria-hidden="true">⋯</span>
        <div><strong>VERIFYING · 正在读取本地链</strong><p>等待后端返回明确的 matched / verified 结论。</p></div>
      `;
    } else if (verification?.verified) {
      box.className = "registry-verification-result is-verified";
      box.innerHTML = `
        <span aria-hidden="true">✓</span>
        <div><strong>VERIFIED · 本地链重新验证通过</strong><p>${escapeHtml(verification.message)}
          ${verification.actualHash ? ` · 链上哈希 ${escapeHtml(shortId(verification.actualHash))}` : ""}</p></div>
      `;
    } else if (verification && !verification.verified) {
      box.className = "registry-verification-result is-failed";
      box.innerHTML = `
        <span aria-hidden="true">!</span>
        <div><strong>VERIFY FAILED · 不可视为有效登记</strong><p>${escapeHtml(verification.message)}
          ${verification.expectedHash ? ` · 期望 ${escapeHtml(shortId(verification.expectedHash))}` : ""}
          ${verification.actualHash ? ` · 实际 ${escapeHtml(shortId(verification.actualHash))}` : ""}</p></div>
      `;
    } else if (registration?.status === "failed") {
      box.className = "registry-verification-result is-failed";
      box.innerHTML = `
        <span aria-hidden="true">!</span>
        <div><strong>LOCAL SUBMIT FAILED</strong><p>${escapeHtml(this.describeError(registration.error))}</p></div>
      `;
    } else if (registration?.status === "confirmed") {
      box.className = "registry-verification-result is-idle";
      box.innerHTML = `
        <span aria-hidden="true">◇</span>
        <div><strong>交易回执已返回，尚未重新验证</strong><p>点击“从本地链重新验证”，核对登记内容与当前 Manifest 哈希。</p></div>
      `;
    } else if (registration?.status === "pending") {
      box.className = "registry-verification-result is-verifying";
      box.innerHTML = `
        <span aria-hidden="true">⋯</span>
        <div><strong>PENDING · 等待本地链回执</strong><p>当前不是成功状态。可稍后点击重新验证，或检查本地链日志。</p></div>
      `;
    } else {
      box.className = "registry-verification-result is-idle";
      box.innerHTML = `
        <span aria-hidden="true">◇</span>
        <div><strong>等待本地链回执</strong><p>只有后端返回真实本地交易回执后，才会显示 confirmed。</p></div>
      `;
    }
  }

  renderTimeline() {
    const items = this.state.timeline;
    const loading = this.state.busy === "timeline";
    const finalItem = [...items].reverse().find((item) => item.isFinal === true);
    this.elements.timelineSummary.innerHTML = `
      <span>${escapeHtml(items.length)} 个已返回记录${loading ? " · 正在刷新" : ""}</span>
      <strong>${finalItem ? `最终确认：${escapeHtml(shortId(finalItem.id))}` : "后端尚未返回最终确认版本"}</strong>
    `;
    if (!items.length) {
      this.elements.timeline.innerHTML = `
        <div class="registry-empty-state">
          <span aria-hidden="true">${loading ? "⋯" : "◎"}</span>
          <strong>${loading ? "正在读取本地时间线" : "尚无可验证的本地登记记录"}</strong>
          <p>${loading
            ? "只展示后端实际返回的本地记录。"
            : "这里不会用预置数据填充。启动后端与本地链，并完成一次明确登记后再刷新。"}</p>
        </div>
      `;
      return;
    }
    this.elements.timeline.innerHTML = items.map((item) => `
      <article class="registry-timeline-node">
        <div class="registry-timeline-version">V${escapeHtml(item.versionNumber ?? "?")}</div>
        <div class="registry-timeline-copy">
          <h4>${item.isFinal === true ? "最终确认版 · " : ""}${escapeHtml(shortId(item.id))}</h4>
          <p>父版本：<code>${escapeHtml(item.parentVersionId ? shortId(item.parentVersionId) : "ROOT")}</code>
            ${item.contentHash ? ` · Hash：<code>${escapeHtml(shortId(item.contentHash))}</code>` : " · Hash 未返回"}</p>
          <p>${item.transactionHash ? `交易：<code>${escapeHtml(shortId(item.transactionHash))}</code>` : "交易哈希未返回"}
            · 区块：${escapeHtml(item.blockNumber ?? "未返回")}</p>
        </div>
        <div class="registry-timeline-state">
          <strong>${escapeHtml((item.status || "unknown").toUpperCase())}</strong>
          <small>${escapeHtml(formatDate(item.confirmedAt))}</small>
        </div>
      </article>
    `).join("");
  }

  renderFlow() {
    const hasSelection = Boolean(this.readCandidate().projectId && this.readCandidate().versionId);
    const confirmed = this.state.confirmation?.status === "confirmed";
    const prepared = Boolean(this.state.registration);
    const submitted = ["pending", "confirmed", "failed"].includes(this.state.registration?.status);
    const verified = this.state.verification?.verified === true;
    const current = verified
      ? null
      : this.state.busy === "verify" || submitted
        ? "verify"
        : this.state.busy === "submit" || prepared
          ? "submit"
          : this.state.busy === "prepare" || confirmed
            ? "prepare"
            : this.state.busy === "confirm" || hasSelection
              ? "confirm"
              : "select";
    const completed = new Set();
    if (hasSelection) completed.add("select");
    if (confirmed) completed.add("confirm");
    if (prepared) completed.add("prepare");
    if (submitted && this.state.registration?.status !== "failed") completed.add("submit");
    if (verified) completed.add("verify");
    this.elements.flow.forEach((item) => {
      const step = item.dataset.registryFlow;
      item.classList.toggle("is-current", step === current);
      item.classList.toggle("is-complete", completed.has(step));
      item.classList.toggle("is-failed", step === this.state.failedStage);
    });
  }
}

const workbench = new LocalRegistryWorkbench();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => workbench.initialize(), { once: true });
} else {
  workbench.initialize();
}
