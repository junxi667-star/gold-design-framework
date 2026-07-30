import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroHash,
  getAddress,
  keccak256,
} from "ethers";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..");

const DEFAULT_DEPLOYMENT_MANIFEST_PATH = path.join(
  projectRoot,
  "contracts",
  "deployments",
  "monad-testnet-10143.json",
);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function loadDeploymentManifest(filePath = DEFAULT_DEPLOYMENT_MANIFEST_PATH) {
  const manifest = JSON.parse(readFileSync(filePath, "utf8"));
  const runtimeCode = manifest?.deployment?.runtimeCode;
  if (
    manifest?.schemaVersion !== "design-registry-deployment/v1"
    || manifest?.network?.chainId !== 10143
    || !/^0x[a-f0-9]{40}$/i.test(manifest?.deployment?.contractAddress || "")
    || !/^0x[a-f0-9]{64}$/i.test(manifest?.deployment?.transactionHash || "")
    || !Number.isSafeInteger(runtimeCode?.sizeBytes)
    || !/^0x[a-f0-9]{64}$/i.test(runtimeCode?.keccak256 || "")
    || !/^[a-f0-9]{64}$/i.test(runtimeCode?.sha256 || "")
    || !Array.isArray(manifest?.publicEvidence?.transactions)
    || !Array.isArray(manifest?.readAbi)
  ) {
    throw new Error("Monad Testnet deployment manifest is missing required frozen identity fields");
  }
  return deepFreeze(manifest);
}

export const MONAD_TESTNET_DEPLOYMENT_MANIFEST = loadDeploymentManifest();

function publicEvidenceFromManifest(manifest) {
  return deepFreeze({
    schemaVersion: "monad-testnet-public-evidence/v1",
    chainName: manifest.network.chainName,
    chainId: manifest.network.chainId,
    rpcUrl: manifest.network.rpcUrl,
    explorerBaseUrl: manifest.network.explorerBaseUrl,
    contractAddress: manifest.deployment.contractAddress,
    accountAddress: manifest.publicEvidence.accountAddress,
    designId: manifest.publicEvidence.designId,
    v1ContentHash: manifest.publicEvidence.v1ContentHash,
    v2ContentHash: manifest.publicEvidence.v2ContentHash,
    deployedCodeSizeBytes: manifest.deployment.runtimeCode.sizeBytes,
    deployedCodeKeccak256: manifest.deployment.runtimeCode.keccak256,
    deployedCodeSha256: manifest.deployment.runtimeCode.sha256,
    deploymentManifestSchemaVersion: manifest.schemaVersion,
    readAbi: manifest.readAbi,
    transactions: manifest.publicEvidence.transactions,
  });
}

export const MONAD_TESTNET_PUBLIC_EVIDENCE = publicEvidenceFromManifest(
  MONAD_TESTNET_DEPLOYMENT_MANIFEST,
);
const DEFAULT_RUN_EVIDENCE_PATH = path.join(
  projectRoot,
  ".codex-artifacts",
  "monad-testnet",
  "last-run.json",
);
const DEFAULT_VERIFICATION_EVIDENCE_PATH = path.join(
  projectRoot,
  ".codex-artifacts",
  "monad-testnet",
  "last-verification.json",
);
const BOUNDARY =
  "只读证据仅证明当前或已明确标记的历史 Monad Testnet 状态；测试网可能重置，且不证明主网、真实 AI、版权、原创、身份或生产安全。";

function evidenceError(code, message, {
  httpStatus = 502,
  retryable = false,
  details = null,
} = {}) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  error.retryable = retryable;
  error.details = details;
  return error;
}

function lower(value) {
  return String(value || "").toLowerCase();
}

function asNumber(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw evidenceError(
      "MONAD_TESTNET_EVIDENCE_CONFLICT",
      `Monad Testnet ${field} 无法安全转换为数字`,
    );
  }
  return normalized;
}

function asDecimal(value) {
  return BigInt(value).toString();
}

