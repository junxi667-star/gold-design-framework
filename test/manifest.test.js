import test from "node:test";
import assert from "node:assert/strict";
import { buildMetadata, canonicalJson, hashCanonical } from "../backend/design-manifest.js";
import { ZERO_HASH } from "../backend/evm-codec.js";

test("canonical metadata hash is deterministic and mutation-sensitive", () => {
  const project = { localDesignId: "DESIGN-TEST" };
  const version = {
    versionNumber: 1,
    parentContentHash: ZERO_HASH,
    structuredRequirement: { style: "新中式", productType: "戒指", motifs: ["祥云"], structureForms: ["圆弧素圈"] },
    apiPrompt: "one gold ring",
    changeRequest: "",
    modelProvider: "Test",
    modelName: "Model",
    createdAt: "2026-08-02T00:00:00.000Z",
  };
  const evidence = { imageHash: `0x${"1".repeat(64)}`, imageSha256: "2".repeat(64), imageSizeBytes: 123 };
  const first = buildMetadata({ project, version, registrant: "0x1111111111111111111111111111111111111111", imageUri: "https://example/image.png", imageEvidence: evidence });
  const second = buildMetadata({ project, version, registrant: "0x1111111111111111111111111111111111111111", imageUri: "https://example/image.png", imageEvidence: evidence });
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(hashCanonical(first.metadata), first.contentHash);
  assert.notEqual(hashCanonical({ ...first.metadata, style: "现代极简" }), first.contentHash);
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});
