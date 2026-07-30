import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { clone } from "./utils.js";

function initialState() {
  return {
    schemaVersion: "local-web3-state/v1",
    confirmations: [],
    registrations: [],
  };
}

function migrateState(value) {
  const state = value && typeof value === "object" ? value : initialState();
  state.schemaVersion = "local-web3-state/v1";
  if (!Array.isArray(state.confirmations)) state.confirmations = [];
  if (!Array.isArray(state.registrations)) state.registrations = [];
  return state;
}

export class Web3StateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = null;
    this.queue = Promise.resolve();
  }

  async loadUnlocked() {
    if (this.state) return this.state;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      this.state = migrateState(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.state = initialState();
      await this.writeUnlocked(this.state);
    }
    return this.state;
  }

  async writeUnlocked(state) {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }

  async read() {
    await this.queue;
    return clone(await this.loadUnlocked());
  }

  update(mutator) {
    const execute = async () => {
      const next = clone(await this.loadUnlocked());
      const result = await mutator(next);
      await this.writeUnlocked(next);
      this.state = next;
      return clone(result);
    };
    const operation = this.queue.then(execute, execute);
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
