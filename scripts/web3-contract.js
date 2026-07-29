import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import solc from "solc";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const contractSourcePath = path.join(projectRoot, "contracts", "DesignRegistry.sol");

export async function compileDesignRegistry() {
  const source = await readFile(contractSourcePath, "utf8");
  const input = {
    language: "Solidity",
    sources: {
      "DesignRegistry.sol": { content: source },
    },
    settings: {
      evmVersion: "shanghai",
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((item) => item.severity === "error");
  if (errors.length) {
    throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
  }

  const compiled = output.contracts?.["DesignRegistry.sol"]?.DesignRegistry;
  if (!compiled?.evm?.bytecode?.object) {
    throw new Error("DesignRegistry compilation produced no deployable bytecode");
  }
  return {
    contractName: "DesignRegistry",
    sourceName: "DesignRegistry.sol",
    compilerVersion: solc.version(),
    abi: compiled.abi,
    bytecode: `0x${compiled.evm.bytecode.object}`,
    deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
  };
}
