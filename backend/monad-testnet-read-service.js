import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroHash,
  getAddress,
} from "ethers";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..");

export const MONAD_TESTNET_PUBLIC_EVIDENCE = Object.freeze({
  schemaVersion: "monad-testnet-public-evidence/v1",
  chainName: "Monad Testnet",
  chainId: 10143,
  rpcUrl: "https://testnet-rpc.monad.xyz",
  explorerBaseUrl: "https://testnet.monadscan.com",
  contractAddress: "0x017BA6A7b6d90387bc588ad6FccDf2e0FD16D8b7",
  accountAddress: "0xC342f009A74Ba7bE34cad215B550AfAAF8ab4982",
  designId: "0x38e7d79e7090c3a7a1122dae18d636f22d9c587af5a9eb8013ec64bc737bf2e2",
  v1ContentHash: "0xe08aa6723a87229f955a2ea24ed13a58c6d95c86689f9f278d8150d80227a395",
  v2ContentHash: "0x6f5448e82aab5932b09d2ddf6b93265370956fa8c79848f15d6d77739c2d0713",
  deployedCodeSizeBytes: 3507,
  deployedCodeSha256: "0d93b66d10dec3414aaaebc85e245b1aff15b70f5a046c0df1277a3de5731b00",
  transactions: Object.freeze([
    Object.freeze({
      kind: "DEPLOYMENT",
      displayName: "部署 DesignRegistry",
      eventName: null,
      transactionHash: "0x71866654b70a6c90f7ac5c9f8af0e5b6971b5ba846e5742ee1a954aa0e6d1ae5",
      blockNumber: 49053468,
      gasUsed: "992592",
      valueWei: "0",
      logCount: 0,
    }),
    Object.freeze({
      kind: "VERSION_V1",
      displayName: "登记 V1",
      eventName: "VersionRegistered",
      transactionHash: "0xd3ac8f3b70239acb634ec5e2b71c4c6ac6b2fb21a5a9189dfd578128a21fe039",
      blockNumber: 49053487,
      gasUsed: "443419",
      valueWei: "0",
      logCount: 1,
    }),
    Object.freeze({
      kind: "VERSION_V2",
      displayName: "登记 V2",
      eventName: "VersionRegistered",
      transactionHash: "0xaa2335aa88e72496b818cb5264cff86f03010328b640fa0b831d0659bba848fa",
      blockNumber: 49053499,
      gasUsed: "412408",
      valueWei: "0",
      logCount: 1,
    }),
    Object.freeze({
      kind: "FINALIZATION",
      displayName: "最终确认 V2",
      eventName: "VersionFinalized",
      transactionHash: "0x94ff4ef17408452566652e5ec90b20253c3898885478385a04b1cbe12c5e98fc",
      blockNumber: 49053515,
      gasUsed: "97974",
      valueWei: "0",
      logCount: 1,
    }),
  ]),
});

