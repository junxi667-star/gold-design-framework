import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const INITIAL_STATE = Object.freeze({
  schemaVersion: "jewelchain-state/v2",
  projects: [],
  versions: [],
  jobs: [],
  chainRecords: [],
  workerTasks: [],
  workers: [],
  workerUploads: [],
  idempotency: {},
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class JewelChainStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  async ensure() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await writeFile(this.filePath, JSON.stringify(INITIAL_STATE, null, 2), "utf8");
    }
  }

  async read() {
    await this.ensure();
    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...clone(INITIAL_STATE),
      ...parsed,
      schemaVersion: "jewelchain-state/v2",
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      versions: Array.isArray(parsed.versions) ? parsed.versions : [],
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      chainRecords: Array.isArray(parsed.chainRecords) ? parsed.chainRecords : [],
      workerTasks: Array.isArray(parsed.workerTasks) ? parsed.workerTasks : [],
      workers: Array.isArray(parsed.workers) ? parsed.workers : [],
      workerUploads: Array.isArray(parsed.workerUploads) ? parsed.workerUploads : [],
      idempotency: parsed.idempotency && typeof parsed.idempotency === "object" ? parsed.idempotency : {},
    };
  }

  update(mutator) {
    const execute = async () => {
      const state = await this.read();
      const result = await mutator(state);
      const temporary = `${this.filePath}.tmp`;
      await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
      await rename(temporary, this.filePath);
      return clone(result);
    };
    const operation = this.queue.then(execute, execute);
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
