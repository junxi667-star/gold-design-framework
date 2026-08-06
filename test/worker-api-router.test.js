import assert from "node:assert/strict";
import test from "node:test";

import { createWorkerApiRouter } from "../backend/worker-api-router.js";

function makeRequest({ method = "GET", pathname = "/", headers = {}, body = null } = {}) {
  const request = {
    method,
    headers: { host: "127.0.0.1:4173", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
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

test("worker API requires WORKER_TOKEN to be configured", async () => {
  const oldToken = process.env.WORKER_TOKEN;
  delete process.env.WORKER_TOKEN;
  try {
    const routeWorkerApi = createWorkerApiRouter({ status: async () => ({}) });
    const response = makeResponse();
    await routeWorkerApi(makeRequest({
      pathname: "/api/v1/workers/register",
      method: "POST",
      headers: { authorization: "Bearer anything" },
      body: { workerId: "w1", capabilities: ["seedream"] },
    }), response, new URL("http://127.0.0.1:4173/api/v1/workers/register"));
    assert.equal(response.statusCode, 503);
    assert.equal(parseResponse(response).error.code, "WORKER_TOKEN_NOT_CONFIGURED");
  } finally {
    if (oldToken === undefined) delete process.env.WORKER_TOKEN;
    else process.env.WORKER_TOKEN = oldToken;
  }
});

test("worker API rejects missing bearer token with WORKER_UNAUTHORIZED", async () => {
  const oldToken = process.env.WORKER_TOKEN;
  process.env.WORKER_TOKEN = "test-token-123456";
  try {
    const routeWorkerApi = createWorkerApiRouter({ status: async () => ({}) });
    const response = makeResponse();
    await routeWorkerApi(makeRequest({
      pathname: "/api/v1/workers/heartbeat",
      method: "POST",
      headers: { "x-worker-id": "w1" },
      body: { runningTasks: 0 },
    }), response, new URL("http://127.0.0.1:4173/api/v1/workers/heartbeat"));
    assert.equal(response.statusCode, 401);
    assert.equal(parseResponse(response).error.code, "WORKER_UNAUTHORIZED");
  } finally {
    if (oldToken === undefined) delete process.env.WORKER_TOKEN;
    else process.env.WORKER_TOKEN = oldToken;
  }
});

test("worker API returns WORKER_ROUTE_NOT_FOUND for unknown paths", async () => {
  const oldToken = process.env.WORKER_TOKEN;
  process.env.WORKER_TOKEN = "test-token-123456";
  try {
    const routeWorkerApi = createWorkerApiRouter({ status: async () => ({}) });
    const response = makeResponse();
    await routeWorkerApi(makeRequest({
      pathname: "/api/v1/workers/unknown",
      headers: {
        authorization: "Bearer test-token-123456",
        "x-worker-id": "w1",
      },
    }), response, new URL("http://127.0.0.1:4173/api/v1/workers/unknown"));
    assert.equal(response.statusCode, 404);
    assert.equal(parseResponse(response).error.code, "WORKER_ROUTE_NOT_FOUND");
  } finally {
    if (oldToken === undefined) delete process.env.WORKER_TOKEN;
    else process.env.WORKER_TOKEN = oldToken;
  }
});
