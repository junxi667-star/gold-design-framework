import assert from "node:assert/strict";
import test from "node:test";

import { seedDemoDataIfRequested } from "../public/js/demo-seed.js";
import { MockDesignProvider } from "../public/js/providers.js";

class MemoryDatabase {
  constructor() {
    this.stores = {
      projects: new Map(),
      knowledge: new Map(),
    };
  }

  async getAll(storeName) {
    return [...this.stores[storeName].values()];
  }

  async put(storeName, value) {
    this.stores[storeName].set(value.id, value);
    return value;
  }
}

test("演示模式只在空数据库中写入明确标注的流程样例", async () => {
  const database = new MemoryDatabase();
  const provider = new MockDesignProvider();

  const result = await seedDemoDataIfRequested(database, provider, "?demo=1");

  assert.equal(result.seeded, true);
  const [project] = await database.getAll("projects");
  const [knowledge] = await database.getAll("knowledge");
  assert.equal(project.directions.length, 3);
  assert.equal(project.versions.length, 2);
  assert.equal(project.confirmedVersionId, project.currentVersionId);
  assert.equal(knowledge.reviewStatus, "approved");
  assert.match(knowledge.textContent, /不包含黄金行业事实或专业结论/);

  const repeated = await seedDemoDataIfRequested(database, provider, "?demo=1");
  assert.deepEqual(repeated, { seeded: false, reason: "existing_data" });
  assert.equal((await database.getAll("projects")).length, 1);
  assert.equal((await database.getAll("knowledge")).length, 1);
});

test("普通模式不写入演示数据", async () => {
  const database = new MemoryDatabase();
  const result = await seedDemoDataIfRequested(database, new MockDesignProvider(), "");

  assert.deepEqual(result, { seeded: false, reason: "not_demo_mode" });
  assert.equal((await database.getAll("projects")).length, 0);
  assert.equal((await database.getAll("knowledge")).length, 0);
});
