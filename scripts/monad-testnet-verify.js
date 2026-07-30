import { Contract, Interface } from "ethers";

import { compileDesignRegistry } from "./web3-contract.js";
import {
  MONAD_TESTNET_CHAIN_ID,
  assertLiveMonadTestnet,
  assertNoSecretEnvironment,
  createMonadTestnetProvider,
  runtimeEvidencePath,
  verificationEvidencePath,
  writeJsonEvidence,
} from "./monad-testnet-common.js";
import { readFile } from "node:fs/promises";

assertNoSecretEnvironment();

const evidence = JSON.parse(await readFile(runtimeEvidencePath, "utf8"));
if (BigInt(evidence.network?.chainId) !== MONAD_TESTNET_CHAIN_ID) {
  throw new Error("证据文件 chainId 不是 Monad Testnet 10143");
}
const provider = createMonadTestnetProvider();
const network = await assertLiveMonadTestnet(provider);
const artifact = await compileDesignRegistry();
const contractInterface = new Interface(artifact.abi);
const contractAddress = evidence.deployment.contractAddress;
const contract = new Contract(contractAddress, artifact.abi, provider);
const vector = evidence.syntheticTestVector;

const code = await provider.getCode(contractAddress);
if (!code || code === "0x") throw new Error("链上合约代码不存在");

const hashes = [
  evidence.deployment.transactionHash,
  vector.v1.transactionHash,
  vector.v2.transactionHash,
  vector.finalization.transactionHash,
];
const receipts = await Promise.all(hashes.map((hash) => provider.getTransactionReceipt(hash)));
if (receipts.some((receipt) => !receipt || receipt.status !== 1)) {
  throw new Error("至少一笔测试网交易回执失败或缺失");
}

const decodedEvents = receipts.slice(1).flatMap((receipt) =>
  receipt.logs.flatMap((log) => {
    try {
      const parsed = contractInterface.parseLog(log);
      return parsed ? [parsed.name] : [];
    } catch {
      return [];
    }
  }),
);
if (
  decodedEvents.filter((name) => name === "VersionRegistered").length !== 2
  || decodedEvents.filter((name) => name === "VersionFinalized").length !== 1
) {
  throw new Error("VersionRegistered/VersionFinalized 事件数量不符合预期");
}

const [v1, v2, finalRecord, finalHash] = await Promise.all([
  contract.getVersion(vector.designId, vector.v1.contentHash),
  contract.getVersion(vector.designId, vector.v2.contentHash),
  contract.getFinal(vector.designId),
  contract.finalContentHash(vector.designId),
]);
const mismatches = [];
if (v1.parentContentHash.toLowerCase() !== vector.v1.parentContentHash.toLowerCase()) {
  mismatches.push("v1.parentContentHash");
}
if (v2.parentContentHash.toLowerCase() !== vector.v2.parentContentHash.toLowerCase()) {
  mismatches.push("v2.parentContentHash");
}
if (finalRecord.contentHash.toLowerCase() !== vector.v2.contentHash.toLowerCase()) {
  mismatches.push("final.contentHash");
}
if (finalHash.toLowerCase() !== vector.v2.contentHash.toLowerCase()) {
  mismatches.push("finalContentHash");
}
if (!finalRecord.finalized) mismatches.push("final.finalized");
if (mismatches.length) throw new Error(`链上回读不一致：${mismatches.join(", ")}`);

const verification = {
  schemaVersion: "monad-testnet-design-registry-verification/v1",
  verified: true,
  chainId: Number(network.chainId),
  verifiedAtBlock: network.blockNumber,
  contractAddress,
  transactionReceipts: receipts.map((receipt) => ({
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  })),
  decodedEvents,
  parentRelationshipVerified: true,
  finalVersionVerified: true,
  verifiedAt: new Date().toISOString(),
  evidenceBoundary:
    "公开 RPC 独立回读只证明当前 Monad Testnet 状态；测试网可重置且不构成版权或主网上线证明。",
};
await writeJsonEvidence(verificationEvidencePath, verification);
console.log(JSON.stringify(verification, null, 2));
