import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ArkImageProvider } from "../backend/ark-image-provider.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlV8AAAAASUVORK5CYII=", "base64");

test("Ark provider sends Seedream URL response format and archives image", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "jewel-ark-"));
  const previous = { ...process.env };
  process.env.ARK_API_KEY = "test-key";
  process.env.ARK_IMAGE_MODEL = "doubao-seedream-5-0-260128";
  let requestBody;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes("/images/generations")) {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ data: [{ url: "https://image.example/test.png" }] }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-test" } });
    }
    return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  };
  try {
    const provider = new ArkImageProvider({ generatedDir: dir, fetchImpl });
    const result = await provider.generate({ prompt: "gold ring", filenamePrefix: "test" });
    assert.equal(requestBody.response_format, "url");
    assert.equal(requestBody.sequential_image_generation, "disabled");
    assert.equal(requestBody.stream, false);
    assert.equal(requestBody.size, "2K");
    assert.deepEqual(await readFile(result.filePath), PNG);
  } finally {
    process.env = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
