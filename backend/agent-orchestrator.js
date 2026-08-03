import path from "node:path";
import { randomUUID } from "node:crypto";

import { RequirementParserService } from "./requirements/requirement-parser-service.js";
import { buildGoldApiImagePrompt } from "./gold-prompt-builder.js";
import { clone, iso, list, text } from "./utils.js";
import { buildMetadata, hashCanonical, hashImageFile } from "./design-manifest.js";
import { keccak256 } from "./keccak.js";
import { ZERO_HASH, normalizeAddress } from "./evm-codec.js";

function agentError(message, { code = "AGENT_ERROR", httpStatus = 400, retryable = false, details = null } = {}) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  error.retryable = retryable;
  error.details = details;
  return error;
}

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function requireWallet(value) {
  try {
    return normalizeAddress(value);
  } catch {
    throw agentError("钱包地址格式无效，请重新连接 MetaMask", { code: "INVALID_WALLET_ADDRESS", httpStatus: 400 });
  }
}

function normalizeProductType(value) {
  const raw = text(value);
  if (/戒|对戒/.test(raw)) return "戒指";
  if (/手镯|圆镯|镯/.test(raw)) return "手镯";
  if (/项链|锁骨链|链条/.test(raw)) return "项链";
  if (/吊坠|金锁|平安锁/.test(raw)) return "吊坠";
  return raw || "戒指";
}

function normalizeRequirementForGeneration(structured = {}) {
  const normalized = clone(structured);
  normalized.productType = normalizeProductType(normalized.productType);
  if (!text(normalized.goldType)) normalized.goldType = "足金";
  if (!text(normalized.style)) normalized.style = "新中式";
  if (!Array.isArray(normalized.motifs)) normalized.motifs = [];
  if (!Array.isArray(normalized.surfaceEffects)) normalized.surfaceEffects = [];
  if (!Array.isArray(normalized.mustKeep)) normalized.mustKeep = [];
  if (!Array.isArray(normalized.mustAvoid)) normalized.mustAvoid = [];
  if (!Array.isArray(normalized.structureForms)) normalized.structureForms = [];
  return normalized;
}

function mergeRevision(parent, change, changeRequest) {
  const result = clone(parent);
  const scalarFields = ["productType", "goldType", "style", "targetAudience", "usageScenario", "weightRequirement", "visualWeight"];
  for (const field of scalarFields) {
    const value = text(change[field]);
    if (value && !["未说明", "待确认"].includes(value)) result[field] = value;
  }
  const replacementLists = ["surfaceEffects", "craftRequirements", "structureForms"];
  for (const field of replacementLists) {
    if (Array.isArray(change[field]) && change[field].length) result[field] = clone(change[field]);
  }
  const mergedLists = ["motifs", "mustKeep", "mustAvoid", "comfortRequirements", "safetyRisks"];
  for (const field of mergedLists) {
    result[field] = [...new Set([...(result[field] || []), ...(change[field] || [])].map(text).filter(Boolean))];
  }
  const shape = text(parent.shape || parent.structureForms?.[0]);
  if (shape) result.mustKeep = [...new Set([...(result.mustKeep || []), shape])];
  for (const motif of parent.motifs || []) result.mustKeep = [...new Set([...(result.mustKeep || []), `${motif}元素`])];
  result.taskType = "modify_existing";
  result.versionRelation = `在上一版本基础上修改：${changeRequest}`;
  return normalizeRequirementForGeneration(result);
}

function projectTitle(requirement) {
  return [requirement.style, requirement.productType, ...(requirement.motifs || []).slice(0, 1)]
    .filter(Boolean)
    .join(" · ") || "黄金珠宝 AI 设计";
}

function publicVersion(version) {
  const copy = clone(version);
  delete copy.apiPrompt;
  delete copy.imageFilePath;
  return copy;
}

export class JewelChainAgent {
  constructor({ store, generationDispatcher, imageProvider, storageService, chainService, generatedDir } = {}) {
    this.store = store;
    this.generation = generationDispatcher || {
      generate: (input) => imageProvider.generate(input),
      status: async () => ({
        mode: "direct",
        directProvider: imageProvider.status(),
        worker: null,
        configured: Boolean(imageProvider.configured ?? imageProvider.status()?.configured),
        notice: "测试/兼容模式：直接调用图片 Provider",
      }),
    };
    this.storage = storageService;
    this.chain = chainService;
    this.generatedDir = generatedDir;
    this.parser = new RequirementParserService();
  }

