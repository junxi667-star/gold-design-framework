import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rpcUrl = "http://127.0.0.1:8545";
const expectedChainId = 31337n;
if (
  process.env.LOCAL_EVM_RPC_URL !== undefined
  && process.env.LOCAL_EVM_RPC_URL !== rpcUrl
) {
  throw new Error("Refusing deployment: RPC must be exactly http://127.0.0.1:8545");
}
if (
  process.env.LOCAL_EVM_CHAIN_ID !== undefined
  && BigInt(process.env.LOCAL_EVM_CHAIN_ID) !== expectedChainId
) {
  throw new Error("Refusing deployment: chainId must be exactly 31337");
}
const { ContractFactory, JsonRpcProvider } = await import("ethers");
const provider = new JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();

if (network.chainId !== expectedChainId) {
  throw new Error(
    `Refusing deployment: expected local chainId ${expectedChainId}, received ${network.chainId}`,
  );
}

const signer = await provider.getSigner(0);
const artifactPath = path.join(projectRoot, "contracts", "artifacts", "DesignRegistry.json");
let artifact;
try {
  artifact = JSON.parse(await readFile(artifactPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  const { compileDesignRegistry } = await import("./web3-contract.js");
  artifact = await compileDesignRegistry();
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}
if (!Array.isArray(artifact?.abi) || !/^0x[0-9a-f]+$/i.test(artifact?.bytecode || "")) {
  throw new Error("DesignRegistry artifact is missing a valid ABI or bytecode");
}
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