const DEFAULT_ARTIFACT_PATH = path.join(
  projectRoot,
  "contracts",
  "artifacts",
  "DesignRegistry.json",
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

function validateReceiptAndTransaction(expected, receipt, transaction) {
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
  if (!sameAddress(transaction.from, MONAD_TESTNET_PUBLIC_EVIDENCE.accountAddress)) {
    throw evidenceError(
      "MONAD_TESTNET_EVIDENCE_CONFLICT",
      `${expected.displayName} 的发送地址不匹配`,
    );
  }
  if (
    expected.kind === "DEPLOYMENT"
      ? transaction.to !== null
      : !sameAddress(transaction.to, MONAD_TESTNET_PUBLIC_EVIDENCE.contractAddress)
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

function validateEvents(receipts, contractInterface) {
  const parsed = [];
  for (const receipt of receipts) {
    for (const log of receipt.logs) {
      if (!sameAddress(log.address, MONAD_TESTNET_PUBLIC_EVIDENCE.contractAddress)) continue;
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
    !sameHash(v1.args.designId, MONAD_TESTNET_PUBLIC_EVIDENCE.designId)
    || !sameHash(v1.args.contentHash, MONAD_TESTNET_PUBLIC_EVIDENCE.v1ContentHash)
    || !sameHash(v1.args.parentContentHash, ZeroHash)
    || asNumber(v1.args.versionNumber, "V1 event versionNumber") !== 1
    || !sameHash(v2.args.designId, MONAD_TESTNET_PUBLIC_EVIDENCE.designId)
    || !sameHash(v2.args.contentHash, MONAD_TESTNET_PUBLIC_EVIDENCE.v2ContentHash)
    || !sameHash(v2.args.parentContentHash, MONAD_TESTNET_PUBLIC_EVIDENCE.v1ContentHash)
    || asNumber(v2.args.versionNumber, "V2 event versionNumber") !== 2
    || !sameHash(finalEvent.args.designId, MONAD_TESTNET_PUBLIC_EVIDENCE.designId)
    || !sameHash(finalEvent.args.contentHash, MONAD_TESTNET_PUBLIC_EVIDENCE.v2ContentHash)
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

function validateVersions(v1, v2, finalRecord, latestRecord, finalHash, versionCount) {
  if (
    !sameHash(v1.contentHash, MONAD_TESTNET_PUBLIC_EVIDENCE.v1ContentHash)
    || !sameHash(v1.parentContentHash, ZeroHash)
    || asNumber(v1.versionNumber, "V1 versionNumber") !== 1
    || !v1.exists
    || v1.finalized
    || !sameHash(v2.contentHash, MONAD_TESTNET_PUBLIC_EVIDENCE.v2ContentHash)
    || !sameHash(v2.parentContentHash, MONAD_TESTNET_PUBLIC_EVIDENCE.v1ContentHash)
    || asNumber(v2.versionNumber, "V2 versionNumber") !== 2
    || !v2.exists
    || !v2.finalized
    || !sameHash(finalRecord.contentHash, MONAD_TESTNET_PUBLIC_EVIDENCE.v2ContentHash)
    || !finalRecord.finalized
    || !sameHash(latestRecord.contentHash, MONAD_TESTNET_PUBLIC_EVIDENCE.v2ContentHash)
    || !sameHash(finalHash, MONAD_TESTNET_PUBLIC_EVIDENCE.v2ContentHash)
    || asNumber(versionCount, "versionCount") !== 2
  ) {
    throw evidenceError(
      "MONAD_TESTNET_EVIDENCE_CONFLICT",
      "链上 V1/V2/parent/final/latest 状态与冻结证据不匹配",
    );
  }
}

function cachedSnapshotFromFiles(run, verification, nowIso) {
  if (!run || !verification || verification.verified !== true) return null;
  const expected = MONAD_TESTNET_PUBLIC_EVIDENCE;
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
    artifactPath = DEFAULT_ARTIFACT_PATH,
    runEvidencePath = DEFAULT_RUN_EVIDENCE_PATH,
    verificationEvidencePath = DEFAULT_VERIFICATION_EVIDENCE_PATH,
    artifactLoader = null,
    cacheLoader = null,
    contractFactory = null,
    now = () => new Date(),
    timeoutMs = 7000,
  } = {}) {
    this.provider = provider || new JsonRpcProvider(MONAD_TESTNET_PUBLIC_EVIDENCE.rpcUrl);
    this.artifactPath = artifactPath;
    this.runEvidencePath = runEvidencePath;
    this.verificationEvidencePath = verificationEvidencePath;
    this.artifactLoader = artifactLoader || (async () =>
      JSON.parse(await readFile(this.artifactPath, "utf8")));
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
      return cachedSnapshotFromFiles(run, verification, nowIso);
    } catch {
      return null;
    }
  }

  async readLiveEvidence(nowIso) {
    const expected = MONAD_TESTNET_PUBLIC_EVIDENCE;
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
    if (
      codeBytes.length !== expected.deployedCodeSizeBytes
      || codeSha256 !== expected.deployedCodeSha256
    ) {
      throw evidenceError(
        "MONAD_TESTNET_EVIDENCE_CONFLICT",
        "DesignRegistry 链上代码与冻结候选不匹配",
      );
    }

    const receipts = receiptPairs.map(({ item, receipt, transaction }) =>
      validateReceiptAndTransaction(item, receipt, transaction));
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
    );
    validateVersions(v1, v2, finalRecord, latestRecord, finalHash, count);

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
              schemaVersion: MONAD_TESTNET_PUBLIC_EVIDENCE.schemaVersion,
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
