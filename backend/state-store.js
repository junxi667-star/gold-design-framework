import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { clone, iso } from "./utils.js";

function initialState() {
  const createdAt = iso();
  return {
    schemaVersion: 4,
    requirements: [],
    promptTemplates: [
      {
        id: "prompt-backend-v1",
        scope: "gold-design",
        version: 1,
        name: "黄金设计后端契约模板",
        content: "仅使用客户已确认的结构化需求和审核通过的知识，生成差异明确的设计方向；不得虚构克重、工艺可行性或量产结论。",
        changeNote: "兼容后端初始正式模板",
        status: "official",
        testPassed: true,
        createdAt,
        publishedAt: createdAt,
      },
    ],
    tasks: [],
    results: [],
    feedback: [],
    idempotency: {},
  };
}

function migrateState(value) {
  const state = value && typeof value === "object" ? value : {};
  const fallback = initialState();
  state.schemaVersion = 4;
  for (const key of ["requirements", "promptTemplates", "tasks", "results", "feedback"]) {
    if (!Array.isArray(state[key])) state[key] = fallback[key];
  }
  if (!state.idempotency || typeof state.idempotency !== "object" || Array.isArray(state.idempotency)) {
    state.idempotency = {};
  }
  if (!state.promptTemplates.length) state.promptTemplates = fallback.promptTemplates;
  for (const task of state.tasks) {
    if (!Array.isArray(task.directions)) task.directions = [];
    if (!Array.isArray(task.completedImages)) task.completedImages = [];
    if (!Array.isArray(task.resultIds)) task.resultIds = [];
  }
  return state;
}

export class JsonStateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = null;
    this.transactionQueue = Promise.resolve();
  }

  async loadUnlocked() {
    if (this.state) return this.state;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = migrateState(JSON.parse(raw));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.state = initialState();
    }
    await this.writeUnlocked(this.state);
    return this.state;
  }

  async writeUnlocked(state) {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    await rename(temporaryPath, this.filePath);
  }

  async read() {
    await this.transactionQueue;
    return clone(await this.loadUnlocked());
  }

  update(mutator) {
    const execute = async () => {
      const current = await this.loadUnlocked();
      const next = clone(current);
      const result = await mutator(next);
      await this.writeUnlocked(next);
      this.state = next;
      return clone(result);
    };
    const operation = this.transactionQueue.then(execute, execute);
    this.transactionQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
