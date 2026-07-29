import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  Contract,
  Interface,
  JsonRpcProvider,
  getAddress,
  id,
} from "ethers";

import {
  DESIGN_MANIFEST_SCHEMA_VERSION,
  DESIGN_MANIFEST_ZERO_PARENT_HASH,
  canonicalJson,
  designManifestContentHash,
  manifestHashingDescriptor,
} from "./design-manifest.js";
import { apiError } from "./utils.js";
import { Web3StateStore } from "./web3-state-store.js";

export { canonicalJson } from "./design-manifest.js";

const CONFIRM_ALLOWED_FIELDS = new Set([
  "imageSha256",
  "metadataUri",
  "parentVersionId",
  "requirementRevisionId",
  "resultId",
  "selectedResultId",
  "confirmationSource",
  "confirmedBy",
]);
const PREPARE_ALLOWED_FIELDS = new Set([
  "projectId",
  "versionId",
  "sourceVersionId",
  "resultId",
  "confirmationId",
  "finalize",
]);
const SUBMIT_ALLOWED_FIELDS = new Set([
  "finalize",
  "acknowledgedLocalDevelopmentSigner",
  "expectedContentHash",
]);
const VERIFY_ALLOWED_FIELDS = new Set(["expectedContentHash"]);
const HASH_PATTERN = /^(?:sha256:)?([a-f0-9]{64})$/i;
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/;
const SENSITIVE_IDENTIFIER_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|passwd|secret|mnemonic|email|e-mail|phone|mobile|wechat|wxid|openid|idcard|realname|full[_-]?name)/i;
const SECRET_VALUE_PATTERN = /(?:sk-(?:live|test-)?[a-z0-9_-]{12,}|github_pat_[a-z0-9_]{12,}|gh[pousr]_[a-z0-9]{12,}|bearer[._:-][a-z0-9_-]{12,})/i;
const MAX_CHAINABLE_IMAGE_BYTES = 50 * 1024 * 1024;
const ZERO_HASH = DESIGN_MANIFEST_ZERO_PARENT_HASH;

function inputError(message, fields = []) {
  return apiError(message, {
    code: "INPUT_VALIDATION_FAILED",
    httpStatus: 400,
    details: { fields },
  });
}

function assertAllowedFields(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw inputError("请求体必须是 JSON 对象", ["body"]);
  }
  const unexpected = Object.keys(body).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw inputError("请求包含未允许的字段；客户原话、个人信息和原图不得进入链上流程", unexpected);
  }
}

function safeIdentifier(value, field) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    !normalized
    || !OPAQUE_IDENTIFIER_PATTERN.test(normalized)
    || SENSITIVE_IDENTIFIER_PATTERN.test(normalized)
    || SECRET_VALUE_PATTERN.test(normalized)
    || /^\d{7,}$/.test(normalized)
  ) {
    throw inputError(`${field} 必须是非身份化、不含敏感内容的系统标识符`, [field]);
  }
  return normalized;
}

function optionalIdentifier(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return safeIdentifier(value, field);
}

function normalizeImageSha256(value) {
  if (value === undefined || value === null || value === "") return null;
  const matched = typeof value === "string" ? value.trim().match(HASH_PATTERN) : null;
  if (!matched) {
    throw inputError("imageSha256 如提供，必须是 64 位十六进制 SHA-256 一致性断言", ["imageSha256"]);
  }
  return matched[1].toLowerCase();
}

function normalizeMetadataUri(value, projectId, versionId) {
  const defaultUri = `local://design-manifests/${projectId}/${versionId}`;
  if (value === undefined || value === null || value === "") {
    return defaultUri;
  }
  if (typeof value !== "string" || value.length > 512) {
    throw inputError("metadataUri 格式无效", ["metadataUri"]);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw inputError("metadataUri 必须使用 local://、http:// 或 https://", ["metadataUri"]);
  }
  if (!["local:", "http:", "https:"].includes(parsed.protocol)) {
    throw inputError("metadataUri 必须使用 local://、http:// 或 https://", ["metadataUri"]);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw inputError("metadataUri 不得包含账号、口令、查询参数或片段", ["metadataUri"]);
  }
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    throw inputError("metadataUri 路径编码无效", ["metadataUri"]);
  }
  if (
    /[\u0000-\u001f\u007f]/.test(decodedPath)
    || /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(decodedPath)
    || /(?:^|\D)1[3-9]\d{9}(?:\D|$)/.test(decodedPath)
    || SENSITIVE_IDENTIFIER_PATTERN.test(decodedPath)
    || SECRET_VALUE_PATTERN.test(decodedPath)
  ) {
    throw inputError("metadataUri 路径不得包含身份信息或敏感内容", ["metadataUri"]);
  }
  if (parsed.protocol === "local:" && parsed.toString() !== defaultUri) {
    throw inputError("local:// metadataUri 必须使用当前项目和版本的标准清单地址", ["metadataUri"]);
  }
  if (
    parsed.protocol === "http:"
    && !["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname.toLowerCase())
  ) {
    throw inputError("非本机 metadataUri 必须使用 https://", ["metadataUri"]);
  }
  return parsed.toString();
}

function imageMimeType(buffer) {
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP"
  ) return "image/webp";
  return null;
}

