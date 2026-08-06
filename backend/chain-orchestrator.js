// backend/chain-orchestrator.js — 链上编排（登记准备、提交、验证、最终确认）
import { randomUUID } from "node:crypto";

import { clone, iso } from "./utils.js";
import { buildMetadata, hashImageFile } from "./design-manifest.js";
import { keccak256 } from "./keccak.js";
import { ZERO_HASH, normalizeAddress } from "./evm-codec.js";
import { assertVersionTransition, REGISTRATION_PREPARE_STATES } from "./version-states.js";
import {
  createAppError,
  AGENT_ERROR,
  INVALID_WALLET_ADDRESS,
  INVALID_TX_HASH,
  VERSION_NOT_FOUND,
  INVALID_VERSION_STATE,
  VERSION_NOT_READY,
  REGISTRANT_LOCKED,
  PARENT_NOT_CONFIRMED,
  DESIGN_OWNER_WALLET_REQUIRED,
  WALLET_MISMATCH,
  VERSION_NOT_REGISTERED,
  UNAUTHORIZED_FINALIZER,
} from "./error-codes.js";

function agentError(message, { code = AGENT_ERROR, httpStatus, retryable, details } = {}) {
  return createAppError(code, { message, httpStatus, retryable, details });
}

function requireWallet(value) {
  try {
    return normalizeAddress(value);
  } catch {
    throw agentError("钱包地址格式无效，请重新连接 MetaMask", { code: INVALID_WALLET_ADDRESS, httpStatus: 400 });
  }
}

function publicVersion(version) {
  const copy = clone(version);
  delete copy.apiPrompt;
  delete copy.imageFilePath;
  return copy;
}

export class ChainOrchestrator {
  constructor({ store, storage, chain } = {}) {
    this.store = store;
    this.storage = storage;
    this.chain = chain;
  }

  async prepareRegistration(versionId, { walletAddress, baseUrl }) {
    const wallet = requireWallet(walletAddress);
    const state = await this.store.read();
    const version = state.versions.find((item) => item.id === versionId);
    if (!version) throw agentError("设计版本不存在", { code: VERSION_NOT_FOUND, httpStatus: 404 });
    const project = state.projects.find((item) => item.id === version.projectId);
    if (!REGISTRATION_PREPARE_STATES.includes(version.status)) {
      if (version.status === "chain_confirmed") return { alreadyConfirmed: true, version: publicVersion(version) };
      throw agentError("当前版本状态不能准备上链", { code: INVALID_VERSION_STATE, httpStatus: 409, details: { status: version.status } });
    }
    if (!version.imageFilePath || !version.apiPrompt) throw agentError("版本缺少真实图片或提示词", { code: VERSION_NOT_READY, httpStatus: 409 });
    if (version.registrant && normalizeAddress(version.registrant) !== wallet) {
      throw agentError("该版本已经绑定另一个登记钱包，请使用原钱包", { code: REGISTRANT_LOCKED, httpStatus: 409 });
    }
    const parent = version.parentVersionId ? state.versions.find((item) => item.id === version.parentVersionId) : null;
    if (parent && parent.status !== "chain_confirmed") throw agentError("父版本尚未在 Monad 确认", { code: PARENT_NOT_CONFIRMED, httpStatus: 409 });
    if (parent?.registrant && requireWallet(parent.registrant) !== wallet) {
      throw agentError("V2 必须使用与 V1 相同的钱包登记", { code: DESIGN_OWNER_WALLET_REQUIRED, httpStatus: 409 });
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
      assertVersionTransition(current.status, "awaiting_wallet_signature");
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
    if (!/^0x[0-9a-f]{64}$/i.test(txHash)) throw agentError("txHash 格式无效", { code: INVALID_TX_HASH });
    const state = await this.store.read();
    const version = state.versions.find((item) => item.id === versionId);
    if (!version) throw agentError("设计版本不存在", { code: VERSION_NOT_FOUND, httpStatus: 404 });
    if (normalizeAddress(version.registrant) !== wallet) throw agentError("回传钱包与登记钱包不一致", { code: WALLET_MISMATCH, httpStatus: 409 });
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
        assertVersionTransition(current.status, "tx_submitted");
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
    if (!version) throw agentError("设计版本不存在", { code: VERSION_NOT_FOUND, httpStatus: 404 });
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
          assertVersionTransition(currentVersion.status, "chain_confirmed");
          currentVersion.status = "chain_confirmed";
          currentVersion.onchainVersionNumber = verification.event.versionNumber;
          currentVersion.registeredBy = verification.event.registeredBy;
        } else {
          assertVersionTransition(currentVersion.status, "finalized");
          currentVersion.status = "finalized";
          project.finalVersionId = currentVersion.id;
        }
      } else if (kind === "register") {
        assertVersionTransition(currentVersion.status, "registration_failed");
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
    if (!version) throw agentError("设计版本不存在", { code: VERSION_NOT_FOUND, httpStatus: 404 });
    if (version.status === "finalized") return { alreadyFinalized: true, version: publicVersion(version) };
    if (version.status !== "chain_confirmed") throw agentError("只有已登记到 Monad 的版本才能确认为最终版", { code: VERSION_NOT_REGISTERED, httpStatus: 409 });
    if (normalizeAddress(version.registrant) !== wallet) throw agentError("只有原登记钱包可以确认最终版", { code: UNAUTHORIZED_FINALIZER, httpStatus: 403 });
    return { versionId, ...this.chain.prepareFinalize({ designId: version.designId, contentHash: version.contentHash }) };
  }
}
