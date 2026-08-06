import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(relative) {
  return readFile(new URL(relative, root), "utf8");
}

test("hackathon final UI keeps all critical workflow controls", async () => {
  const html = await read("public/index.html");
  for (const id of [
    "customerText", "generateButton", "workspace", "timeline", "reviseButton",
    "walletButton", "agentQuestion", "askAgentButton", "compareSection", "imageModal",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test("hackathon final UI includes performance and accessibility fallbacks", async () => {
  const css = await read("public/styles.css");
  const app = await read("public/js/app.js");
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /particle-canvas/);
  assert.match(app, /initParticles/);
  assert.match(app, /updateCompare/);
  assert.match(app, /prepare-registration/);
  assert.match(app, /chain-submission/);
});


test("user-facing copy is consistent and Pages keeps offline browsing architecture", async () => {
  const html = await read("public/index.html");
  const pagesHtml = await read("pages-frontend/index.html");
  const app = await read("public/js/app.js");
  const pagesConfig = await read("pages-frontend/runtime-config.js");
  assert.match(html, /生成第一版设计（V1）/);
  assert.match(html, /哪一版被确认为最终版？/);
  assert.match(html, /当前文件是否与链上登记一致？/);
  assert.doesNotMatch(html, /先说人话/);
  assert.doesNotMatch(html, /恢复推荐示例/);
  assert.match(app, /等待您确认设计/);
  assert.match(app, /交易已提交，等待链上确认/);
  assert.match(pagesConfig, /https:\/\/api\.jewelchain\.xyz/);
  assert.match(pagesHtml, /Master（调度服务）暂时离线/);
});

test("Pages deployment assets stay in sync with the Master-served frontend", async () => {
  for (const asset of ["index.html", "styles.css", "js/app.js"]) {
    assert.equal(
      await read(`public/${asset}`),
      await read(`pages-frontend/${asset}`),
      `${asset} must be copied together for Cloudflare Pages`,
    );
  }
});