function sameAddress(left, right) {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}
function sameHash(left, right) {
  return /^0x[a-f0-9]{64}$/i.test(String(left || ""))
    && lower(left) === lower(right);
}

function explorerUrl(segment, value) {
  return `${MONAD_TESTNET_PUBLIC_EVIDENCE.explorerBaseUrl}/${segment}/${value}`;
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(evidenceError(
          "MONAD_TESTNET_RPC_UNAVAILABLE",
          `Monad Testnet 只读 RPC ${label} 超时`,
          { httpStatus: 503, retryable: true },
        ));
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function serializeVersion(record, {
  label,
  parentLabel,
  transactionHash,
}) {
  return {
    label,
    parentLabel,
    versionNumber: asNumber(record.versionNumber, `${label}.versionNumber`),
    contentHash: record.contentHash,
    parentContentHash: record.parentContentHash,
    metadataUri: record.metadataUri,
    registeredBy: record.registeredBy,
    registeredAt: asNumber(record.registeredAt, `${label}.registeredAt`),
    exists: Boolean(record.exists),
    finalized: Boolean(record.finalized),
    transactionHash,
  };
}

function successChecks(eventCounts) {
  const checks = {
    network: true,
    contractCode: true,
    receipts: true,
    zeroValue: true,
    events: true,
    parentRelationship: true,
    finalVersion: true,
    latestVersion: true,
    eventCounts,
  };
  return { ...checks, allChecksPass: true };
}

function validateReceiptAndTransaction(expected, receipt, transaction, evidence) {
  if (!receipt || receipt.status !== 1) {
    throw evidenceError(
      "MONAD_TESTNET_EVIDENCE_CONFLICT",
      `${expected.displayName} 的公开交易回执缺失或失败`,
    );
  }
  if (!transaction || lower(transaction.hash) !== lower(expected.transactionHash)) {
    throw evidenceError(
      "MONAD_TESTNET_EVIDENCE_CONFLICT",
      `${expected.displayName} 的公开交易内容缺失`,
    );
  }
  if (asDecimal(transaction.value) !== "0") {
    throw evidenceError(
      "MONAD_TESTNET_EVIDENCE_CONFLICT",
      `${expected.displayName} 携带了非零 value`,
    );
  }
  if (!sameAddress(transaction.from, evidence.accountAddress)) {
    throw evidenceError(
      "MONAD_TESTNET_EVIDENCE_CONFLICT",
      `${expected.displayName} 的发送地址不匹配`,
    );
  }
  if (
    expected.kind === "DEPLOYMENT"
      ? transaction.to !== null
      : !sameAddress(transaction.to, evidence.contractAddress)
  ) {
    throw evidenceError(
      "MONAD_TESTNET_EVIDENCE_CONFLICT",
      `${expected.displayName} 的目标地址不匹配`,
    );
  }
  if (receipt.blockNumber !== expected.blockNumber) {
    throw evidenceError(
      "MONAD_TESTNET_EVIDENCE_CONFLICT",
      `${expected.displayName} 的区块号与冻结证据不匹配`,
    );
  }
  return {
    kind: expected.kind,
    displayName: expected.displayName,
    eventName: expected.eventName,
    logCount: receipt.logs.length,
    transactionHash: expected.transactionHash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    gasUsed: asDecimal(receipt.gasUsed),
    valueWei: asDecimal(transaction.value),
    from: transaction.from,
    to: transaction.to,
    explorerUrl: explorerUrl("tx", expected.transactionHash),
  };
}

function validateEvents(receipts, contractInterface, evidence) {
  const parsed = [];
  for (const receipt of receipts) {
    for (const log of receipt.logs) {
      if (!sameAddress(log.address, evidence.contractAddress)) continue;
      try {
        const event = contractInterface.parseLog(log);
        if (event) parsed.push(event);
      } catch {
        throw evidenceError(
          "MONAD_TESTNET_EVIDENCE_CONFLICT",
          "DesignRegistry 交易包含无法按冻结 ABI 解析的日志",
        );
      }
    }
  }
  const registered = parsed.filter((event) => event.name === "VersionRegistered");
  const finalized = parsed.filter((event) => event.name === "VersionFinalized");
  if (registered.length !== 2 || finalized.length !== 1) {
    throw evidenceError(
      "MONAD_TESTNET_EVIDENCE_CONFLICT",
      "VersionRegistered/VersionFinalized 事件数量不匹配",
    );
  }
  const [v1, v2] = registered;
  const finalEvent = finalized[0];
  if (
    !sameHash(v1.args.designId, evidence.designId)
    || !sameHash(v1.args.contentHash, evidence.v1ContentHash)
    || !sameHash(v1.args.parentContentHash, ZeroHash)
    || asNumber(v1.args.versionNumber, "V1 event versionNumber") !== 1
    || !sameHash(v2.args.designId, evidence.designId)
    || !sameHash(v2.args.contentHash, evidence.v2ContentHash)
    || !sameHash(v2.args.parentContentHash, evidence.v1ContentHash)
    || asNumber(v2.args.versionNumber, "V2 event versionNumber") !== 2
    || !sameHash(finalEvent.args.designId, evidence.designId)
    || !sameHash(finalEvent.args.contentHash, evidence.v2ContentHash)
    || asNumber(finalEvent.args.versionNumber, "final event versionNumber") !== 2
  ) {
    throw evidenceError(
      "MONAD_TESTNET_EVIDENCE_CONFLICT",
      "链上事件中的版本哈希或父版本关系与冻结证据不匹配",
    );
  }
  return {
    VersionRegistered: registered.length,
    VersionFinalized: finalized.length,
  };
}

function validateVersions(v1, v2, finalRecord, latestRecord, finalHash, versionCount, evidence) {
  if (
    !sameHash(v1.contentHash, evidence.v1ContentHash)
    || !sameHash(v1.parentContentHash, ZeroHash)
    || asNumber(v1.versionNumber, "V1 versionNumber") !== 1
    || !v1.exists
    || v1.finalized
    || !sameHash(v2.contentHash, evidence.v2ContentHash)
    || !sameHash(v2.parentContentHash, evidence.v1ContentHash)
    || asNumber(v2.versionNumber, "V2 versionNumber") !== 2
    || !v2.exists
    || !v2.finalized
    || !sameHash(finalRecord.contentHash, evidence.v2ContentHash)
    || !finalRecord.finalized
    || !sameHash(latestRecord.contentHash, evidence.v2ContentHash)
    || !sameHash(finalHash, evidence.v2ContentHash)
    || asNumber(versionCount, "versionCount") !== 2
  ) {
    throw evidenceError(
      "MONAD_TESTNET_EVIDENCE_CONFLICT",
      "链上 V1/V2/parent/final/latest 状态与冻结证据不匹配",
    );
  }
}

function cachedSnapshotFromFiles(run, verification, nowIso, expected) {
  if (!run || !verification || verification.verified !== true) return null;
  const vector = run.syntheticTestVector;
  const receiptMap = new Map(
    (verification.transactionReceipts || []).map((item) => [lower(item.hash), item]),
  );
  const decodedEvents = verification.decodedEvents || [];
  const cacheMatches = (
    run.network?.chainId === expected.chainId
    && sameAddress(run.deployment?.contractAddress, expected.contractAddress)
    && sameHash(vector?.designId, expected.designId)
    && sameHash(vector?.v1?.contentHash, expected.v1ContentHash)
    && sameHash(vector?.v1?.parentContentHash, ZeroHash)
    && sameHash(vector?.v2?.contentHash, expected.v2ContentHash)
    && sameHash(vector?.v2?.parentContentHash, expected.v1ContentHash)
    && sameHash(run.readback?.finalContentHash, expected.v2ContentHash)
    && run.readback?.finalized === true
    && expected.transactions.every((item) => {
      const receipt = receiptMap.get(lower(item.transactionHash));
      return receipt?.status === 1 && receipt.blockNumber === item.blockNumber;
    })
    && decodedEvents.filter((name) => name === "VersionRegistered").length === 2
    && decodedEvents.filter((name) => name === "VersionFinalized").length === 1
    && verification.parentRelationshipVerified === true
    && verification.finalVersionVerified === true
  );
  if (!cacheMatches) return null;

  const transactions = expected.transactions.map((item) => ({
    ...item,
    status: 1,
    from: expected.accountAddress,
    to: item.kind === "DEPLOYMENT" ? null : expected.contractAddress,
    explorerUrl: explorerUrl("tx", item.transactionHash),
  }));
  const versions = [
    {
      label: "V1",
      parentLabel: null,
      versionNumber: 1,
      contentHash: expected.v1ContentHash,
      parentContentHash: ZeroHash,
      metadataUri: vector.v1.metadataUri,
      registeredBy: expected.accountAddress,
      registeredAt: null,
      exists: true,
      finalized: false,
      transactionHash: expected.transactions[1].transactionHash,
    },
    {
      label: "V2",
      parentLabel: "V1",
      versionNumber: 2,
      contentHash: expected.v2ContentHash,
      parentContentHash: expected.v1ContentHash,
      metadataUri: vector.v2.metadataUri,
      registeredBy: expected.accountAddress,
      registeredAt: null,
      exists: true,
      finalized: true,
      transactionHash: expected.transactions[2].transactionHash,
    },
  ];
  const lastSuccessfulAt = verification.verifiedAt || run.completedAt;
  return {
    schemaVersion: expected.schemaVersion,
    mode: "monad-testnet-readonly",
    evidenceStatus: "cached",
    source: "cached-public-evidence",
    observedAt: nowIso,
    lastSuccessfulAt,
    stale: true,
    explorerBaseUrl: expected.explorerBaseUrl,
    block: {
      number: verification.verifiedAtBlock ?? null,
      timestamp: null,
    },
    network: {
      chainName: expected.chainName,
      chainId: expected.chainId,
      rpcUrl: expected.rpcUrl,
      readOnly: true,
    },
    contract: {
      address: expected.contractAddress,
      codeStatus: "PRESENT_AT_LAST_VERIFICATION",
      codeSizeBytes: expected.deployedCodeSizeBytes,
      codeKeccak256: expected.deployedCodeKeccak256,
      codeSha256: expected.deployedCodeSha256,
      explorerUrl: explorerUrl("address", expected.contractAddress),
      deploymentTransactionHash: expected.transactions[0].transactionHash,
    },
    account: { address: expected.accountAddress },
    transactions,
    versions,
    final: {
      contentHash: expected.v2ContentHash,
      versionNumber: 2,
      finalized: true,
      transactionHash: expected.transactions[3].transactionHash,
    },
    latest: {
      contentHash: expected.v2ContentHash,
      versionNumber: 2,
      finalized: true,
    },
    versionCount: 2,
    checks: successChecks({
      VersionRegistered: 2,
      VersionFinalized: 1,
    }),
    boundary: BOUNDARY,
    error: null,
  };
}

export class MonadTestnetReadService {
  constructor({
    provider = null,
    publicEvidence = MONAD_TESTNET_PUBLIC_EVIDENCE,
    runEvidencePath = DEFAULT_RUN_EVIDENCE_PATH,
    verificationEvidencePath = DEFAULT_VERIFICATION_EVIDENCE_PATH,
    artifactLoader = null,
    cacheLoader = null,
    contractFactory = null,
    now = () => new Date(),
    timeoutMs = 7000,
  } = {}) {
    this.expected = publicEvidence;
    this.provider = provider || new JsonRpcProvider(this.expected.rpcUrl);
    this.runEvidencePath = runEvidencePath;
    this.verificationEvidencePath = verificationEvidencePath;
    this.artifactLoader = artifactLoader || (async () => ({ abi: this.expected.readAbi }));
    this.cacheLoader = cacheLoader || (async () => ({
      run: await readOptionalJson(this.runEvidencePath),
      verification: await readOptionalJson(this.verificationEvidencePath),
    }));
    this.contractFactory = contractFactory
      || ((address, abi, runner) => new Contract(address, abi, runner));
    this.now = now;
    this.timeoutMs = timeoutMs;
  }

  async rpc(label, operation) {
    try {
      return await withTimeout(Promise.resolve().then(operation), this.timeoutMs, label);
    } catch (error) {
      if (error.code === "MONAD_TESTNET_RPC_UNAVAILABLE") throw error;
      throw evidenceError(
        "MONAD_TESTNET_RPC_UNAVAILABLE",
        `Monad Testnet 只读 RPC ${label} 不可用`,
        {
          httpStatus: 503,
          retryable: true,
          details: { label },
        },
      );
    }
  }

  async loadCachedEvidence(nowIso) {
    try {
      const { run, verification } = await this.cacheLoader();
      return cachedSnapshotFromFiles(run, verification, nowIso, this.expected);
    } catch {
      return null;
    }
  }

  async readLiveEvidence(nowIso) {
    const expected = this.expected;
    const rawChainId = await this.rpc(
      "eth_chainId",
      () => this.provider.send("eth_chainId", []),
    );
    if (BigInt(rawChainId) !== BigInt(expected.chainId)) {
      throw evidenceError(
        "MONAD_TESTNET_EVIDENCE_CONFLICT",
        `公开 RPC chainId 冲突：期望 ${expected.chainId}`,
      );
    }

    const artifact = await this.artifactLoader();
    if (!Array.isArray(artifact?.abi)) {
      throw evidenceError(
        "MONAD_TESTNET_EVIDENCE_CONFLICT",
        "DesignRegistry ABI 缺失或格式无效",
      );
    }
    const contractInterface = new Interface(artifact.abi);
    const contract = this.contractFactory(expected.contractAddress, artifact.abi, this.provider);
    const [blockNumber, code, receiptPairs, v1, v2, finalRecord, latestRecord, finalHash, count] =
      await Promise.all([
        this.rpc("eth_blockNumber", () => this.provider.getBlockNumber()),
        this.rpc("eth_getCode", () => this.provider.getCode(expected.contractAddress)),
        Promise.all(expected.transactions.map(async (item) => {
          const [receipt, transaction] = await Promise.all([
            this.rpc(
              `${item.kind}.receipt`,
              () => this.provider.getTransactionReceipt(item.transactionHash),
            ),
            this.rpc(
              `${item.kind}.transaction`,
              () => this.provider.getTransaction(item.transactionHash),
            ),
          ]);
          return { item, receipt, transaction };
        })),
        this.rpc("getVersion(V1)", () =>
          contract.getVersion(expected.designId, expected.v1ContentHash)),
        this.rpc("getVersion(V2)", () =>
          contract.getVersion(expected.designId, expected.v2ContentHash)),
        this.rpc("getFinal", () => contract.getFinal(expected.designId)),
        this.rpc("getLatest", () => contract.getLatest(expected.designId)),
        this.rpc("finalContentHash", () => contract.finalContentHash(expected.designId)),
        this.rpc("versionCount", () => contract.versionCount(expected.designId)),
      ]);

    if (!code || code === "0x") {
      throw evidenceError(
        "MONAD_TESTNET_EVIDENCE_CONFLICT",
        "冻结的 DesignRegistry 地址没有合约代码",
      );
    }
    const codeBytes = Buffer.from(code.slice(2), "hex");
    const codeSha256 = createHash("sha256").update(codeBytes).digest("hex");
    const codeKeccak256 = keccak256(code);
    if (
      codeBytes.length !== expected.deployedCodeSizeBytes
      || lower(codeKeccak256) !== lower(expected.deployedCodeKeccak256)
      || codeSha256 !== expected.deployedCodeSha256
    ) {
      throw evidenceError(
        "MONAD_TESTNET_EVIDENCE_CONFLICT",
        "DesignRegistry 链上代码与冻结候选不匹配",
      );
    }

    const receipts = receiptPairs.map(({ item, receipt, transaction }) =>
      validateReceiptAndTransaction(item, receipt, transaction, expected));
    for (let index = 0; index < receipts.length; index += 1) {
      if (receipts[index].logCount !== expected.transactions[index].logCount) {
        throw evidenceError(
          "MONAD_TESTNET_EVIDENCE_CONFLICT",
          `${expected.transactions[index].displayName} 的日志数量不匹配`,
        );
      }
    }
    const eventCounts = validateEvents(
      receiptPairs.map(({ receipt }) => receipt),
      contractInterface,
      expected,
    );
    validateVersions(v1, v2, finalRecord, latestRecord, finalHash, count, expected);

    const block = await this.rpc(
      "eth_getBlockByNumber",
      () => this.provider.getBlock(blockNumber),
    );
    const blockTimestamp = block?.timestamp === undefined
      ? null
      : new Date(asNumber(block.timestamp, "block.timestamp") * 1000).toISOString();
    const versions = [
      serializeVersion(v1, {
        label: "V1",
        parentLabel: null,
        transactionHash: expected.transactions[1].transactionHash,
      }),
      serializeVersion(v2, {
        label: "V2",
        parentLabel: "V1",
        transactionHash: expected.transactions[2].transactionHash,
      }),
    ];
    return {
      schemaVersion: expected.schemaVersion,
      mode: "monad-testnet-readonly",
      evidenceStatus: "live",
      source: "live-public-rpc",
      observedAt: nowIso,
      lastSuccessfulAt: nowIso,
      stale: false,
      explorerBaseUrl: expected.explorerBaseUrl,
      block: {
        number: asNumber(blockNumber, "block.number"),
        timestamp: blockTimestamp,
      },
      network: {
        chainName: expected.chainName,
        chainId: expected.chainId,
        rpcUrl: expected.rpcUrl,
        readOnly: true,
      },
      contract: {
        address: expected.contractAddress,
        codeStatus: "PRESENT",
        codeSizeBytes: codeBytes.length,
        codeKeccak256,
        codeSha256,
        explorerUrl: explorerUrl("address", expected.contractAddress),
        deploymentTransactionHash: expected.transactions[0].transactionHash,
      },
      account: { address: expected.accountAddress },
      transactions: receipts,
      versions,
      final: {
        contentHash: finalRecord.contentHash,
        versionNumber: asNumber(finalRecord.versionNumber, "final.versionNumber"),
        finalized: Boolean(finalRecord.finalized),
        transactionHash: expected.transactions[3].transactionHash,
      },
      latest: {
        contentHash: latestRecord.contentHash,
        versionNumber: asNumber(latestRecord.versionNumber, "latest.versionNumber"),
        finalized: Boolean(latestRecord.finalized),
      },
      versionCount: asNumber(count, "versionCount"),
      checks: successChecks(eventCounts),
      boundary: BOUNDARY,
      error: null,
    };
  }

  async getEvidence() {
    const nowIso = this.now().toISOString();
    const cached = await this.loadCachedEvidence(nowIso);
    try {
      return await this.readLiveEvidence(nowIso);
    } catch (error) {
      if (error.code === "MONAD_TESTNET_RPC_UNAVAILABLE" && cached) return cached;
      if (error.code === "MONAD_TESTNET_RPC_UNAVAILABLE") {
        throw evidenceError(
          "MONAD_TESTNET_EVIDENCE_UNAVAILABLE",
          "Monad Testnet 公开 RPC 不可用，且没有通过独立验证的缓存证据",
          {
            httpStatus: 503,
            retryable: true,
            details: {
              schemaVersion: this.expected.schemaVersion,
              mode: "monad-testnet-readonly",
              evidenceStatus: "error",
              source: "none",
              observedAt: nowIso,
            },
          },
        );
      }
      throw error;
    }
  }
}
