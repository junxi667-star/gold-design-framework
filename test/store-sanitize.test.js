import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { JewelChainStore } from "../backend/jewelchain-store.js";

test("state file stores absolute paths as generatedDir-relative paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jewel-store-"));
  const generatedDir = path.join(root, "generated");
  const filePath = path.join(root, "state.json");
  try {
    const store = new JewelChainStore(filePath, { generatedDir });
    await store.update((state) => {
      state.versions.push({
        id: "v1",
        imageFilePath: path.join(generatedDir, "design_1.png"),
      });
      state.workerUploads.push({
        id: "u1",
        filePath: path.join(generatedDir, "task_1.png"),
      });
      state.workerTasks.push({
        id: "t1",
        result: { filePath: path.join(generatedDir, "task_1.png") },
      });
      return null;
    });
    const raw = await readFile(filePath, "utf8");
    assert.doesNotMatch(raw, new RegExp(generatedDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const parsed = JSON.parse(raw);
    assert.equal(parsed.versions[0].imageFilePath, "design_1.png");
    assert.equal(parsed.workerUploads[0].filePath, "task_1.png");
    assert.equal(parsed.workerTasks[0].result.filePath, "task_1.png");
    const read = await store.read();
    assert.equal(read.versions[0].imageFilePath, path.join(generatedDir, "design_1.png"));
    assert.equal(read.workerUploads[0].filePath, path.join(generatedDir, "task_1.png"));
    assert.equal(read.workerTasks[0].result.filePath, path.join(generatedDir, "task_1.png"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("store restores pre-existing relative paths on read", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jewel-store-"));
  const generatedDir = path.join(root, "generated");
  const filePath = path.join(root, "state.json");
  try {
    const store = new JewelChainStore(filePath, { generatedDir });
    await store.update((state) => {
      state.versions.push({ id: "v1", imageFilePath: "design_1.png" });
      return null;
    });
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(raw.versions[0].imageFilePath, "design_1.png");
    const read = await store.read();
    assert.equal(read.versions[0].imageFilePath, path.join(generatedDir, "design_1.png"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("store read cache returns fresh state after updates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jewel-store-"));
  const generatedDir = path.join(root, "generated");
  const filePath = path.join(root, "state.json");
  try {
    const store = new JewelChainStore(filePath, { generatedDir });
    await store.update((state) => {
      state.projects.push({ id: "p1", title: "first" });
      return null;
    });
    const before = await store.read();
    assert.equal(before.projects.length, 1);
    await store.update((state) => {
      state.projects.push({ id: "p2", title: "second" });
      return null;
    });
    const after = await store.read();
    assert.equal(after.projects.length, 2);
    assert.equal(after.projects[1].title, "second");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
