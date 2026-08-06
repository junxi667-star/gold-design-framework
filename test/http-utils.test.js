import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { readJson, sendJson } from "../backend/http-utils.js";

test("HTTP utilities serialize JSON with the shared safety headers", () => {
  const response = {
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };

  sendJson(response, 202, { data: { id: "design-1" } });

  assert.equal(response.statusCode, 202);
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.headers["X-Content-Type-Options"], "nosniff");
  assert.deepEqual(JSON.parse(response.body), { data: { id: "design-1" } });
});

test("HTTP utilities preserve JSON validation and body-limit errors", async () => {
  await assert.rejects(
    readJson(Readable.from([Buffer.from("not-json")])),
    { code: "INVALID_JSON", httpStatus: 400 },
  );
  await assert.rejects(
    readJson(Readable.from([Buffer.alloc(3)]), { limit: 2 }),
    { code: "PAYLOAD_TOO_LARGE", httpStatus: 413 },
  );
});
