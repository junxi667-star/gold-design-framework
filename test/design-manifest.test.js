import assert from "node:assert/strict";
import test from "node:test";

import {
  DESIGN_MANIFEST_CANONICALIZATION,
  DESIGN_MANIFEST_CONTENT_HASH_ALGORITHM,
  DESIGN_MANIFEST_SCHEMA_VERSION,
  DESIGN_MANIFEST_ZERO_PARENT_HASH,
  canonicalJson,
  canonicalJsonUtf8,
  designManifestContentHash,
  manifestHashingDescriptor,
} from "../backend/design-manifest.js";

test("design-manifest/v1 固定排序键、NFC、UTF-8 与 Keccak 向量", () => {
  const manifest = {
    z: "e\u0301",
    schemaVersion: "design-manifest/v1",
    list: ["é", -0],
    a: { b: 2, a: 1 },
  };
  const expectedCanonical = "{\"a\":{\"a\":1,\"b\":2},\"list\":[\"é\",0],\"schemaVersion\":\"design-manifest/v1\",\"z\":\"é\"}";
  assert.equal(canonicalJson(manifest), expectedCanonical);
  assert.deepEqual(canonicalJsonUtf8(manifest), Buffer.from(expectedCanonical, "utf8"));
  assert.equal(
    designManifestContentHash(manifest),
    "0xf337326c74d75a3dc2bc2875116ec27ef60e5362e03519852df2cdfb3db08f78",
  );
  assert.equal(
    designManifestContentHash({
      a: { a: 1, b: 2 },
      list: ["e\u0301", 0],
      schemaVersion: "design-manifest/v1",
      z: "é",
    }),
    designManifestContentHash(manifest),
  );
});

test("design-manifest/v1 描述符和首版零父哈希固定", () => {
  assert.deepEqual(manifestHashingDescriptor(), {
    schemaVersion: DESIGN_MANIFEST_SCHEMA_VERSION,
    canonicalization: DESIGN_MANIFEST_CANONICALIZATION,
    textEncoding: "UTF-8",
    contentHashAlgorithm: DESIGN_MANIFEST_CONTENT_HASH_ALGORITHM,
    firstVersionParentContentHash: DESIGN_MANIFEST_ZERO_PARENT_HASH,
  });
  assert.equal(DESIGN_MANIFEST_SCHEMA_VERSION, "design-manifest/v1");
  assert.equal(
    DESIGN_MANIFEST_CANONICALIZATION,
    "sorted-object-keys+nfc-strings/json/utf-8/v1",
  );
  assert.equal(DESIGN_MANIFEST_CONTENT_HASH_ALGORITHM, "keccak256");
  assert.equal(DESIGN_MANIFEST_ZERO_PARENT_HASH, `0x${"00".repeat(32)}`);
});

test("canonical JSON 对 undefined、非有限数和非普通对象 fail-closed", () => {
  assert.throws(() => canonicalJson({ value: undefined }), /does not allow undefined/);
  assert.throws(() => canonicalJson({ value: Number.NaN }), /non-finite/);
  assert.throws(() => canonicalJson(new Date()), /plain objects/);
  assert.throws(
    () => designManifestContentHash({ schemaVersion: "design-manifest/v2" }),
    /Manifest schema must be design-manifest\/v1/,
  );
});
