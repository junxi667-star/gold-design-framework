import { randomBytes } from "node:crypto";
import { access, writeFile } from "node:fs/promises";

import { Wallet } from "ethers";

import {
  MONAD_TESTNET_CHAIN_ID,
  assertNoSecretEnvironment,
  assertWalletInitAuthorized,
  hardenSecretDirectory,
  protectWithCurrentUserDpapi,
  resolveSecretPaths,
} from "./monad-testnet-common.js";

async function assertAbsent(filePath) {
  try {
    await access(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const error = new Error(`拒绝覆盖已经存在的测试账户文件：${filePath}`);
  error.code = "TESTNET_ACCOUNT_ALREADY_EXISTS";
  throw error;
}

assertNoSecretEnvironment();
assertWalletInitAuthorized();

const paths = resolveSecretPaths();
await Promise.all([
  assertAbsent(paths.keystorePath),
  assertAbsent(paths.dpapiPath),
  assertAbsent(paths.accountPath),
]);
await hardenSecretDirectory(paths.directory);

const wallet = Wallet.createRandom();
let passphrase = randomBytes(32).toString("base64url");
try {
  const encryptedJson = await wallet.encrypt(passphrase);
  const protectedPassphrase = await protectWithCurrentUserDpapi(passphrase);
  const account = {
    schemaVersion: "monad-testnet-disposable-account/v1",
    network: "Monad Testnet",
    chainId: Number(MONAD_TESTNET_CHAIN_ID),
    address: wallet.address,
    purpose: "DesignRegistry isolated test only",
    createdAt: new Date().toISOString(),
  };
  await writeFile(paths.keystorePath, encryptedJson, { encoding: "utf8", flag: "wx" });
  await writeFile(paths.dpapiPath, protectedPassphrase, { encoding: "utf8", flag: "wx" });
  await writeFile(paths.accountPath, `${JSON.stringify(account, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await hardenSecretDirectory(paths.directory);
  console.log(JSON.stringify({
    status: "DISPOSABLE_TESTNET_ACCOUNT_CREATED",
    address: wallet.address,
    chainId: Number(MONAD_TESTNET_CHAIN_ID),
    secretDirectory: paths.directory,
    warning: "私钥和口令未输出；该账户只能用于 Monad Testnet 10143。",
  }, null, 2));
} finally {
  passphrase = "";
}