async function readFinalImageEvidence(generatedDir, candidate) {
  if (!generatedDir) {
    throw apiError("服务端没有配置真实生成图片目录，当前结果不可上链", {
      code: "CHAINABLE_IMAGE_STORAGE_NOT_CONFIGURED",
      httpStatus: 409,
    });
  }
  const filename = candidate.imageAsset?.filename;
  if (
    typeof filename !== "string"
    || !filename
    || filename !== path.basename(filename)
    || !/^[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/i.test(filename)
  ) {
    throw apiError("AI 结果没有安全、可定位的真实图片文件", {
      code: "IMAGE_ASSET_NOT_CHAINABLE",
      httpStatus: 409,
    });
  }
  const expectedImageUrl = `/generated/${encodeURIComponent(filename)}`;
  if (candidate.imageUrl !== expectedImageUrl) {
    throw apiError("AI 结果图片地址与归档文件不一致或包含额外参数", {
      code: "IMAGE_ASSET_REFERENCE_MISMATCH",
      httpStatus: 409,
    });
  }

  let rootPath;
  let filePath;
  let fileInfo;
  let bytes;
  try {
    rootPath = await realpath(path.resolve(generatedDir));
    filePath = await realpath(path.resolve(generatedDir, filename));
    const prefix = `${rootPath}${path.sep}`;
    if (filePath !== rootPath && !filePath.startsWith(prefix)) {
      throw new Error("Generated image escaped configured directory");
    }
    fileInfo = await lstat(filePath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
      throw new Error("Generated image is not a regular file");
    }
    if (fileInfo.size <= 0 || fileInfo.size > MAX_CHAINABLE_IMAGE_BYTES) {
      throw new Error("Generated image size is outside the chainable range");
    }
    bytes = await readFile(filePath);
  } catch {
    throw apiError("真实生成图片文件不存在、不可读取或不在受控目录内", {
      code: "IMAGE_ASSET_UNAVAILABLE",
      httpStatus: 409,
    });
  }

  const detectedMimeType = imageMimeType(bytes);
  if (!detectedMimeType) {
    throw apiError("归档文件不是受支持的 PNG、JPEG 或 WebP 图片", {
      code: "IMAGE_ASSET_TYPE_INVALID",
      httpStatus: 409,
    });
  }
  const storedMimeType = String(candidate.imageAsset.mimeType || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const storedHashMatch = typeof candidate.imageAsset.sha256 === "string"
    ? candidate.imageAsset.sha256.trim().match(HASH_PATTERN)
    : null;
  const storedSha256 = storedHashMatch?.[1]?.toLowerCase() || null;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    !storedSha256
    || storedSha256 !== sha256
    || Number(candidate.imageAsset.sizeBytes) !== bytes.length
    || (storedMimeType && storedMimeType !== detectedMimeType)
  ) {
    throw apiError("真实图片字节与 AI 结果归档证据不一致，拒绝固化", {
      code: "IMAGE_ASSET_INTEGRITY_MISMATCH",
      httpStatus: 409,
    });
  }
  return {
    sha256,
    sizeBytes: bytes.length,
    mimeType: detectedMimeType,
    source: "server-computed-final-image-bytes",
    assetFilename: filename,
  };
}

function assertFrozenConfirmationIntegrity(confirmation) {
  const expectedHashing = manifestHashingDescriptor();
  let computedCanonical;
  let computedContentHash;
  let hashingCanonical;
  try {
    computedCanonical = canonicalJson(confirmation?.manifest);
    computedContentHash = designManifestContentHash(confirmation?.manifest);
    hashingCanonical = canonicalJson(confirmation?.manifestHashing);
  } catch {
    computedCanonical = null;
    computedContentHash = null;
    hashingCanonical = null;
  }
  const manifest = confirmation?.manifest;
  const imageEvidence = confirmation?.imageEvidence;
  const valid = Boolean(
    confirmation
    && manifest?.schemaVersion === DESIGN_MANIFEST_SCHEMA_VERSION
    && manifest.resultId
    && confirmation.selectedResultId === manifest.resultId
    && manifest.requirementRevisionId
    && manifest.imageHashSource === "server-computed-final-image-bytes"
    && imageEvidence?.source === "server-computed-final-image-bytes"
    && imageEvidence.sha256 === manifest.imageSha256
    && imageEvidence.sizeBytes === manifest.imageSizeBytes
    && imageEvidence.mimeType === manifest.imageMimeType
    && computedCanonical === confirmation.canonicalManifest
    && computedContentHash?.toLowerCase() === confirmation.contentHash?.toLowerCase()
    && hashingCanonical === canonicalJson(expectedHashing)
    && confirmation.parentContentHash === manifest.parentContentHash
    && confirmation.parentVersionId === manifest.parentVersionId
  );
  if (!valid) {
    throw apiError("确认记录不符合冻结的 design-manifest/v1 完整性规则", {
      code: "CONFIRMATION_INTEGRITY_INVALID",
      httpStatus: 409,
    });
  }
}

function assertImageEvidenceMatchesManifest(imageEvidence, manifest) {
  if (
    imageEvidence.sha256 !== manifest.imageSha256
    || imageEvidence.sizeBytes !== manifest.imageSizeBytes
    || imageEvidence.mimeType !== manifest.imageMimeType
  ) {
    throw apiError("当前最终图片字节与已确认清单不一致，拒绝继续登记", {
      code: "CONFIRMED_IMAGE_CHANGED",
      httpStatus: 409,
    });
  }
}

function isLoopbackRpcUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:"
      && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function rpcRequest(rpcUrl, method, params = [], timeoutMs = 1000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || "RPC request failed");
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

function serializedRecord(record) {
  return {
    contentHash: record.contentHash,
    parentContentHash: record.parentContentHash,
    metadataUri: record.metadataUri,
    registeredBy: record.registeredBy,
    registeredAt: Number(record.registeredAt),
    versionNumber: Number(record.versionNumber),
    exists: record.exists,
    finalized: record.finalized,
  };
}

export class Web3RegistryService {
  constructor({
    statePath,
    runtimePath,
    artifactPath,
    generatedDir,
    candidateResolver,
    rpcUrl = process.env.LOCAL_EVM_RPC_URL || "http://127.0.0.1:8545",
    chainId = Number(process.env.LOCAL_EVM_CHAIN_ID || 31337),
    now = () => new Date(),
  }) {
    this.store = new Web3StateStore(statePath);
    this.runtimePath = runtimePath;
    this.artifactPath = artifactPath;
    this.generatedDir = generatedDir;
    this.candidateResolver = candidateResolver;
    this.defaultRpcUrl = rpcUrl;
    this.expectedChainId = chainId;
    this.now = now;
    this.artifact = null;
  }

  async getArtifact() {
    if (!this.artifact) {
      this.artifact = JSON.parse(await readFile(this.artifactPath, "utf8"));
    }
    return this.artifact;
  }

  async getConfig() {
    const runtime = await readOptionalJson(this.runtimePath);
    const rpcUrl = runtime?.rpcUrl || this.defaultRpcUrl;
    const base = {
      mode: "local-development",
      status: "NOT_CONNECTED",
      connected: false,
      rpcUrl,
      chainId: this.expectedChainId,
      contractAddress: runtime?.contractAddress || null,
      deploymentTransactionHash: runtime?.deploymentTransactionHash || null,
      signer: {
        type: "local-development-signer",
        address: runtime?.developmentSignerAddress || null,
        requiresUserWallet: false,
      },
      capabilities: {
        prepare: Boolean(runtime?.contractAddress),
        submitLocal: Boolean(runtime?.contractAddress),
        verify: Boolean(runtime?.contractAddress),
        publicNetwork: false,
      },
      warning: "仅限本地开发 EVM；不是 Monad 测试网或主网，也不是用户钱包。",
      error: null,
    };

    if (!isLoopbackRpcUrl(rpcUrl) || (runtime && runtime.mode !== "local-development")) {
      return {
        ...base,
        error: {
          code: "LOCAL_ONLY_CONFIGURATION_REQUIRED",
          message: "Web3 后端拒绝连接非回环 RPC 或非本地运行模式",
        },
      };
    }

    let rpcChainId;
    let accounts;
    try {
      [rpcChainId, accounts] = await Promise.all([
        rpcRequest(rpcUrl, "eth_chainId"),
        rpcRequest(rpcUrl, "eth_accounts"),
      ]);
    } catch {
      return {
        ...base,
        error: {
          code: "LOCAL_EVM_NOT_CONNECTED",
          message: "本地 EVM 未启动或无法连接",
        },
      };
    }

    const actualChainId = Number(BigInt(rpcChainId));
    if (actualChainId !== this.expectedChainId) {
      return {
        ...base,
        chainId: actualChainId,
        error: {
          code: "LOCAL_CHAIN_ID_MISMATCH",
          message: `本地链 ID 不匹配：期望 ${this.expectedChainId}，实际 ${actualChainId}`,
        },
      };
    }

    if (!runtime?.contractAddress) {
      return {
        ...base,
        status: "CHAIN_CONNECTED_CONTRACT_MISSING",
        chainId: actualChainId,
        signer: {
          ...base.signer,
          address: accounts?.[0] ? getAddress(accounts[0]) : null,
        },
        error: {
          code: "LOCAL_REGISTRY_NOT_DEPLOYED",
          message: "本地 EVM 已连接，但 DesignRegistry 尚未部署",
        },
      };
    }

    let code;
    try {
      code = await rpcRequest(rpcUrl, "eth_getCode", [runtime.contractAddress, "latest"]);
    } catch {
      code = "0x";
    }
    if (!code || code === "0x") {
      return {
        ...base,
        status: "CHAIN_CONNECTED_CONTRACT_MISSING",
        chainId: actualChainId,
        error: {
          code: "LOCAL_REGISTRY_NOT_DEPLOYED",
          message: "运行配置中的 DesignRegistry 地址没有合约代码",
        },
      };
    }

    return {
      ...base,
      status: "READY_LOCAL",
      connected: true,
      chainId: actualChainId,
      contractAddress: getAddress(runtime.contractAddress),
      signer: {
        ...base.signer,
        address: accounts?.[0] ? getAddress(accounts[0]) : null,
      },
      capabilities: {
        prepare: true,
        submitLocal: true,
        verify: true,
        publicNetwork: false,
      },
    };
  }

  async requireConnected() {
    const config = await this.getConfig();
    if (config.connected) return config;
    const code = config.error?.code || "LOCAL_EVM_NOT_CONNECTED";
    throw apiError(config.error?.message || "本地 EVM 未连接", {
      code,
      httpStatus: code === "LOCAL_ONLY_CONFIGURATION_REQUIRED" ? 409 : 503,
      retryable: code === "LOCAL_EVM_NOT_CONNECTED",
      details: { status: config.status },
    });
  }

  async confirmProjectVersion(projectIdValue, versionIdValue, body) {
    assertAllowedFields(body, CONFIRM_ALLOWED_FIELDS);
    const projectId = safeIdentifier(projectIdValue, "projectId");
    const versionId = safeIdentifier(versionIdValue, "versionId");
    const directResultId = safeIdentifier(body.resultId, "resultId");
    const selectedResultId = optionalIdentifier(body.selectedResultId, "selectedResultId");
    if (selectedResultId && directResultId !== selectedResultId) {
      throw inputError("resultId 与 selectedResultId 不一致", ["resultId", "selectedResultId"]);
    }
    const resultId = directResultId;
    if (
      body.confirmationSource !== undefined
      && body.confirmationSource !== "local_registry_workbench"
    ) {
      throw inputError(
        "confirmationSource 只能是 local_registry_workbench",
        ["confirmationSource"],
      );
    }
    if (
      body.confirmedBy !== undefined
      && body.confirmedBy !== "local-development-user"
    ) {
      throw inputError(
        "confirmedBy 只能是非身份化枚举 local-development-user，不能填写姓名",
        ["confirmedBy"],
      );
    }
    const requirementRevisionId = optionalIdentifier(
      body.requirementRevisionId,
      "requirementRevisionId",
    );
    const requestedParentVersionId = optionalIdentifier(body.parentVersionId, "parentVersionId");
    const clientImageSha256 = normalizeImageSha256(body.imageSha256);
    const metadataUri = normalizeMetadataUri(body.metadataUri, projectId, versionId);
    if (typeof this.candidateResolver !== "function") {
      throw apiError("AI 结果解析器未配置，不能确认候选版本", {
        code: "AI_RESULT_RESOLVER_NOT_CONFIGURED",
        httpStatus: 409,
      });
    }
    const candidate = await this.candidateResolver({ projectId, versionId, resultId });
    const candidateRequirementRevisionId = safeIdentifier(
      candidate.requirementRevisionId,
      "requirementRevisionId",
    );
    const candidateParentVersionId = optionalIdentifier(
      candidate.parentVersionId,
      "parentVersionId",
    );
    if (
      requirementRevisionId
      && requirementRevisionId !== candidateRequirementRevisionId
    ) {
      throw apiError("requirementRevisionId 与 AI 候选结果不一致", {
        code: "REQUIREMENT_REVISION_MISMATCH",
        httpStatus: 409,
      });
    }
    if (
      requestedParentVersionId
      && requestedParentVersionId !== candidateParentVersionId
    ) {
      throw apiError("parentVersionId 与 AI 候选结果的父版本不一致", {
        code: "PARENT_VERSION_MISMATCH",
        httpStatus: 409,
      });
    }
    const imageEvidence = await readFinalImageEvidence(this.generatedDir, candidate);
    if (clientImageSha256 && clientImageSha256 !== imageEvidence.sha256) {
      throw apiError("客户端提供的 imageSha256 与服务端读取的最终图片字节不一致", {
        code: "CLIENT_IMAGE_HASH_MISMATCH",
        httpStatus: 409,
      });
    }
    const confirmedAt = this.now().toISOString();

    return this.store.update((state) => {
      if (state.registrations.some(
        (item) => item.projectId === projectId && item.finalizeTransactionHash,
      )) {
        throw apiError("该项目已有最终确认交易，不能再创建后续版本", {
          code: "DESIGN_ALREADY_FINALIZED",
          httpStatus: 409,
        });
      }
      if (state.confirmations.some(
        (item) => item.projectId === projectId && item.versionId === versionId,
      )) {
        throw apiError("该项目版本已经确认，不能覆盖原确认记录", {
          code: "VERSION_ALREADY_CONFIRMED",
          httpStatus: 409,
        });
      }
      if (state.confirmations.some((item) => item.selectedResultId === resultId)) {
        throw apiError("该 AI 候选结果已经绑定到确认记录，不能重复确认", {
          code: "AI_RESULT_ALREADY_CONFIRMED",
          httpStatus: 409,
        });
      }

      const projectConfirmations = state.confirmations.filter(
        (item) => item.projectId === projectId,
      );
      let parent = null;
      if (!projectConfirmations.length && candidateParentVersionId) {
        throw apiError("项目首个确认版本必须是无父版本的 AI 候选结果", {
          code: "FIRST_VERSION_PARENT_NOT_ALLOWED",
          httpStatus: 409,
        });
      }
      if (projectConfirmations.length && !candidateParentVersionId) {
        throw apiError("非首版确认必须指定 parentVersionId", {
          code: "PARENT_VERSION_REQUIRED",
          httpStatus: 409,
        });
      }
      if (candidateParentVersionId) {
        parent = projectConfirmations.find(
          (item) => item.versionId === candidateParentVersionId,
        );
        if (!parent) {
          throw apiError("parentVersionId 不属于该项目的已确认版本", {
            code: "PARENT_VERSION_NOT_FOUND",
            httpStatus: 409,
          });
        }
      }

      const manifest = {
        schemaVersion: DESIGN_MANIFEST_SCHEMA_VERSION,
        projectId,
        versionId,
        resultId,
        requirementRevisionId: candidateRequirementRevisionId,
        imageSha256: imageEvidence.sha256,
        imageSizeBytes: imageEvidence.sizeBytes,
        imageMimeType: imageEvidence.mimeType,
        imageHashSource: imageEvidence.source,
        parentVersionId: parent?.versionId || null,
        parentContentHash: parent?.contentHash || ZERO_HASH,
        metadataUri,
        confirmedAt,
      };
      const normalizedManifest = canonicalJson(manifest);
      const confirmation = {
        confirmationId: `confirmation-${randomUUID()}`,
        projectId,
        versionId,
        status: "confirmed-offchain",
        sourceVersionId: versionId,
        selectedResultId: resultId,
        confirmationSource: body.confirmationSource || "local_registry_workbench",
        confirmedBy: body.confirmedBy || "local-development-user",
        manifest,
        canonicalManifest: normalizedManifest,
        manifestHashing: manifestHashingDescriptor(),
        imageEvidence,
        designId: id(`gold-design-project:${projectId}`),
        contentHash: designManifestContentHash(manifest),
        parentContentHash: parent?.contentHash || ZERO_HASH,
        parentVersionId: parent?.versionId || null,
        versionNumber: projectConfirmations.length + 1,
        isFinal: false,
        createdAt: confirmedAt,
      };
      state.confirmations.push(confirmation);
      return confirmation;
    });
  }

  async prepareRegistration(body) {
    assertAllowedFields(body, PREPARE_ALLOWED_FIELDS);
    const projectId = safeIdentifier(body.projectId, "projectId");
    const versionId = safeIdentifier(body.versionId, "versionId");
    const sourceVersionId = optionalIdentifier(body.sourceVersionId, "sourceVersionId");
    const requestedResultId = optionalIdentifier(body.resultId, "resultId");
    const requestedConfirmationId = optionalIdentifier(body.confirmationId, "confirmationId");
    if (sourceVersionId && sourceVersionId !== versionId) {
      throw inputError(
        "sourceVersionId 必须与已确认的 versionId 一致",
        ["sourceVersionId", "versionId"],
      );
    }
    const finalize = body.finalize === undefined ? false : body.finalize;
    if (typeof finalize !== "boolean") throw inputError("finalize 必须是布尔值", ["finalize"]);

    const config = await this.requireConnected();
    const artifact = await this.getArtifact();
    const contractInterface = new Interface(artifact.abi);
    const snapshot = await this.store.read();
    const snapshotConfirmation = snapshot.confirmations.find(
      (item) => item.projectId === projectId && item.versionId === versionId,
    );
    if (!snapshotConfirmation) {
      throw apiError("只能登记已经确认的版本，候选结果不能直接上链", {
        code: "CONFIRMED_VERSION_NOT_FOUND",
        httpStatus: 404,
      });
    }
    assertFrozenConfirmationIntegrity(snapshotConfirmation);
    if (typeof this.candidateResolver !== "function") {
      throw apiError("AI 结果解析器未配置，不能验证确认记录", {
        code: "AI_RESULT_RESOLVER_NOT_CONFIGURED",
        httpStatus: 409,
      });
    }
    const currentCandidate = await this.candidateResolver({
      projectId,
      versionId,
      resultId: snapshotConfirmation.manifest.resultId,
    });
    const currentImageEvidence = await readFinalImageEvidence(
      this.generatedDir,
      currentCandidate,
    );
    assertImageEvidenceMatchesManifest(
      currentImageEvidence,
      snapshotConfirmation.manifest,
    );

    return this.store.update((state) => {
      const confirmation = state.confirmations.find(
        (item) => item.projectId === projectId && item.versionId === versionId,
      );
      if (!confirmation) {
        throw apiError("只能登记已经确认的版本，候选结果不能直接上链", {
          code: "CONFIRMED_VERSION_NOT_FOUND",
          httpStatus: 404,
        });
      }
      if (
        confirmation.confirmationId !== snapshotConfirmation.confirmationId
        || confirmation.contentHash !== snapshotConfirmation.contentHash
      ) {
        throw apiError("确认记录在准备期间发生变化", {
          code: "CONFIRMATION_CHANGED",
          httpStatus: 409,
        });
      }
      assertFrozenConfirmationIntegrity(confirmation);
      if (requestedConfirmationId && requestedConfirmationId !== confirmation.confirmationId) {
        throw apiError("confirmationId 与已确认版本不一致", {
          code: "CONFIRMATION_ID_MISMATCH",
          httpStatus: 409,
        });
      }
      if (
        requestedResultId
        && requestedResultId !== confirmation.manifest.resultId
      ) {
        throw apiError("resultId 与已确认版本不一致", {
          code: "CONFIRMED_RESULT_MISMATCH",
          httpStatus: 409,
        });
      }
      const existing = state.registrations.find(
        (item) => item.confirmationId === confirmation.confirmationId,
      );
      if (existing) {
        throw apiError("该确认版本已经存在登记任务", {
          code: "REGISTRATION_ALREADY_EXISTS",
          httpStatus: 409,
          details: { registrationId: existing.registrationId, status: existing.status },
        });
      }

      if (confirmation.parentContentHash !== ZERO_HASH) {
        const parentRegistration = state.registrations.find(
          (item) => (
            item.projectId === projectId
            && item.versionId === confirmation.parentVersionId
            && item.contentHash === confirmation.parentContentHash
          ),
        );
        if (
          !parentRegistration
          || parentRegistration.status !== "verified"
          || parentRegistration.verification?.verified !== true
        ) {
          throw apiError("父版本必须先完成本地链登记并通过回读验证", {
            code: "PARENT_VERSION_NOT_REGISTERED",
            httpStatus: 409,
          });
        }
        if (
          parentRegistration.deploymentTransactionHash
          !== config.deploymentTransactionHash
        ) {
          throw apiError("父版本属于已经重启的旧本地链实例", {
            code: "LOCAL_RUNTIME_CHANGED",
            httpStatus: 409,
          });
        }
      }

      const args = [
        confirmation.designId,
        confirmation.contentHash,
        confirmation.parentContentHash,
        confirmation.manifest.metadataUri,
      ];
      const preparedAt = this.now().toISOString();
      const registration = {
        registrationId: `registration-${randomUUID()}`,
        confirmationId: confirmation.confirmationId,
        projectId,
        versionId,
        status: "prepared",
        mode: "local-development",
        chainId: config.chainId,
        contractAddress: config.contractAddress,
        deploymentTransactionHash: config.deploymentTransactionHash,
        designId: confirmation.designId,
        contentHash: confirmation.contentHash,
        parentContentHash: confirmation.parentContentHash,
        metadataUri: confirmation.manifest.metadataUri,
        resultId: confirmation.manifest.resultId,
        sourceVersionId: confirmation.sourceVersionId,
        parentVersionId: confirmation.parentVersionId,
        versionNumber: confirmation.versionNumber,
        isFinal: false,
        manifest: confirmation.manifest,
        canonicalManifest: confirmation.canonicalManifest,
        manifestHashing: confirmation.manifestHashing,
        imageEvidence: confirmation.imageEvidence,
        finalizeRequested: finalize,
        transactionRequest: {
          to: config.contractAddress,
          chainId: config.chainId,
          functionName: "registerVersion",
          args: {
            designId: confirmation.designId,
            contentHash: confirmation.contentHash,
            parentContentHash: confirmation.parentContentHash,
            metadataUri: confirmation.manifest.metadataUri,
          },
          data: contractInterface.encodeFunctionData("registerVersion", args),
        },
        preparedAt,
        transactionHash: null,
        finalizeTransactionHash: null,
        blockNumber: null,
        error: null,
      };
      state.registrations.push(registration);
      return registration;
    });
  }

  async submitLocal(registrationIdValue, body = {}) {
    assertAllowedFields(body, SUBMIT_ALLOWED_FIELDS);
    const registrationId = safeIdentifier(registrationIdValue, "registrationId");
    const config = await this.requireConnected();
    const artifact = await this.getArtifact();
    const provider = new JsonRpcProvider(config.rpcUrl);
    const signer = await provider.getSigner(0);
    const contract = new Contract(config.contractAddress, artifact.abi, signer);

    let state = await this.store.read();
    let registration = state.registrations.find((item) => item.registrationId === registrationId);
    if (!registration) {
      throw apiError("登记任务不存在", {
        code: "REGISTRATION_NOT_FOUND",
        httpStatus: 404,
      });
    }
    if (body.finalize !== undefined && body.finalize !== registration.finalizeRequested) {
      throw apiError("finalize 意图必须在 prepare 阶段固定，不能在提交时改变", {
        code: "REGISTRATION_INTENT_MISMATCH",
        httpStatus: 409,
      });
    }
    if (body.acknowledgedLocalDevelopmentSigner !== true) {
      throw apiError("提交本地交易前必须明确确认使用本地开发签名器", {
        code: "LOCAL_SIGNER_ACKNOWLEDGEMENT_REQUIRED",
        httpStatus: 400,
      });
    }
    if (
      typeof body.expectedContentHash !== "string"
      || body.expectedContentHash.toLowerCase() !== registration.contentHash.toLowerCase()
    ) {
      throw apiError("expectedContentHash 与已准备登记内容不一致", {
        code: "EXPECTED_CONTENT_HASH_MISMATCH",
        httpStatus: 409,
      });
    }
    if (
      registration.mode !== "local-development"
      || registration.chainId !== config.chainId
      || getAddress(registration.contractAddress) !== config.contractAddress
    ) {
      throw apiError("登记任务与当前本地链配置不一致", {
        code: "LOCAL_ONLY_OPERATION",
        httpStatus: 409,
      });
    }
    if (
      !registration.deploymentTransactionHash
      || registration.deploymentTransactionHash !== config.deploymentTransactionHash
    ) {
      throw apiError("本地链或合约已经重启，旧登记任务不能提交到新运行实例", {
        code: "LOCAL_RUNTIME_CHANGED",
        httpStatus: 409,
      });
    }
    if (registration.status === "verified") return registration;
    const confirmation = state.confirmations.find(
      (item) => item.confirmationId === registration.confirmationId,
    );
    assertFrozenConfirmationIntegrity(confirmation);
    if (
      confirmation.contentHash !== registration.contentHash
      || confirmation.canonicalManifest !== registration.canonicalManifest
    ) {
      throw apiError("登记任务与冻结确认记录不一致", {
        code: "REGISTRATION_CONFIRMATION_MISMATCH",
        httpStatus: 409,
      });
    }
    if (typeof this.candidateResolver !== "function") {
      throw apiError("AI 结果解析器未配置，不能重新核对最终图片", {
        code: "AI_RESULT_RESOLVER_NOT_CONFIGURED",
        httpStatus: 409,
      });
    }
    const currentCandidate = await this.candidateResolver({
      projectId: registration.projectId,
      versionId: registration.versionId,
      resultId: registration.resultId,
    });
    const currentImageEvidence = await readFinalImageEvidence(
      this.generatedDir,
      currentCandidate,
    );
    assertImageEvidenceMatchesManifest(currentImageEvidence, confirmation.manifest);

    if (!registration.transactionHash) {
      try {
        const transaction = await contract.registerVersion(
          registration.designId,
          registration.contentHash,
          registration.parentContentHash,
          registration.metadataUri,
        );
        const receipt = await transaction.wait();
        registration = await this.store.update((next) => {
          const target = next.registrations.find((item) => item.registrationId === registrationId);
          target.status = "submitted-local";
          target.transactionHash = transaction.hash;
          target.blockNumber = receipt.blockNumber;
          target.submittedAt = this.now().toISOString();
          target.localDevelopmentSigner = config.signer.address;
          target.error = null;
          return target;
        });
      } catch (error) {
        await this.store.update((next) => {
          const target = next.registrations.find((item) => item.registrationId === registrationId);
          target.status = "submission-failed";
          target.error = {
            code: "LOCAL_CONTRACT_TRANSACTION_FAILED",
            message: error.shortMessage || error.message || "本地登记交易失败",
          };
          return target;
        });
        throw apiError("DesignRegistry 本地登记交易失败", {
          code: "LOCAL_CONTRACT_TRANSACTION_FAILED",
          httpStatus: 409,
          details: { reason: error.shortMessage || null },
        });
      }
    }

    if (registration.finalizeRequested && !registration.finalizeTransactionHash) {
      try {
        const transaction = await contract.confirmVersion(
          registration.designId,
          registration.contentHash,
        );
        const receipt = await transaction.wait();
        registration = await this.store.update((next) => {
          const target = next.registrations.find((item) => item.registrationId === registrationId);
          target.status = "submitted-local";
          target.finalizeTransactionHash = transaction.hash;
          target.finalizeBlockNumber = receipt.blockNumber;
          target.finalizedAt = this.now().toISOString();
          target.error = null;
          return target;
        });
      } catch (error) {
        await this.store.update((next) => {
          const target = next.registrations.find((item) => item.registrationId === registrationId);
          target.status = "registration-succeeded-finalize-failed";
          target.error = {
            code: "LOCAL_FINALIZE_FAILED",
            message: error.shortMessage || error.message || "本地最终确认交易失败",
          };
          return target;
        });
        throw apiError("版本已登记，但本地最终确认交易失败", {
          code: "LOCAL_FINALIZE_FAILED",
          httpStatus: 409,
          details: { transactionHash: registration.transactionHash },
        });
      }
    }

    return registration;
  }

  async verifyRegistration(registrationIdValue, body = {}) {
    assertAllowedFields(body, VERIFY_ALLOWED_FIELDS);
    const registrationId = safeIdentifier(registrationIdValue, "registrationId");
    const config = await this.requireConnected();
    const state = await this.store.read();
    const registration = state.registrations.find((item) => item.registrationId === registrationId);
    if (!registration) {
      throw apiError("登记任务不存在", {
        code: "REGISTRATION_NOT_FOUND",
        httpStatus: 404,
      });
    }
    const confirmation = state.confirmations.find(
      (item) => item.confirmationId === registration.confirmationId,
    );
    assertFrozenConfirmationIntegrity(confirmation);
    if (
      confirmation.contentHash !== registration.contentHash
      || confirmation.canonicalManifest !== registration.canonicalManifest
    ) {
      throw apiError("登记任务与冻结确认记录不一致", {
        code: "REGISTRATION_CONFIRMATION_MISMATCH",
        httpStatus: 409,
      });
    }
    if (!registration.transactionHash) {
      throw apiError("登记任务尚未提交到本地链", {
        code: "REGISTRATION_NOT_SUBMITTED",
        httpStatus: 409,
      });
    }
    if (
      typeof body.expectedContentHash !== "string"
      || body.expectedContentHash.toLowerCase() !== registration.contentHash.toLowerCase()
    ) {
      throw apiError("expectedContentHash 与登记任务内容不一致", {
        code: "EXPECTED_CONTENT_HASH_MISMATCH",
        httpStatus: 409,
      });
    }
    if (
      !registration.deploymentTransactionHash
      || registration.deploymentTransactionHash !== config.deploymentTransactionHash
    ) {
      throw apiError("本地链或合约已经重启，旧登记证据不能在新运行实例中复用", {
        code: "LOCAL_RUNTIME_CHANGED",
        httpStatus: 409,
      });
    }

    const artifact = await this.getArtifact();
    const provider = new JsonRpcProvider(config.rpcUrl);
    const contract = new Contract(config.contractAddress, artifact.abi, provider);
    const mismatches = [];
    let onchain = null;
    try {
      onchain = serializedRecord(
        await contract.getVersion(registration.designId, registration.contentHash),
      );
      if (onchain.contentHash.toLowerCase() !== registration.contentHash.toLowerCase()) {
        mismatches.push("contentHash");
      }
      if (
        onchain.parentContentHash.toLowerCase()
        !== registration.parentContentHash.toLowerCase()
      ) {
        mismatches.push("parentContentHash");
      }
      if (onchain.metadataUri !== registration.metadataUri) mismatches.push("metadataUri");
      if (
        config.signer.address
        && onchain.registeredBy.toLowerCase() !== config.signer.address.toLowerCase()
      ) {
        mismatches.push("registeredBy");
      }
      if (registration.finalizeRequested && !onchain.finalized) mismatches.push("finalized");
      const receipt = await provider.getTransactionReceipt(registration.transactionHash);
      if (!receipt || receipt.status !== 1) mismatches.push("transactionReceipt");
    } catch {
      mismatches.push("versionReadback");
    }

    const verified = mismatches.length === 0;
    const verifiedAt = this.now().toISOString();
    const updated = await this.store.update((next) => {
      const target = next.registrations.find((item) => item.registrationId === registrationId);
      target.status = verified ? "verified" : "verification-failed";
      target.verifiedAt = verifiedAt;
      target.verification = {
        verified,
        mismatches,
        source: "local-development-evm",
        onchain,
      };
      return target;
    });

    return {
      registrationId,
      status: updated.status,
      verified,
      mismatches,
      source: "local-development-evm",
      onchain,
      transactionHash: updated.transactionHash,
      finalizeTransactionHash: updated.finalizeTransactionHash,
      verifiedAt,
    };
  }

  async getProjectTimeline(projectIdValue) {
    const projectId = safeIdentifier(projectIdValue, "projectId");
    const [state, config] = await Promise.all([this.store.read(), this.getConfig()]);
    const confirmations = state.confirmations
      .filter((item) => item.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    return {
      projectId,
      mode: "local-development",
      connected: config.connected,
      connectionStatus: config.status,
      items: confirmations.map((confirmation) => {
        const registration = state.registrations.find(
          (item) => item.confirmationId === confirmation.confirmationId,
        );
        const runtimeChanged = Boolean(
          registration
          && registration.deploymentTransactionHash !== config.deploymentTransactionHash,
        );
        const isFinal = Boolean(
          !runtimeChanged
          && registration?.verification?.verified
          && registration.verification.onchain?.finalized,
        );
        return {
          confirmationId: confirmation.confirmationId,
          versionId: confirmation.versionId,
          versionNumber: confirmation.versionNumber,
          parentVersionId: confirmation.parentVersionId,
          resultId: confirmation.manifest.resultId,
          requirementRevisionId: confirmation.manifest.requirementRevisionId,
          isFinal,
          status: runtimeChanged
            ? "stale-local-runtime"
            : registration?.status || confirmation.status,
          contentHash: confirmation.contentHash,
          parentContentHash: confirmation.parentContentHash,
          metadataUri: confirmation.manifest.metadataUri,
          imageSha256: confirmation.manifest.imageSha256,
          imageSizeBytes: confirmation.manifest.imageSizeBytes,
          imageMimeType: confirmation.manifest.imageMimeType,
          imageHashSource: confirmation.manifest.imageHashSource,
          manifestHashing: confirmation.manifestHashing,
          confirmedAt: confirmation.createdAt,
          transactionHash: registration?.transactionHash || null,
          finalizeTransactionHash: registration?.finalizeTransactionHash || null,
          blockNumber: registration?.blockNumber || null,
          contractAddress: registration?.contractAddress || null,
          registration: registration
            ? {
              registrationId: registration.registrationId,
              mode: registration.mode,
              chainId: registration.chainId,
              contractAddress: registration.contractAddress,
              deploymentTransactionHash: registration.deploymentTransactionHash || null,
              transactionHash: registration.transactionHash,
              finalizeTransactionHash: registration.finalizeTransactionHash,
              blockNumber: registration.blockNumber,
              finalizeRequested: registration.finalizeRequested,
              verifiedAt: registration.verifiedAt || null,
              verification: registration.verification || null,
              error: runtimeChanged
                ? {
                  code: "LOCAL_RUNTIME_CHANGED",
                  message: "本地链或合约已重启，旧交易证据只作为历史状态保留",
                }
                : registration.error || null,
            }
            : null,
        };
      }),
    };
  }
}
