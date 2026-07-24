import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const publicFiles = [
  "public/index.html",
  "public/js/app.js",
  "public/js/ai-client.js",
  "public/js/ai-workbench.js",
  "public/js/domain.js",
  "public/js/providers.js",
];

test("默认演示不含外部服务地址、密钥、OCR、训练或真实图片生成声明", async () => {
  const contents = await Promise.all(
    publicFiles.map((file) => readFile(path.resolve(file), "utf8")),
  );
  const source = contents.join("\n");

  assert.doesNotMatch(source, /https?:\/\//, "前端源码不得写入外部服务地址");
  assert.doesNotMatch(source, /(api[_-]?key|secret[_-]?key|bearer\s+[a-z0-9._-]+)/i, "前端源码不得包含服务端密钥");
  assert.match(source, /mode === "remote"/);
  assert.match(source, /\/api\/ai\/requirements\/parse/);
  assert.match(source, /系统不会自动切换到演示模式/);
  assert.equal(source.includes("已学习"), false, "界面不得使用误导性的“已学习”状态");
  assert.match(source, /realImageGeneration:\s*false/);
  assert.match(source, /photoRecognition:\s*false/);
  assert.match(source, /modelTraining:\s*false/);
});
