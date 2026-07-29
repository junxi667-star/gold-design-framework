import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ContractFactory, JsonRpcProvider } from "ethers";

import { compileDesignRegistry } from "./web3-contract.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rpcUrl = process.env.LOCAL_EVM_RPC_URL || "http://127.0.0.1:8545";
const expectedChainId = BigInt(process.env.LOCAL_EVM_CHAIN_ID || "31337");
const provider = new JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();

if (network.chainId !== expectedChainId) {
  throw new Error(
    `Refusing deployment: expected local chainId ${expectedChainId}, received ${network.chainId}`,
  );
}

const signer = await provider.getSigner(0);
const artifact = await compileDesignRegistry();
const artifactPath = path.join(projectRoot, "contracts", "artifacts", "DesignRegistry.json");
await mkdir(path.dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
const contract = await factory.deploy();
await contract.waitForDeployment();
const deploymentTransaction = contract.deploymentTransaction();
const receipt = await deploymentTransaction.wait();

const runtime = {
  schemaVersion: "local-web3-runtime/v1",
  mode: "local-development",
  rpcUrl,
  chainId: Number(network.chainId),
  contractAddress: await contract.getAddress(),
  deploymentTransactionHash: deploymentTransaction.hash,
  deploymentBlockNumber: receipt.blockNumber,
  developmentSignerAddress: await signer.getAddress(),
  deployedAt: new Date().toISOString(),
};

const runtimePath = path.join(projectRoot, "data", "web3-local-runtime.json");
await mkdir(path.dirname(runtimePath), { recursive: true });
await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");

console.log(JSON.stringify(runtime, null, 2));
console.log("LOCAL ONLY: this deployment is not Monad testnet or mainnet.");
