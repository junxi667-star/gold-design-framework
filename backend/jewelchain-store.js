import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
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

const ABSOLUTE_PATH_FIELDS = Object.freeze([
  ["versions", "imageFilePath"],
  ["workerUploads", "filePath"],
  ["workerTasks", "result.filePath"],
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mapStatePaths(state, transform) {
  const next = clone(state);
  for (const [collection, fieldPath] of ABSOLUTE_PATH_FIELDS) {
    for (const item of next[collection] || []) {
      const target = fieldPath.includes(".")
        ? item.result
        : item;
      if (!target) continue;
      const current = target[fieldPath.split(".").pop()];
      if (typeof current === "string") target[fieldPath.split(".").pop()] = transform(current);
    }
  }
  return next;
}

export class JewelChainStore {
  constructor(filePath, { generatedDir = "" } = {}) {
    this.filePath = filePath;
    this.generatedDir = generatedDir;
    this.queue = Promise.resolve();
    this.cached = null;
    this.cachedMtimeMs = null;
  }

  sanitizeForDisk(state) {
    if (!this.generatedDir) return state;
    return mapStatePaths(state, (value) => {
      const resolved = path.resolve(value);
      const base = path.resolve(this.generatedDir);
      if (resolved === base || resolved.startsWith(`${base}${path.sep}`)) {
        return path.relative(base, resolved);
      }
      return value;
    });
  }

  restoreFromDisk(state) {
    if (!this.generatedDir) return state;
    return mapStatePaths(state, (value) => {
      if (path.isAbsolute(value)) return value;
      return path.join(this.generatedDir, value);
    });
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
    let currentMtimeMs = null;
    try {
      currentMtimeMs = (await stat(this.filePath)).mtimeMs;
    } catch {
      currentMtimeMs = null;
    }
    if (this.cached && this.cachedMtimeMs !== null && currentMtimeMs === this.cachedMtimeMs) {
      return this.restoreFromDisk(clone(this.cached));
    }
    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw);
    const state = {
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
    this.cached = clone(state);
    this.cachedMtimeMs = currentMtimeMs;
    return this.restoreFromDisk(state);
  }

  update(mutator) {
    const execute = async () => {
      const state = await this.read();
      const result = await mutator(state);
      const persisted = this.sanitizeForDisk(state);
      const temporary = `${this.filePath}.tmp`;
      await writeFile(temporary, JSON.stringify(persisted, null, 2), "utf8");
      await rename(temporary, this.filePath);
      this.cached = clone(state);
      this.cachedMtimeMs = null;
      return clone(result);
    };
    const operation = this.queue.then(execute, execute);
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
