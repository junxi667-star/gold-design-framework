import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  Contract,
  ContractFactory,
  Interface,
  ZeroHash,
  id,
} from "ethers";

import { compileDesignRegistry, contractSourcePath } from "./web3-contract.js";
import {
  MONAD_TESTNET_CHAIN_ID,
  MONAD_TESTNET_EXPLORER_URL,
  MONAD_TESTNET_RPC_URL,
  assertLiveMonadTestnet,
  assertNoSecretEnvironment,
  assertWriteExecutionAuthorized,
  createMonadTestnetProvider,
  loadEncryptedTestnetWallet,
  prepareSafeContractCall,
  prepareSafeDeployment,
  runtimeEvidencePath,
  signBroadcastAndWait,
  writeJsonEvidence,
} from "./monad-testnet-common.js";

assertNoSecretEnvironment();
assertWriteExecutionAuthorized();

const provider = createMonadTestnetProvider();
const network = await assertLiveMonadTestnet(provider);
const loaded = await loadEncryptedTestnetWallet();
const wallet = loaded.wallet.connect(provider);
const artifact = await compileDesignRegistry();
const contractInterface = new Interface(artifact.abi);
const source = await readFile(contractSourcePath, "utf8");
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const bytecodeSha256 = createHash("sha256")
  .update(Buffer.from(artifact.bytecode.slice(2), "hex"))
  .digest("hex");

const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
const deploymentPrepared = await prepareSafeDeployment({
  factory,
  provider,
  from: wallet.address,
});
const deployment = await signBroadcastAndWait({
  wallet,
  provider,
  transaction: deploymentPrepared.transaction,
  safetyOptions: { deployment: true },
});
const contractAddress = deployment.receipt.contractAddress;
if (!contractAddress) throw new Error("部署回执缺少 contractAddress");
const deployedCode = await provider.getCode(contractAddress);
if (!deployedCode || deployedCode === "0x") {
  throw new Error("部署地址没有运行时代码");
}

const contract = new Contract(contractAddress, artifact.abi, wallet);
const runId = `${Date.now()}-${randomUUID()}`;
const designId = id(`jewelchain-monad-testnet:${runId}`);
const v1Hash = id(`jewelchain-monad-testnet:${runId}:v1`);
const v2Hash = id(`jewelchain-monad-testnet:${runId}:v2`);
const v1Uri = `https://example.invalid/jewelchain-monad-testnet/${runId}/v1.json`;
const v2Uri = `https://example.invalid/jewelchain-monad-testnet/${runId}/v2.json`;

async function executeContractCall(method, args, expectedFunction) {
  const prepared = await prepareSafeContractCall({
    method,
    args,
    provider,
    from: wallet.address,
    contractAddress,
    contractInterface,
    expectedFunction,
  });
  const executed = await signBroadcastAndWait({
    wallet,
    provider,
    transaction: prepared.transaction,
    safetyOptions: {
      contractAddress,
      contractInterface,
      expectedFunction,
    },
  });
  return {
    transactionHash: executed.response.hash,
    blockNumber: executed.receipt.blockNumber,
    gasUsed: executed.receipt.gasUsed.toString(),
    estimatedGas: prepared.estimatedGas.toString(),
  };
}

const v1 = await executeContractCall(
  contract.registerVersion,
  [designId, v1Hash, ZeroHash, v1Uri],
  "registerVersion",
);
const v2 = await executeContractCall(
  contract.registerVersion,
  [designId, v2Hash, v1Hash, v2Uri],
  "registerVersion",
);
const finalized = await executeContractCall(
  contract.confirmVersion,
  [designId, v2Hash],
  "confirmVersion",
);

const [v1Record, v2Record, finalRecord] = await Promise.all([
  contract.getVersion(designId, v1Hash),
  contract.getVersion(designId, v2Hash),
  contract.getFinal(designId),
]);
if (
  v1Record.parentContentHash !== ZeroHash
  || v2Record.parentContentHash.toLowerCase() !== v1Hash.toLowerCase()
  || finalRecord.contentHash.toLowerCase() !== v2Hash.toLowerCase()
  || !finalRecord.finalized
) {
  throw new Error("部署后链上版本关系回读不一致");
}

const evidence = {
  schemaVersion: "monad-testnet-design-registry-smoke/v1",
  evidenceBoundary:
    "仅证明 Monad Testnet 合约部署、V1→V2→最终确认与公开回读；不证明主网、真实 AI、版权或生产就绪。",
  network: {
    name: "Monad Testnet",
    rpcUrl: MONAD_TESTNET_RPC_URL,
    chainId: Number(MONAD_TESTNET_CHAIN_ID),
    observedBlockBeforeDeployment: network.blockNumber,
  },
  candidate: {
    sourceSha256,
    bytecodeSha256,
    compilerVersion: artifact.compilerVersion,
  },
  account: { address: wallet.address, disposableTestnetOnly: true },
  deployment: {
    contractAddress,
    transactionHash: deployment.response.hash,
    blockNumber: deployment.receipt.blockNumber,
    gasUsed: deployment.receipt.gasUsed.toString(),
    estimatedGas: deploymentPrepared.estimatedGas.toString(),
    explorerUrl: `${MONAD_TESTNET_EXPLORER_URL}/tx/${deployment.response.hash}`,
  },
  syntheticTestVector: {
    containsCustomerData: false,
    designId,
    v1: { contentHash: v1Hash, parentContentHash: ZeroHash, metadataUri: v1Uri, ...v1 },
    v2: { contentHash: v2Hash, parentContentHash: v1Hash, metadataUri: v2Uri, ...v2 },
    finalization: { contentHash: v2Hash, ...finalized },
  },
  readback: {
    v1VersionNumber: Number(v1Record.versionNumber),
    v2VersionNumber: Number(v2Record.versionNumber),
    finalContentHash: finalRecord.contentHash,
    finalized: finalRecord.finalized,
  },
  completedAt: new Date().toISOString(),
};
await writeJsonEvidence(runtimeEvidencePath, evidence);
console.log(JSON.stringify(evidence, null, 2));
