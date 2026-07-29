import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  JsonRpcProvider,
  Transaction,
  Wallet,
  getAddress,
} from "ethers";

export const MONAD_TESTNET_CHAIN_ID = 10143n;
export const MONAD_TESTNET_RPC_URL = "https://testnet-rpc.monad.xyz";
export const MONAD_TESTNET_EXPLORER_URL = "https://testnet.monadscan.com";
export const MONAD_TESTNET_FAUCET_URL = "https://faucet.monad.xyz";
export const MONAD_TESTNET_WALLET_INIT_ACK =
  "CREATE_DISPOSABLE_MONAD_TESTNET_WALLET_10143";
export const MONAD_TESTNET_WRITE_ACK = "WRITE_MONAD_TESTNET_10143_ZERO_VALUE_ONLY";

export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const evidenceDirectory = path.join(
  projectRoot,
  ".codex-artifacts",
  "monad-testnet",
);
export const runtimeEvidencePath = path.join(evidenceDirectory, "last-run.json");
export const verificationEvidencePath = path.join(
  evidenceDirectory,
  "last-verification.json",
);

function codedError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function normalizedOfficialUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw codedError("MONAD_TESTNET_RPC_REJECTED", "Monad Testnet RPC URL 格式无效");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw codedError(
      "MONAD_TESTNET_RPC_REJECTED",
      "Monad Testnet RPC 必须是无凭据、无查询参数的 HTTPS 官方地址",
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString().replace(/\/$/, "");
}

export function assertOfficialRpcUrl(value = MONAD_TESTNET_RPC_URL) {
  const normalized = normalizedOfficialUrl(value);
  if (normalized !== MONAD_TESTNET_RPC_URL) {
    throw codedError(
      "MONAD_TESTNET_RPC_REJECTED",
      `拒绝非官方 Monad Testnet RPC：${normalized}`,
    );
  }
  return normalized;
}

export function parseChainId(value) {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && value.trim()) return BigInt(value.trim());
  } catch {
    // Normalized below.
  }
  throw codedError("MONAD_TESTNET_CHAIN_ID_INVALID", "无法解析 chainId");
}

export function assertMonadTestnetChainId(value) {
  const actual = parseChainId(value);
  if (actual !== MONAD_TESTNET_CHAIN_ID) {
    throw codedError(
      "MONAD_TESTNET_CHAIN_ID_MISMATCH",
      `拒绝网络：期望 chainId ${MONAD_TESTNET_CHAIN_ID}，实际 ${actual}`,
      { expected: MONAD_TESTNET_CHAIN_ID.toString(), actual: actual.toString() },
    );
  }
  return actual;
}

export function assertZeroValue(value = 0n) {
  let normalized;
  try {
    normalized = BigInt(value ?? 0);
  } catch {
    throw codedError("MONAD_TESTNET_VALUE_INVALID", "交易 value 无法解析");
  }
  if (normalized !== 0n) {
    throw codedError(
      "MONAD_TESTNET_NONZERO_VALUE_REJECTED",
      "测试网登记交易禁止携带原生代币 value",
    );
  }
  return normalized;
}

export function assertNoSecretEnvironment(env = process.env) {
  const forbidden = [
    "PRIVATE_KEY",
    "MONAD_PRIVATE_KEY",
    "MONAD_TESTNET_PRIVATE_KEY",
    "MNEMONIC",
    "SEED_PHRASE",
    "KEYSTORE_PASSWORD",
  ];
  const found = forbidden.filter((name) => typeof env[name] === "string" && env[name]);
  if (found.length) {
    throw codedError(
      "PLAINTEXT_SECRET_ENV_REJECTED",
      `拒绝从环境变量读取明文秘密：${found.join(", ")}`,
    );
  }
}

export function assertWalletInitAuthorized(env = process.env) {
  if (env.MONAD_TESTNET_WALLET_INIT_ACK !== MONAD_TESTNET_WALLET_INIT_ACK) {
    throw codedError(
      "WALLET_INIT_NOT_AUTHORIZED",
      "未提供一次性 Monad Testnet 钱包初始化确认令牌",
    );
  }
}

