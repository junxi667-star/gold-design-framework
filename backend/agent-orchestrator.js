import path from "node:path";
import { randomUUID } from "node:crypto";

import { RequirementParserService } from "./requirements/requirement-parser-service.js";
import { buildGoldApiImagePrompt } from "./gold-prompt-builder.js";
import { clone, iso, list, text } from "./utils.js";
import { hashCanonical } from "./design-manifest.js";
import { ZERO_HASH, normalizeAddress } from "./evm-codec.js";
import { assertVersionTransition } from "./version-states.js";
import { ChainOrchestrator } from "./chain-orchestrator.js";
import {
  createAppError,
  AGENT_ERROR,
  INVALID_WALLET_ADDRESS,
  INVALID_REQUIREMENT,
  INVALID_CHANGE_REQUEST,
  INVALID_TX_HASH,
  PROJECT_NOT_FOUND,
  PARENT_VERSION_NOT_FOUND,
  JOB_NOT_FOUND,
  VERSION_NOT_FOUND,
  PARENT_NOT_ONCHAIN,
  DESIGN_FINALIZED,
  INVALID_VERSION_STATE,
  VERSION_NOT_READY,
  REGISTRANT_LOCKED,
  PARENT_NOT_CONFIRMED,
  DESIGN_OWNER_WALLET_REQUIRED,
  WALLET_MISMATCH,
  VERSION_NOT_REGISTERED,
  UNAUTHORIZED_FINALIZER,
  DESIGN_NOT_FINALIZED,
  GENERATION_FAILED,
} from "./error-codes.js";