  async config() {
    const generation = await this.generation.status();
    return {
      version: "1.2.0",
      agent: {
        name: "JewelChain Design Agent",
        mode: "deterministic-tool-orchestration",
        tools: ["parse_requirement", "enqueue_generation", "worker_dispatch", "store_assets", "build_metadata", "prepare_monad_tx", "verify_monad_tx", "answer_chain_question"],
      },
      generation,
      imageProvider: generation.directProvider,
      storage: this.storage.status(),
      chain: this.chain.config(),
      legalNotice: "链上记录证明内容指纹、提交地址与时间，不替代版权登记、原创性审查或法律认定。",
    };
  }

  async createDesign({ customerText, formFields = {} } = {}) {
    const raw = text(customerText);
    if (raw.length < 6) throw agentError("请至少输入一句完整的珠宝需求", { code: "INVALID_REQUIREMENT" });
    const parsed = await this.parser.parse({ customerText: raw, formFields, analysisMode: "local" });
    const requirement = normalizeRequirementForGeneration(parsed.structuredRequirement);
    const projectId = randomUUID();
    const localDesignId = `DESIGN-${projectId.slice(0, 8).toUpperCase()}`;
    const versionId = randomUUID();
    const jobId = randomUUID();
    const createdAt = iso();
    const project = {
      id: projectId,
      localDesignId,
      title: projectTitle(requirement),
      customerText: raw,
      currentVersion: 1,
      finalVersionId: null,
      createdAt,
      updatedAt: createdAt,
    };
    const version = {
      id: versionId,
      projectId,
      versionNumber: 1,
      parentVersionId: null,
      parentContentHash: ZERO_HASH,
      changeRequest: "",
      structuredRequirement: requirement,
      understandingSummary: parsed.understandingSummary,
      status: "generating",
      imageUrl: null,
      imageFilename: null,
      imageFilePath: null,
      imageMimeType: null,
      modelProvider: null,
      modelName: null,
      apiPrompt: null,
      contentHash: null,
      metadata: null,
      metadataUri: null,
      txHash: null,
      createdAt,
      updatedAt: createdAt,
    };
    const job = {
      id: jobId,
      type: "generate-v1",
      projectId,
      versionId,
      status: "queued",
      progress: 0,
      currentStep: "等待 Agent 开始生成 V1",
      error: null,
      createdAt,
      updatedAt: createdAt,
    };
    await this.store.update((state) => {
      state.projects.push(project);
      state.versions.push(version);
      state.jobs.push(job);
      return null;
    });
    setImmediate(() => this.runGeneration(jobId, { operation: "generate" }).catch(() => {}));
    return { projectId, localDesignId, versionId, jobId, parsed: { understandingSummary: parsed.understandingSummary, structuredRequirement: requirement } };
  }

