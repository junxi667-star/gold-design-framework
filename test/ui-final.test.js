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
