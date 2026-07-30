import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileDesignRegistry } from "./web3-contract.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = process.env.GOLD_WEB3_ARTIFACT_OUT
  ? path.resolve(process.env.GOLD_WEB3_ARTIFACT_OUT)
  : path.join(projectRoot, "contracts", "artifacts", "DesignRegistry.json");
const artifact = await compileDesignRegistry();

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(`DesignRegistry compiled with ${artifact.compilerVersion}`);
console.log(`Artifact: ${outputPath}`);