export function assertWriteExecutionAuthorized({
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  if (!argv.includes("--execute-testnet")) {
    throw codedError(
      "TESTNET_WRITE_FLAG_REQUIRED",
      "写操作默认关闭；缺少 --execute-testnet",
    );
  }
  if (env.MONAD_TESTNET_WRITE_ACK !== MONAD_TESTNET_WRITE_ACK) {
    throw codedError(
      "TESTNET_WRITE_ACK_REQUIRED",
      "缺少 Monad Testnet 10143 零 value 写操作确认令牌",
    );
  }
}

function isInside(basePath, candidatePath) {
  const relative = path.relative(path.resolve(basePath), path.resolve(candidatePath));
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function resolveSecretPaths({
  env = process.env,
  repositoryRoot = projectRoot,
} = {}) {
  const configured = env.GOLD_MONAD_TESTNET_SECRET_DIR;
  const localAppData = env.LOCALAPPDATA;
  if (!configured && !localAppData) {
    throw codedError(
      "LOCALAPPDATA_REQUIRED",
      "缺少 LOCALAPPDATA，无法选择仓库外秘密目录",
    );
  }
  const directory = path.resolve(
    configured || path.join(localAppData, "GoldDesign", "secrets", "monad-testnet"),
  );
  if (isInside(repositoryRoot, directory)) {
    throw codedError(
      "SECRET_DIRECTORY_INSIDE_REPOSITORY",
      "一次性测试账户必须保存在 Git 仓库外",
    );
  }
  return {
    directory,
    keystorePath: path.join(directory, "deployer.keystore.json"),
    dpapiPath: path.join(directory, "deployer.passphrase.dpapi"),
    accountPath: path.join(directory, "account.json"),
  };
}

function powershellPath(env = process.env) {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT;
  if (!systemRoot) {
    throw codedError("WINDOWS_SYSTEMROOT_REQUIRED", "无法定位 Windows PowerShell");
  }
  return path.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

async function runPowerShellWithInput(script, input, env = process.env) {
  if (process.platform !== "win32") {
    throw codedError(
      "WINDOWS_DPAPI_REQUIRED",
      "该测试账户方案要求 Windows DPAPI CurrentUser",
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      powershellPath(env),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 1024 * 1024) child.kill();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(codedError("POWERSHELL_SECURITY_HELPER_FAILED", stderr.trim() || `exit ${code}`));
    });
    child.stdin.end(input, "utf8");
  });
}

