import assert from "node:assert/strict";
import test from "node:test";

import { createApiRouter } from "../backend/api-router.js";

function makeRequest({ method = "GET", pathname = "/", headers = {}, body = null, remoteAddress = "127.0.0.1" } = {}) {
  const request = {
    method,
    headers: { host: "127.0.0.1:4173", ...headers },
    socket: { remoteAddress },
    [Symbol.asyncIterator]() {
      const chunks = body === null ? [] : [Buffer.from(JSON.stringify(body))];
      let index = 0;
      return {
        next: async () => (index < chunks.length ? { value: chunks[index++], done: false } : { done: true }),
      };
    },
  };
  return request;
}

function makeResponse() {
  return {
    statusCode: null,
    body: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

function parseResponse(response) {
  return JSON.parse(response.body);
}

test("browser API rejects a wrong demo access code with INVALID_DEMO_ACCESS_CODE", async () => {
  const oldCode = process.env.DEMO_ACCESS_CODE;
  process.env.DEMO_ACCESS_CODE = "secret-123";
  try {
    const routeApi = createApiRouter(
      { config: async () => ({}), createDesign: async () => ({}) },
      { status: async () => ({}) },
      null,
    );
    const response = makeResponse();
    await routeApi(makeRequest({
      method: "POST",
      pathname: "/api/hackathon/designs",
      headers: { "x-demo-access-code": "wrong" },
      body: { customerText: "设计一款新中式黄金戒指" },
    }), response, new URL("http://127.0.0.1:4173/api/hackathon/designs"));
    assert.equal(response.statusCode, 401);
    assert.equal(parseResponse(response).error.code, "INVALID_DEMO_ACCESS_CODE");
  } finally {
    if (oldCode === undefined) delete process.env.DEMO_ACCESS_CODE;
    else process.env.DEMO_ACCESS_CODE = oldCode;
  }
});

test("browser API returns API_ROUTE_NOT_FOUND for unknown routes", async () => {
  const routeApi = createApiRouter(
    { config: async () => ({}) },
    { status: async () => ({}) },
    null,
  );
  const response = makeResponse();
  await routeApi(makeRequest({ pathname: "/api/hackathon/nonexistent" }), response, new URL("http://127.0.0.1:4173/api/hackathon/nonexistent"));
  assert.equal(response.statusCode, 404);
  assert.equal(parseResponse(response).error.code, "API_ROUTE_NOT_FOUND");
});

test("health endpoint reports service version", async () => {
  const routeApi = createApiRouter(
    { config: async () => ({}) },
    { status: async () => ({}) },
    null,
  );
  const response = makeResponse();
  await routeApi(makeRequest({ pathname: "/api/health" }), response, new URL("http://127.0.0.1:4173/api/health"));
  assert.equal(response.statusCode, 200);
  assert.equal(parseResponse(response).data.service, "jewelchain-studio");
  assert.equal(parseResponse(response).data.version, "1.3.1");
});

test("DEMO_PROTECT_READS=true requires access code on read endpoints", async () => {
  const oldCode = process.env.DEMO_ACCESS_CODE;
  const oldProtect = process.env.DEMO_PROTECT_READS;
  process.env.DEMO_ACCESS_CODE = "secret-123";
  process.env.DEMO_PROTECT_READS = "true";
  try {
    const routeApi = createApiRouter(
      { config: async () => ({}), getProject: async () => ({ id: "p1" }) },
      { status: async () => ({}) },
      null,
    );
    const response = makeResponse();
    await routeApi(makeRequest({ pathname: "/api/hackathon/designs/p1" }), response, new URL("http://127.0.0.1:4173/api/hackathon/designs/p1"));
    assert.equal(response.statusCode, 401);
    assert.equal(parseResponse(response).error.code, "INVALID_DEMO_ACCESS_CODE");
  } finally {
    if (oldCode === undefined) delete process.env.DEMO_ACCESS_CODE;
    else process.env.DEMO_ACCESS_CODE = oldCode;
    if (oldProtect === undefined) delete process.env.DEMO_PROTECT_READS;
    else process.env.DEMO_PROTECT_READS = oldProtect;
  }
});

test("DEMO_PROTECT_READS unset keeps read endpoints open", async () => {
  const oldCode = process.env.DEMO_ACCESS_CODE;
  const oldProtect = process.env.DEMO_PROTECT_READS;
  process.env.DEMO_ACCESS_CODE = "secret-123";
  delete process.env.DEMO_PROTECT_READS;
  try {
    const routeApi = createApiRouter(
      { config: async () => ({}), getProject: async () => ({ id: "p1" }) },
      { status: async () => ({}) },
      null,
    );
    const response = makeResponse();
    await routeApi(makeRequest({ pathname: "/api/hackathon/designs/p1" }), response, new URL("http://127.0.0.1:4173/api/hackathon/designs/p1"));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(parseResponse(response).data, { id: "p1" });
  } finally {
    if (oldCode === undefined) delete process.env.DEMO_ACCESS_CODE;
    else process.env.DEMO_ACCESS_CODE = oldCode;
    if (oldProtect === undefined) delete process.env.DEMO_PROTECT_READS;
    else process.env.DEMO_PROTECT_READS = oldProtect;
  }
});
