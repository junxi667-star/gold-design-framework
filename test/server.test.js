import assert from "node:assert/strict";
import test from "node:test";

import { createAppServer } from "../server.js";

test("静态服务只允许同源 API 连接", async (context) => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /黄金产业 AI 智能设计框架/);
  assert.match(response.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.doesNotMatch(response.headers.get("content-security-policy"), /connect-src[^;]*https?:/);
});

test("静态服务拒绝路径越界", async (context) => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/..%2Fpackage.json`);
  assert.notEqual(response.status, 200);
});

test("便携演示服务可携带实例标识用于安全关闭", async (context) => {
  const server = createAppServer({ instanceToken: "test-instance-token" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.equal(response.headers.get("x-gold-demo-instance"), "test-instance-token");
});
