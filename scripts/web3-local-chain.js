const host = "127.0.0.1";
const port = 8545;
const chainId = 31337;
const expectedRpcUrl = `http://${host}:${port}`;

if (
  process.env.LOCAL_EVM_PORT !== undefined
  && Number(process.env.LOCAL_EVM_PORT) !== port
) {
  throw new Error("Refusing local EVM start: port must be exactly 8545");
}
if (
  process.env.LOCAL_EVM_CHAIN_ID !== undefined
  && Number(process.env.LOCAL_EVM_CHAIN_ID) !== chainId
) {
  throw new Error("Refusing local EVM start: chainId must be exactly 31337");
}
if (
  process.env.LOCAL_EVM_RPC_URL !== undefined
  && process.env.LOCAL_EVM_RPC_URL !== expectedRpcUrl
) {
  throw new Error("Refusing local EVM start: RPC must be exactly http://127.0.0.1:8545");
}

const { default: ganache } = await import("ganache");
const server = ganache.server({
  chain: { chainId, networkId: chainId },
  logging: { quiet: false },
  wallet: { deterministic: true, totalAccounts: 5 },
});

await server.listen(port, host);
const accounts = Object.keys(server.provider.getInitialAccounts());
console.log(`Local development EVM listening at ${expectedRpcUrl}`);
console.log(`chainId=${chainId}`);
console.log(`developmentSigner=${accounts[0]}`);
console.log("LOCAL ONLY: unlocked deterministic development accounts; never use them on a public network.");

async function shutdown(signal) {
  console.log(`Stopping local EVM (${signal})`);
  await server.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