const PROTECT_DPAPI_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$plain = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($plain)
$protected = [Security.Cryptography.ProtectedData]::Protect(
  $bytes,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;

const UNPROTECT_DPAPI_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$encoded = [Console]::In.ReadToEnd().Trim()
$protected = [Convert]::FromBase64String($encoded)
$bytes = [Security.Cryptography.ProtectedData]::Unprotect(
  $protected,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
`;

const HARDEN_DIRECTORY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$target = [Console]::In.ReadToEnd().Trim()
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
& $icacls $target '/inheritance:r' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "icacls inheritance failed: $LASTEXITCODE" }
& $icacls $target '/grant:r' "*$($currentSid):(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "icacls current-user grant failed: $LASTEXITCODE" }
& $icacls $target '/grant:r' '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "icacls SYSTEM grant failed: $LASTEXITCODE" }
`;

export async function protectWithCurrentUserDpapi(secret, env = process.env) {
  return runPowerShellWithInput(PROTECT_DPAPI_SCRIPT, secret, env);
}

export async function unprotectWithCurrentUserDpapi(encoded, env = process.env) {
  return runPowerShellWithInput(UNPROTECT_DPAPI_SCRIPT, encoded, env);
}

export async function hardenSecretDirectory(directory, env = process.env) {
  await mkdir(directory, { recursive: true });
  await runPowerShellWithInput(HARDEN_DIRECTORY_SCRIPT, directory, env);
}

export async function loadPublicAccount(paths = resolveSecretPaths()) {
  let value;
  try {
    value = JSON.parse(await readFile(paths.accountPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw codedError(
        "TESTNET_ACCOUNT_NOT_INITIALIZED",
        "一次性 Monad Testnet 账户尚未初始化",
      );
    }
    throw error;
  }
  assertMonadTestnetChainId(value.chainId);
  return { ...value, address: getAddress(value.address) };
}

export async function loadEncryptedTestnetWallet(paths = resolveSecretPaths()) {
  const account = await loadPublicAccount(paths);
  let passphrase = "";
  try {
    const [encryptedJson, protectedPassphrase] = await Promise.all([
      readFile(paths.keystorePath, "utf8"),
      readFile(paths.dpapiPath, "utf8"),
    ]);
    passphrase = await unprotectWithCurrentUserDpapi(protectedPassphrase);
    const wallet = await Wallet.fromEncryptedJson(encryptedJson, passphrase);
    if (getAddress(wallet.address) !== account.address) {
      throw codedError(
        "KEYSTORE_ADDRESS_MISMATCH",
        "加密 keystore 与公开账户记录不一致",
      );
    }
    return { wallet, account, paths };
  } finally {
    passphrase = "";
  }
}

export function createMonadTestnetProvider(env = process.env) {
  const configuredChainId = env.MONAD_TESTNET_CHAIN_ID || MONAD_TESTNET_CHAIN_ID;
  assertMonadTestnetChainId(configuredChainId);
  const rpcUrl = assertOfficialRpcUrl(env.MONAD_TESTNET_RPC_URL || MONAD_TESTNET_RPC_URL);
  return new JsonRpcProvider(rpcUrl);
}

export async function assertLiveMonadTestnet(provider) {
  const rawChainId = await provider.send("eth_chainId", []);
  const chainId = assertMonadTestnetChainId(rawChainId);
  const blockNumber = await provider.getBlockNumber();
  return { chainId, blockNumber };
}

export function assertSafeTransactionRequest(
  transaction,
  {
    deployment = false,
    contractAddress = null,
    expectedFunction = null,
    contractInterface = null,
    expectedFrom = null,
  } = {},
) {
  assertMonadTestnetChainId(transaction.chainId);
  assertZeroValue(transaction.value ?? 0n);
  if (typeof transaction.data !== "string" || !transaction.data.startsWith("0x") || transaction.data === "0x") {
    throw codedError("TRANSACTION_DATA_REQUIRED", "安全交易必须包含非空 calldata");
  }
  if (deployment) {
    if (transaction.to !== null && transaction.to !== undefined) {
      throw codedError("DEPLOYMENT_TARGET_REJECTED", "合约部署交易不得包含 to 地址");
    }
  } else {
    if (!contractAddress || !transaction.to) {
      throw codedError("CONTRACT_TARGET_REQUIRED", "合约调用缺少固定目标地址");
    }
    if (getAddress(transaction.to) !== getAddress(contractAddress)) {
      throw codedError("CONTRACT_TARGET_MISMATCH", "交易目标不是本次部署的 DesignRegistry");
    }
    if (contractInterface && expectedFunction) {
      const parsed = contractInterface.parseTransaction({
        data: transaction.data,
        value: transaction.value ?? 0n,
      });
      if (!parsed || parsed.name !== expectedFunction) {
        throw codedError(
          "CONTRACT_FUNCTION_MISMATCH",
          `拒绝未授权合约方法；期望 ${expectedFunction}`,
        );
      }
    }
  }
  if (expectedFrom && transaction.from && getAddress(transaction.from) !== getAddress(expectedFrom)) {
    throw codedError("TRANSACTION_SIGNER_MISMATCH", "交易签名地址与一次性账户不一致");
  }
  return transaction;
}

export function parseAndAssertSerializedTransaction(
  serialized,
  options = {},
) {
  const parsed = Transaction.from(serialized);
  if (options.requireSignature !== false && !parsed.signature) {
    throw codedError("SIGNED_TRANSACTION_REQUIRED", "发送前必须解析已签名交易");
  }
  return assertSafeTransactionRequest(parsed, options);
}

export function addGasSafetyBuffer(estimatedGas) {
  const estimate = BigInt(estimatedGas);
  return (estimate * 120n + 99n) / 100n + 10_000n;
}

export async function resolveFeeOverrides(provider) {
  const feeData = await provider.getFeeData();
  if (feeData.maxFeePerGas !== null && feeData.maxPriorityFeePerGas !== null) {
    return {
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    };
  }
  if (feeData.gasPrice !== null) return { gasPrice: feeData.gasPrice };
  throw codedError("FEE_DATA_UNAVAILABLE", "Monad Testnet RPC 未返回可用 Gas 价格");
}

export function maximumFeePerGas(transaction) {
  const value = transaction.maxFeePerGas ?? transaction.gasPrice;
  if (value === null || value === undefined) {
    throw codedError("TRANSACTION_FEE_MISSING", "安全交易缺少 Gas 价格上限");
  }
  return BigInt(value);
}

export async function prepareSafeDeployment({
  factory,
  provider,
  from,
}) {
  const base = await factory.getDeployTransaction();
  const simulation = await provider.call({ ...base, from, value: 0n });
  if (typeof simulation !== "string" || simulation === "0x") {
    throw codedError("DEPLOYMENT_SIMULATION_FAILED", "合约部署 eth_call 未返回运行时代码");
  }
  const estimatedGas = await provider.estimateGas({ ...base, from, value: 0n });
  const transaction = {
    ...base,
    from,
    chainId: MONAD_TESTNET_CHAIN_ID,
    value: 0n,
    gasLimit: addGasSafetyBuffer(estimatedGas),
    ...await resolveFeeOverrides(provider),
  };
  assertSafeTransactionRequest(transaction, { deployment: true, expectedFrom: from });
  return { transaction, simulation, estimatedGas };
}

export async function prepareSafeContractCall({
  method,
  args,
  provider,
  from,
  contractAddress,
  contractInterface,
  expectedFunction,
}) {
  const staticResult = await method.staticCall(...args);
  const estimatedGas = await method.estimateGas(...args);
  const populated = await method.populateTransaction(...args);
  const transaction = {
    ...populated,
    from,
    chainId: MONAD_TESTNET_CHAIN_ID,
    value: 0n,
    gasLimit: addGasSafetyBuffer(estimatedGas),
    ...await resolveFeeOverrides(provider),
  };
  assertSafeTransactionRequest(transaction, {
    contractAddress,
    contractInterface,
    expectedFunction,
    expectedFrom: from,
  });
  return { transaction, staticResult, estimatedGas };
}

export async function signBroadcastAndWait({
  wallet,
  provider,
  transaction,
  safetyOptions,
}) {
  assertSafeTransactionRequest(transaction, {
    ...safetyOptions,
    expectedFrom: wallet.address,
  });
  const feeUpperBound = maximumFeePerGas(transaction);
  const maximumCost = BigInt(transaction.gasLimit) * feeUpperBound;
  const balance = await provider.getBalance(wallet.address);
  if (balance < maximumCost) {
    throw codedError(
      "TESTNET_FUNDS_REQUIRED",
      "一次性账户余额不足以覆盖本笔测试网交易的 Gas 上限",
      {
        address: wallet.address,
        balance: balance.toString(),
        required: maximumCost.toString(),
        faucet: MONAD_TESTNET_FAUCET_URL,
      },
    );
  }

  const signable = { ...transaction };
  delete signable.from;
  const populated = await wallet.populateTransaction(signable);
  const serialized = await wallet.signTransaction(populated);
  parseAndAssertSerializedTransaction(serialized, {
    ...safetyOptions,
    expectedFrom: wallet.address,
  });
  const response = await provider.broadcastTransaction(serialized);
  const receipt = await response.wait();
  if (!receipt || receipt.status !== 1) {
    throw codedError("TESTNET_TRANSACTION_FAILED", `交易失败：${response.hash}`);
  }
  return { response, receipt };
}

export async function writeJsonEvidence(filePath, payload) {
  if (!isInside(projectRoot, filePath) || !isInside(evidenceDirectory, filePath)) {
    throw codedError("EVIDENCE_PATH_REJECTED", "证据文件只能写入已忽略的测试网证据目录");
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
