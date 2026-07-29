import { ContractFactory, formatEther } from "ethers";

import { compileDesignRegistry } from "./web3-contract.js";
import {
  MONAD_TESTNET_FAUCET_URL,
  MONAD_TESTNET_RPC_URL,
  assertLiveMonadTestnet,
  assertNoSecretEnvironment,
  createMonadTestnetProvider,
  loadPublicAccount,
  maximumFeePerGas,
  prepareSafeDeployment,
  resolveSecretPaths,
} from "./monad-testnet-common.js";

assertNoSecretEnvironment();

const provider = createMonadTestnetProvider();
const network = await assertLiveMonadTestnet(provider);
const account = await loadPublicAccount(resolveSecretPaths());
const balance = await provider.getBalance(account.address);
const artifact = await compileDesignRegistry();
const factory = new ContractFactory(artifact.abi, artifact.bytecode);
const prepared = await prepareSafeDeployment({
  factory,
  provider,
  from: account.address,
});
const feeUpperBound = maximumFeePerGas(prepared.transaction);
const reserveGas = 750_000n;
const requiredBalance =
  (BigInt(prepared.transaction.gasLimit) + reserveGas) * feeUpperBound;
const ready = balance >= requiredBalance;

console.log(JSON.stringify({
  status: ready ? "READY_FOR_AUTHORIZED_TESTNET_WRITE" : "TESTNET_FUNDS_REQUIRED",
  rpcUrl: MONAD_TESTNET_RPC_URL,
  chainId: Number(network.chainId),
  blockNumber: network.blockNumber,
  address: account.address,
  balanceWei: balance.toString(),
  balanceMon: formatEther(balance),
  deploymentEstimateGas: prepared.estimatedGas.toString(),
  deploymentGasLimit: prepared.transaction.gasLimit.toString(),
  reservedAdditionalGas: reserveGas.toString(),
  requiredBalanceWei: requiredBalance.toString(),
  faucet: ready ? null : MONAD_TESTNET_FAUCET_URL,
  userAction: ready
    ? null
    : "请用户在官方 Faucet 页面人工完成登录/验证码/领取；脚本不会自动领取。",
  writesPerformed: 0,
}, null, 2));

if (!ready) process.exitCode = 2;
