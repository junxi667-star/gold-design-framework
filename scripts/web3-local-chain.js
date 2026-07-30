import ganache from "ganache";

const host = "127.0.0.1";
const port = Number(process.env.LOCAL_EVM_PORT || 8545);
const chainId = Number(process.env.LOCAL_EVM_CHAIN_ID || 31337);

const server = ganache.server({
  chain: { chainId, networkId: chainId },
  logging: { quiet: false },
  wallet: { deterministic: true, totalAccounts: 5 },
});

await server.listen(port, host);
const accounts = Object.keys(server.provider.getInitialAccounts());
console.log(`Local development EVM listening at http://${host}:${port}`);
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
