import assert from "node:assert/strict";
import test from "node:test";

import { decodeRouteParam, resolvePublicBaseUrl } from "../backend/http/request-utils.js";

test("public metadata URL prefers explicit deployment config and otherwise uses the request Host", () => {
  const request = {
    headers: {
      host: "untrusted.example",
      "x-forwarded-host": "another-untrusted.example",
      "x-forwarded-proto": "https",
    },
  };
  assert.equal(
    resolvePublicBaseUrl(request, { publicBaseUrl: "https://api.jewelchain.xyz/path-that-is-not-part-of-the-origin" }),
    "https://api.jewelchain.xyz",
  );
  assert.equal(resolvePublicBaseUrl(request), "http://untrusted.example");
});

test("local development keeps loopback metadata URLs and malformed route values return a client error", () => {
  assert.equal(resolvePublicBaseUrl({ headers: { host: "127.0.0.1:4173" } }), "http://127.0.0.1:4173");
  assert.equal(decodeRouteParam("project%2Fv1"), "project/v1");
  assert.throws(() => decodeRouteParam("%E0%A4%A"), { code: "INVALID_ROUTE_PARAMETER", httpStatus: 400 });
});