function agentError(message, { code = AGENT_ERROR, httpStatus, retryable, details } = {}) {
  return createAppError(code, { message, httpStatus, retryable, details });
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
  constructor({ store, generationDispatcher, imageProvider, storageService, chainService, chainOrchestrator, generatedDir } = {}) {
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
    this.chainOps = chainOrchestrator || new ChainOrchestrator({ store, storage: storageService, chain: chainService });
    this.generatedDir = generatedDir;
    this.parser = new RequirementParserService();
  }

  async config() {
    const generation = await this.generation.status();
    return {
      version: "1.3.1",
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
    if (raw.length < 6) throw agentError("请输入更详细的珠宝需求，至少包含一句完整描述", { code: INVALID_REQUIREMENT });
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
    if (change.length < 2) throw agentError("请填写本次修改要求", { code: INVALID_CHANGE_REQUEST });
    const state = await this.store.read();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) throw agentError("设计项目不存在", { code: PROJECT_NOT_FOUND, httpStatus: 404 });
    const parent = state.versions.find((item) => item.id === parentVersionId && item.projectId === projectId);
    if (!parent) throw agentError("作为修改来源的上一版本不存在", { code: PARENT_VERSION_NOT_FOUND, httpStatus: 404 });
    if (parent.status !== "chain_confirmed") {
      throw agentError("为确保版本来源可验证，请先将当前版本登记到 Monad。登记完成后，系统才能把它记录为下一版的来源", { code: PARENT_NOT_ONCHAIN, httpStatus: 409 });
    }
    if (project.finalVersionId) throw agentError("该设计已经确定最终版本，不能继续新增版本", { code: DESIGN_FINALIZED, httpStatus: 409 });
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
        assertVersionTransition(version.status, "awaiting_confirmation");
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
        if (version) assertVersionTransition(version.status, "generation_failed");
        if (job) Object.assign(job, { status: "failed", progress: Math.max(job.progress || 0, 30), currentStep: "图片生成失败", error: { code: error.code || GENERATION_FAILED, message: error.message, details: error.details || null }, updatedAt: iso() });
        if (version) Object.assign(version, { status: "generation_failed", error: { code: error.code || GENERATION_FAILED, message: error.message }, updatedAt: iso() });
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
    if (!job) throw agentError("任务不存在", { code: JOB_NOT_FOUND, httpStatus: 404 });
    const version = state.versions.find((item) => item.id === job.versionId);
    return { ...job, version: version ? publicVersion(version) : null };
  }

  async getProject(projectId) {
    const state = await this.store.read();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) throw agentError("设计项目不存在", { code: PROJECT_NOT_FOUND, httpStatus: 404 });
    const versions = state.versions.filter((item) => item.projectId === projectId).sort((a, b) => a.versionNumber - b.versionNumber).map(publicVersion);
    return { ...clone(project), versions };
  }

  async prepareRegistration(versionId, input) {
    return this.chainOps.prepareRegistration(versionId, input);
  }

  async recordSubmission(versionId, input) {
    return this.chainOps.recordSubmission(versionId, input);
  }

  async getChainStatus(versionId, kind = "register") {
    return this.chainOps.getChainStatus(versionId, kind);
  }

  async prepareFinalize(versionId, input) {
    return this.chainOps.prepareFinalize(versionId, input);
  }

  async timeline(projectId) {
    const state = await this.store.read();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) throw agentError("设计项目不存在", { code: PROJECT_NOT_FOUND, httpStatus: 404 });
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
    if (!finalVersion) throw agentError("该设计还没有完成链上最终确认", { code: DESIGN_NOT_FINALIZED, httpStatus: 409 });
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
      if (!finalVersion) return { intent: "final_version", answer: "当前还没有确认最终版。请先将一个已登记版本确认为最终版。", evidence: [] };
      const record = finalVersion.chainRecords.find((item) => item.kind === "finalize" && item.status === "confirmed");
      return {
        intent: "final_version",
        answer: `被确认为最终版的是 V${finalVersion.versionNumber}。它的内容指纹为 ${finalVersion.contentHash}，最终版确认交易已在 Monad 上完成。`,
        evidence: [{ label: "版本", value: `V${finalVersion.versionNumber}` }, { label: "内容指纹 (contentHash)", value: finalVersion.contentHash }, { label: "交易", value: record?.txHash || "" }, { label: "Explorer", value: record?.explorerUrl || "" }],
      };
    }
    if (/修改要求|改了什么|修改了什么|有哪些修改|变化|调整内容/.test(query)) {
      const targetMatch = query.match(/[Vv](\d+)/);
      const requestedVersion = targetMatch ? Number(targetMatch[1]) : Math.max(...versions.map((item) => item.versionNumber));
      const target = versions.find((item) => item.versionNumber === requestedVersion);
      if (!target) return { intent: "change_request", answer: `当前没有找到 V${requestedVersion}。`, evidence: [] };
      if (target.versionNumber === 1) {
        return {
          intent: "change_request",
          answer: "V1 是根据初始客户需求生成的第一版设计，不属于在上一版基础上的修改版本。",
          evidence: [{ label: "版本", value: "V1" }, { label: "初始需求", value: timeline.project.customerText || "" }],
        };
      }
      return {
        intent: "change_request",
        answer: `V${target.versionNumber} 的修改要求是：${target.changeRequest || "未记录修改要求"}`,
        evidence: [
          { label: "版本", value: `V${target.versionNumber}` },
          { label: "修改要求", value: target.changeRequest || "未记录" },
          { label: "来源版本", value: target.parentVersionId ? `V${target.versionNumber - 1}` : "未记录" },
        ],
      };
    }
    if (/来源|父版本|V2|v2|从.*改|版本关系/.test(query)) {
      const child = versions.find((item) => item.versionNumber === 2) || versions.at(-1);
      const parent = child?.parentVersionId ? versions.find((item) => item.id === child.parentVersionId) : null;
      if (!child || !parent) return { intent: "parent_relation", answer: "目前还没有形成 V1 → V2 的版本继承关系。", evidence: [] };
      const matched = child.parentContentHash?.toLowerCase() === parent.contentHash?.toLowerCase();
      return {
        intent: "parent_relation",
        answer: matched
          ? `是的。V${child.versionNumber} 记录的上一版指纹，与 V${parent.versionNumber} 的内容指纹完全一致，因此可以验证 V${child.versionNumber} 由 V${parent.versionNumber} 修改而来。`
          : `当前记录的上一版指纹不一致，无法验证 V${child.versionNumber} 由 V${parent.versionNumber} 修改而来。`,
        evidence: [{ label: `V${parent.versionNumber} 内容指纹`, value: parent.contentHash }, { label: `V${child.versionNumber} 上一版指纹`, value: child.parentContentHash }],
      };
    }
    if (/替换|篡改|一致|完整|验证/.test(query)) {
      const latest = versions.at(-1);
      if (!latest?.metadata || !latest.contentHash) return { intent: "integrity", answer: "最新版本还没有生成完整版本信息，暂时无法进行一致性校验。", evidence: [] };
      const recomputed = hashCanonical(latest.metadata);
      const matched = recomputed.toLowerCase() === latest.contentHash.toLowerCase();
      return {
        intent: "integrity",
        answer: matched
          ? `当前文件与链上登记一致。最新 V${latest.versionNumber} 的版本信息重新计算后，得到的内容指纹与链上登记值一致。`
          : `当前文件与链上登记不一致。最新 V${latest.versionNumber} 重新计算得到的内容指纹，与链上登记值不同，说明当前内容已经发生变化或不是当时登记的文件。`,
        evidence: [{ label: "链上登记的内容指纹", value: latest.contentHash }, { label: "当前文件重新计算结果", value: recomputed }, { label: "结果", value: matched ? "一致" : "不一致" }],
      };
    }
    return {
      intent: "summary",
      answer: `该设计目前有 ${versions.length} 个版本，${versions.filter((item) => ["chain_confirmed", "finalized"].includes(item.status)).length} 个版本已在 Monad 确认。你可以问：哪一版被确认为最终版？V2 是否由 V1 修改而来？当前文件是否与链上登记一致？`,
      evidence: versions.map((item) => ({ label: `V${item.versionNumber}`, value: item.status })),
    };
  }
}