  async reviseDesign(projectId, { parentVersionId, changeRequest } = {}) {
    const change = text(changeRequest);
    if (change.length < 2) throw agentError("请填写本次修改要求", { code: "INVALID_CHANGE_REQUEST" });
    const state = await this.store.read();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) throw agentError("设计项目不存在", { code: "PROJECT_NOT_FOUND", httpStatus: 404 });
    const parent = state.versions.find((item) => item.id === parentVersionId && item.projectId === projectId);
    if (!parent) throw agentError("父版本不存在", { code: "PARENT_VERSION_NOT_FOUND", httpStatus: 404 });
    if (parent.status !== "chain_confirmed") {
      throw agentError("请先把上一版本成功登记到 Monad，再生成下一版本", { code: "PARENT_NOT_ONCHAIN", httpStatus: 409 });
    }
    if (project.finalVersionId) throw agentError("该设计已经确定最终版本，不能继续新增版本", { code: "DESIGN_FINALIZED", httpStatus: 409 });
    const parsedChange = await this.parser.parse({ customerText: change, formFields: {}, analysisMode: "local" });
    const requirement = mergeRevision(parent.structuredRequirement, parsedChange.structuredRequirement, change);
    const versionNumber = Math.max(...state.versions.filter((item) => item.projectId === projectId).map((item) => item.versionNumber), 0) + 1;
    const versionId = randomUUID();
    const jobId = randomUUID();
    const createdAt = iso();
    const version = {
      id: versionId,
      projectId,
      versionNumber,
      parentVersionId: parent.id,
      parentContentHash: parent.contentHash,
      changeRequest: change,
      structuredRequirement: requirement,
      understandingSummary: parsedChange.understandingSummary,
      status: "generating",
      imageUrl: null,
      imageFilename: null,
      imageFilePath: null,
      imageMimeType: null,
      modelProvider: null,
      modelName: null,
      apiPrompt: null,
      contentHash: null,
      metadata: null,
      metadataUri: null,
      txHash: null,
      createdAt,
      updatedAt: createdAt,
    };
    const job = {
      id: jobId,
      type: `generate-v${versionNumber}`,
      projectId,
      versionId,
      status: "queued",
      progress: 0,
      currentStep: `等待 Agent 生成 V${versionNumber}`,
      error: null,
      createdAt,
      updatedAt: createdAt,
    };
    await this.store.update((next) => {
      next.versions.push(version);
      next.jobs.push(job);
      const currentProject = next.projects.find((item) => item.id === projectId);
      currentProject.currentVersion = versionNumber;
      currentProject.updatedAt = createdAt;
      return null;
    });
    setImmediate(() => this.runGeneration(jobId, { operation: "refine" }).catch(() => {}));
    return { projectId, versionId, versionNumber, jobId };
  }

  async runGeneration(jobId, { operation }) {
    let snapshot;
    await this.store.update((state) => {
      const job = state.jobs.find((item) => item.id === jobId);
      const version = state.versions.find((item) => item.id === job?.versionId);
      if (!job || !version) return null;
      job.status = "running";
      job.progress = 10;
      job.currentStep = "Agent 正在整理结构化需求和生图提示词";
      job.updatedAt = iso();
      snapshot = clone(version);
      return null;
    });
    if (!snapshot) return;
    try {
      const prompts = buildGoldApiImagePrompt(snapshot.structuredRequirement, {
        operation,
        payload: { changeRequest: snapshot.changeRequest, customerChangeRequest: snapshot.changeRequest },
      });
      await this.store.update((state) => {
        const job = state.jobs.find((item) => item.id === jobId);
        const version = state.versions.find((item) => item.id === snapshot.id);
        job.progress = 30;
        job.currentStep = "Agent 已调用 Seedream，正在等待真实图片";
        job.updatedAt = iso();
        version.apiPrompt = prompts.apiPrompt;
        version.structuredRequirement = {
          ...version.structuredRequirement,
          productType: prompts.productName,
          shape: prompts.shape,
        };
        version.updatedAt = iso();
        return null;
      });
      const generated = await this.generation.generate({
        jobId,
        versionId: snapshot.id,
        projectId: snapshot.projectId,
        operation,
        prompt: prompts.apiPrompt,
        filenamePrefix: `${snapshot.projectId}_v${snapshot.versionNumber}`,
      });
      await this.store.update((state) => {
        const job = state.jobs.find((item) => item.id === jobId);
        const version = state.versions.find((item) => item.id === snapshot.id);
        Object.assign(version, {
          status: "awaiting_confirmation",
          imageUrl: generated.imageUrl,
          imageFilename: generated.filename,
          imageFilePath: generated.filePath,
          imageMimeType: generated.mimeType,
          imageSizeBytes: generated.sizeBytes,
          imageSha256: generated.sha256,
          modelProvider: generated.modelProvider,
          modelName: generated.modelName,
          providerRequestId: generated.requestId,
          updatedAt: iso(),
        });
        Object.assign(job, {
          status: "succeeded",
          progress: 100,
          currentStep: `V${version.versionNumber} 已生成，等待用户确认并登记到 Monad`,
          updatedAt: iso(),
        });
        return null;
      });
    } catch (error) {
      await this.store.update((state) => {
        const job = state.jobs.find((item) => item.id === jobId);
        const version = state.versions.find((item) => item.id === snapshot.id);
        if (job) Object.assign(job, { status: "failed", progress: Math.max(job.progress || 0, 30), currentStep: "图片生成失败", error: { code: error.code || "GENERATION_FAILED", message: error.message, details: error.details || null }, updatedAt: iso() });
        if (version) Object.assign(version, { status: "generation_failed", error: { code: error.code || "GENERATION_FAILED", message: error.message }, updatedAt: iso() });
        return null;
      });
    }
  }

  async resumePendingJobs() {
    const state = await this.store.read();
    const resumable = state.jobs.filter((job) => ["queued", "running"].includes(job.status));
    for (const job of resumable) {
      const version = state.versions.find((item) => item.id === job.versionId);
      if (!version || !["generating", "generation_failed"].includes(version.status)) continue;
      const operation = version.versionNumber > 1 ? "refine" : "generate";
      setImmediate(() => this.runGeneration(job.id, { operation }).catch(() => {}));
    }
    return resumable.length;
  }

  async getJob(jobId) {
    const state = await this.store.read();
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) throw agentError("任务不存在", { code: "JOB_NOT_FOUND", httpStatus: 404 });
    const version = state.versions.find((item) => item.id === job.versionId);
    return { ...job, version: version ? publicVersion(version) : null };
  }

  async getProject(projectId) {
    const state = await this.store.read();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) throw agentError("设计项目不存在", { code: "PROJECT_NOT_FOUND", httpStatus: 404 });
    const versions = state.versions.filter((item) => item.projectId === projectId).sort((a, b) => a.versionNumber - b.versionNumber).map(publicVersion);
    return { ...clone(project), versions };
  }

  async prepareRegistration(versionId, { walletAddress, baseUrl }) {
    const wallet = requireWallet(walletAddress);
    const state = await this.store.read();
    const version = state.versions.find((item) => item.id === versionId);
    if (!version) throw agentError("设计版本不存在", { code: "VERSION_NOT_FOUND", httpStatus: 404 });
    const project = state.projects.find((item) => item.id === version.projectId);
    if (!["awaiting_confirmation", "awaiting_wallet_signature", "registration_failed"].includes(version.status)) {
      if (version.status === "chain_confirmed") return { alreadyConfirmed: true, version: publicVersion(version) };
      throw agentError("当前版本状态不能准备上链", { code: "INVALID_VERSION_STATE", httpStatus: 409, details: { status: version.status } });
    }
    if (!version.imageFilePath || !version.apiPrompt) throw agentError("版本缺少真实图片或提示词", { code: "VERSION_NOT_READY", httpStatus: 409 });
    if (version.registrant && normalizeAddress(version.registrant) !== wallet) {
      throw agentError("该版本已经绑定另一个登记钱包，请使用原钱包", { code: "REGISTRANT_LOCKED", httpStatus: 409 });
    }
    const parent = version.parentVersionId ? state.versions.find((item) => item.id === version.parentVersionId) : null;
    if (parent && parent.status !== "chain_confirmed") throw agentError("父版本尚未在 Monad 确认", { code: "PARENT_NOT_CONFIRMED", httpStatus: 409 });
    if (parent?.registrant && requireWallet(parent.registrant) !== wallet) {
      throw agentError("V2 必须使用与 V1 相同的钱包登记", { code: "DESIGN_OWNER_WALLET_REQUIRED", httpStatus: 409 });
    }

    const imageEvidence = await hashImageFile(version.imageFilePath);
    const preparedImage = await this.storage.prepareImage({ project, version, baseUrl });
    const manifest = buildMetadata({ project, version, registrant: wallet, imageUri: preparedImage.imageUri, imageEvidence });
    const designId = keccak256(Buffer.from(project.localDesignId, "utf8"));
    const versionForStorage = { ...version, ...manifest, status: "awaiting_wallet_signature" };
    const metadataResult = await this.storage.persistMetadata({
      project,
      version: versionForStorage,
      metadata: manifest.metadata,
      baseUrl,
      storageMode: preparedImage.storageMode,
    });
    const preparedTx = this.chain.prepareRegister({
      designId,
      contentHash: manifest.contentHash,
      parentContentHash: version.parentContentHash || ZERO_HASH,
      metadataUri: metadataResult.metadataUri,
    });
    await this.store.update((next) => {
      const current = next.versions.find((item) => item.id === versionId);
      Object.assign(current, {
        status: "awaiting_wallet_signature",
        registrant: wallet,
        designId,
        requirementHash: manifest.requirementHash,
        promptHash: manifest.promptHash,
        imageHash: manifest.imageHash,
        contentHash: manifest.contentHash,
        imageUri: preparedImage.imageUri,
        metadata: manifest.metadata,
        metadataUri: metadataResult.metadataUri,
        storageMode: metadataResult.storageMode,
        storageWarning: [preparedImage.warning, metadataResult.warning].filter(Boolean).join("；") || null,
        preparedTransaction: preparedTx,
        updatedAt: iso(),
      });
      return null;
    });
    return {
      versionId,
      versionNumber: version.versionNumber,
      designId,
      contentHash: manifest.contentHash,
      parentContentHash: version.parentContentHash || ZERO_HASH,
      metadataUri: metadataResult.metadataUri,
      imageUri: preparedImage.imageUri,
      storageWarning: [preparedImage.warning, metadataResult.warning].filter(Boolean).join("；") || null,
      ...preparedTx,
    };
  }

  async recordSubmission(versionId, { txHash, walletAddress, kind = "register" }) {
    const wallet = requireWallet(walletAddress);
    if (!/^0x[0-9a-f]{64}$/i.test(txHash)) throw agentError("txHash 格式无效", { code: "INVALID_TX_HASH" });
    const state = await this.store.read();
    const version = state.versions.find((item) => item.id === versionId);
    if (!version) throw agentError("设计版本不存在", { code: "VERSION_NOT_FOUND", httpStatus: 404 });
    if (normalizeAddress(version.registrant) !== wallet) throw agentError("回传钱包与登记钱包不一致", { code: "WALLET_MISMATCH", httpStatus: 409 });
    const existing = state.chainRecords.find((item) => item.versionId === versionId && item.kind === kind && item.txHash.toLowerCase() === txHash.toLowerCase());
    if (existing) return existing;
    const record = {
      id: randomUUID(),
      versionId,
      projectId: version.projectId,
      kind,
      chainId: this.chain.chainId,
      contractAddress: this.chain.contractAddress,
      walletAddress: wallet,
      txHash,
      status: "submitted",
      blockNumber: null,
      event: null,
      submittedAt: iso(),
      confirmedAt: null,
      errorMessage: null,
    };
    await this.store.update((next) => {
      next.chainRecords.push(record);
      const current = next.versions.find((item) => item.id === versionId);
      if (kind === "register") {
        current.status = "tx_submitted";
        current.txHash = txHash;
      } else {
        current.finalizeTxHash = txHash;
      }
      current.updatedAt = iso();
      return null;
    });
    await this.storage.saveChainRecord(record);
    return record;
  }

  async getChainStatus(versionId, kind = "register") {
    const state = await this.store.read();
    const version = state.versions.find((item) => item.id === versionId);
    if (!version) throw agentError("设计版本不存在", { code: "VERSION_NOT_FOUND", httpStatus: 404 });
    const record = [...state.chainRecords].reverse().find((item) => item.versionId === versionId && item.kind === kind);
    if (!record) return { status: kind === "register" ? version.status : "not_submitted" };
    if (["confirmed", "failed"].includes(record.status)) return { ...record, explorerUrl: `${this.chain.explorerUrl}/tx/${record.txHash}` };
    const expected = kind === "register"
      ? { designId: version.designId, contentHash: version.contentHash, parentContentHash: version.parentContentHash || ZERO_HASH }
      : { designId: version.designId, contentHash: version.contentHash };
    const verification = await this.chain.verifyTransaction({
      txHash: record.txHash,
      walletAddress: record.walletAddress,
      kind,
      expected,
    });
    if (verification.status === "pending") return { ...record, status: "submitted" };
    await this.store.update((next) => {
      const currentRecord = next.chainRecords.find((item) => item.id === record.id);
      const currentVersion = next.versions.find((item) => item.id === versionId);
      const project = next.projects.find((item) => item.id === version.projectId);
      Object.assign(currentRecord, {
        status: verification.status,
        blockNumber: verification.blockNumber || null,
        event: verification.event || null,
        confirmedAt: verification.status === "confirmed" ? iso() : null,
        errorMessage: verification.errorMessage || null,
      });
      if (verification.status === "confirmed") {
        if (kind === "register") {
          currentVersion.status = "chain_confirmed";
          currentVersion.onchainVersionNumber = verification.event.versionNumber;
          currentVersion.registeredBy = verification.event.registeredBy;
        } else {
          currentVersion.status = "finalized";
          project.finalVersionId = currentVersion.id;
        }
      } else if (kind === "register") {
        currentVersion.status = "registration_failed";
      }
      currentVersion.updatedAt = iso();
      project.updatedAt = iso();
      return null;
    });
    const refreshedState = await this.store.read();
    const updated = refreshedState.chainRecords.find((item) => item.id === record.id);
    const updatedVersion = refreshedState.versions.find((item) => item.id === versionId);
    const updatedProject = refreshedState.projects.find((item) => item.id === version.projectId);
    await this.storage.saveChainRecord(updated);
    await this.storage.updateVersionAndProject({ version: updatedVersion, project: updatedProject });
    return { ...updated, explorerUrl: `${this.chain.explorerUrl}/tx/${record.txHash}` };
  }

  async prepareFinalize(versionId, { walletAddress }) {
    const wallet = requireWallet(walletAddress);
    const state = await this.store.read();
    const version = state.versions.find((item) => item.id === versionId);
    if (!version) throw agentError("设计版本不存在", { code: "VERSION_NOT_FOUND", httpStatus: 404 });
    if (version.status === "finalized") return { alreadyFinalized: true, version: publicVersion(version) };
    if (version.status !== "chain_confirmed") throw agentError("只有已登记成功的版本才能设为最终版", { code: "VERSION_NOT_REGISTERED", httpStatus: 409 });
    if (normalizeAddress(version.registrant) !== wallet) throw agentError("只有原登记钱包可以确认最终版", { code: "UNAUTHORIZED_FINALIZER", httpStatus: 403 });
    return { versionId, ...this.chain.prepareFinalize({ designId: version.designId, contentHash: version.contentHash }) };
  }

  async timeline(projectId) {
    const state = await this.store.read();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) throw agentError("设计项目不存在", { code: "PROJECT_NOT_FOUND", httpStatus: 404 });
    const versions = state.versions.filter((item) => item.projectId === projectId).sort((a, b) => a.versionNumber - b.versionNumber).map((version) => {
      const records = state.chainRecords.filter((item) => item.versionId === version.id);
      return {
        ...publicVersion(version),
        chainRecords: records.map((record) => ({ ...record, explorerUrl: `${this.chain.explorerUrl}/tx/${record.txHash}` })),
      };
    });
    return { project: clone(project), versions };
  }


  async certificate(projectId) {
    const timeline = await this.timeline(projectId);
    const finalVersion = timeline.versions.find((item) => item.id === timeline.project.finalVersionId || item.status === "finalized");
    if (!finalVersion) throw agentError("该设计还没有完成链上最终确认", { code: "DESIGN_NOT_FINALIZED", httpStatus: 409 });
    const registration = finalVersion.chainRecords.find((item) => item.kind === "register" && item.status === "confirmed");
    const finalization = finalVersion.chainRecords.find((item) => item.kind === "finalize" && item.status === "confirmed");
    return {
      schemaVersion: "jewelchain-certificate/v1",
      project: {
        localDesignId: timeline.project.localDesignId,
        title: timeline.project.title,
      },
      finalVersion: {
        versionNumber: finalVersion.versionNumber,
        contentHash: finalVersion.contentHash,
        parentContentHash: finalVersion.parentContentHash,
        imageHash: finalVersion.imageHash,
        metadataUri: finalVersion.metadataUri,
        registrant: finalVersion.registrant,
      },
      monad: {
        chainId: this.chain.chainId,
        contractAddress: this.chain.contractAddress,
        registrationTxHash: registration?.txHash || null,
        registrationBlockNumber: registration?.blockNumber || null,
        finalizationTxHash: finalization?.txHash || null,
        finalizationBlockNumber: finalization?.blockNumber || null,
        registrationExplorerUrl: registration?.explorerUrl || null,
        finalizationExplorerUrl: finalization?.explorerUrl || null,
      },
      issuedAt: iso(),
      declaration: "该凭证用于展示设计内容指纹、登记地址、版本关系与链上时间，不替代版权登记、原创性审查或法律认定。",
    };
  }

  async answerQuestion(projectId, question) {
    const timeline = await this.timeline(projectId);
    const query = text(question);
    const versions = timeline.versions;
    const finalVersion = versions.find((item) => item.id === timeline.project.finalVersionId || item.status === "finalized");
    if (/最终|定稿|确认版/.test(query)) {
      if (!finalVersion) return { intent: "final_version", answer: "当前还没有完成链上最终确认。请先将一个已登记版本设为最终版。", evidence: [] };
      const record = finalVersion.chainRecords.find((item) => item.kind === "finalize" && item.status === "confirmed");
      return {
        intent: "final_version",
        answer: `最终确认版是 V${finalVersion.versionNumber}。它的内容指纹为 ${finalVersion.contentHash}，最终确认交易已经在 Monad 上完成。`,
        evidence: [{ label: "版本", value: `V${finalVersion.versionNumber}` }, { label: "contentHash", value: finalVersion.contentHash }, { label: "交易", value: record?.txHash || "" }, { label: "Explorer", value: record?.explorerUrl || "" }],
      };
    }
    if (/来源|父版本|V2|v2|从.*改|版本关系/.test(query)) {
      const child = versions.find((item) => item.versionNumber === 2) || versions.at(-1);
      const parent = child?.parentVersionId ? versions.find((item) => item.id === child.parentVersionId) : null;
      if (!child || !parent) return { intent: "parent_relation", answer: "目前还没有形成 V1 → V2 的父子版本关系。", evidence: [] };
      const matched = child.parentContentHash?.toLowerCase() === parent.contentHash?.toLowerCase();
      return {
        intent: "parent_relation",
        answer: matched
          ? `是的，V${child.versionNumber} 的 parentContentHash 与 V${parent.versionNumber} 的 contentHash 完全一致，因此可以验证它来自上一版本。`
          : `当前父版本 Hash 不一致，不能证明 V${child.versionNumber} 来源于 V${parent.versionNumber}。`,
        evidence: [{ label: `V${parent.versionNumber} contentHash`, value: parent.contentHash }, { label: `V${child.versionNumber} parentContentHash`, value: child.parentContentHash }],
      };
    }
    if (/替换|篡改|一致|完整|验证/.test(query)) {
      const latest = versions.at(-1);
      if (!latest?.metadata || !latest.contentHash) return { intent: "integrity", answer: "最新版本还没有生成冻结 Metadata，暂时无法校验。", evidence: [] };
      const recomputed = hashCanonical(latest.metadata);
      const matched = recomputed.toLowerCase() === latest.contentHash.toLowerCase();
      return {
        intent: "integrity",
        answer: matched
          ? `最新 V${latest.versionNumber} 的 Metadata 重新计算结果与登记 contentHash 一致，当前本地记录没有发现被替换。`
          : `最新 V${latest.versionNumber} 的 Metadata Hash 与登记记录不一致，可能发生了修改。`,
        evidence: [{ label: "登记 contentHash", value: latest.contentHash }, { label: "重新计算", value: recomputed }, { label: "结果", value: matched ? "一致" : "不一致" }],
      };
    }
    return {
      intent: "summary",
      answer: `该设计目前有 ${versions.length} 个版本，${versions.filter((item) => ["chain_confirmed", "finalized"].includes(item.status)).length} 个版本已在 Monad 确认。你可以问：最终确认版是哪版？V2 是否来自 V1？记录有没有被替换？`,
      evidence: versions.map((item) => ({ label: `V${item.versionNumber}`, value: item.status })),
    };
  }
}
