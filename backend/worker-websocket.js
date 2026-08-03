import { createHash, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function encodeFrame(payload, opcode = 0x1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const header = [];
  header.push(0x80 | opcode);
  if (body.length < 126) header.push(body.length);
  else if (body.length <= 0xffff) header.push(126, (body.length >> 8) & 0xff, body.length & 0xff);
  else {
    header.push(127, 0, 0, 0, 0,
      Math.floor(body.length / 0x1000000) & 0xff,
      Math.floor(body.length / 0x10000) & 0xff,
      Math.floor(body.length / 0x100) & 0xff,
      body.length & 0xff);
  }
  return Buffer.concat([Buffer.from(header), body]);
}

class WebSocketConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    socket.on("data", (chunk) => this.consume(chunk));
    socket.on("close", () => this.close(false));
    socket.on("end", () => this.close(false));
    socket.on("error", (error) => this.emit("error", error));
  }

  sendJson(value) {
    if (!this.closed) this.socket.write(encodeFrame(JSON.stringify(value)));
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const high = this.buffer.readUInt32BE(2);
        const low = this.buffer.readUInt32BE(6);
        if (high !== 0) return this.close(true, 1009, "Frame too large");
        length = low;
        offset = 10;
      }
      const maskSize = masked ? 4 : 0;
      if (this.buffer.length < offset + maskSize + length) return;
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
      offset += maskSize;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);
      if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      if (opcode === 0x8) return this.close(true);
      if (opcode === 0x9) {
        this.socket.write(encodeFrame(payload, 0xA));
        continue;
      }
      if (opcode !== 0x1) continue;
      try { this.emit("message", JSON.parse(payload.toString("utf8"))); }
      catch { this.sendJson({ type: "server.error", code: "INVALID_JSON", message: "WebSocket 消息必须是 JSON" }); }
    }
  }

  close(sendFrame = true, code = 1000, reason = "") {
    if (this.closed) return;
    this.closed = true;
    if (sendFrame && !this.socket.destroyed) {
      const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
      payload.writeUInt16BE(code, 0);
      payload.write(reason, 2);
      this.socket.write(encodeFrame(payload, 0x8));
    }
    this.socket.end();
    this.emit("close");
  }
}

export class WorkerWebSocketHub {
  constructor({ server, taskBroker } = {}) {
    this.server = server;
    this.taskBroker = taskBroker;
    this.connections = new Map();
    this.dispatching = new Set();
    server.on("upgrade", (request, socket) => this.upgrade(request, socket));
  }

  upgrade(request, socket) {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== "/ws/worker") return socket.destroy();
    const key = request.headers["sec-websocket-key"];
    const upgrade = String(request.headers.upgrade || "").toLowerCase();
    if (!key || upgrade !== "websocket") return socket.destroy();
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"));
    const connection = new WebSocketConnection(socket);
    let workerId = null;
    let authenticated = false;
    const authTimeout = setTimeout(() => {
      if (!authenticated) connection.close(true, 1008, "Authentication timeout");
    }, 10_000);
    authTimeout.unref?.();

    connection.on("message", async (message) => {
      try {
        if (!authenticated) {
          if (message?.type !== "worker.register") throw new Error("First message must be worker.register");
          const expected = String(process.env.WORKER_TOKEN || "").trim();
          if (!expected || !safeEqual(message.token, expected)) {
            connection.sendJson({ type: "server.error", code: "WORKER_UNAUTHORIZED", message: "Image Worker 认证失败" });
            return connection.close(true, 1008, "Unauthorized");
          }
          workerId = String(message.workerId || "").trim();
          if (!workerId) throw new Error("workerId is required");
          await this.taskBroker.registerWorker({
            workerId,
            workerVersion: message.workerVersion,
            capabilities: message.capabilities,
            maxConcurrency: message.maxConcurrency,
            transport: "websocket",
            source: request.socket.remoteAddress || "unknown",
          });
          authenticated = true;
          clearTimeout(authTimeout);
          this.connections.set(workerId, connection);
          connection.sendJson({ type: "worker.registered", heartbeatIntervalMs: 30_000, leaseSeconds: this.taskBroker.leaseSeconds });
          await this.dispatchNext(workerId);
          return;
        }
        if (message?.type === "worker.heartbeat") {
          await this.taskBroker.heartbeat(workerId, { ...message, transport: "websocket" });
          connection.sendJson({ type: "server.heartbeat", timestamp: new Date().toISOString() });
          if (message.available !== false) await this.dispatchNext(workerId);
          return;
        }
        if (message?.type === "worker.ready") {
          await this.dispatchNext(workerId);
          return;
        }
      } catch (error) {
        connection.sendJson({ type: "server.error", code: error.code || "WS_MESSAGE_FAILED", message: error.message });
      }
    });
    connection.on("close", async () => {
      clearTimeout(authTimeout);
      const isCurrent = workerId && this.connections.get(workerId) === connection;
      if (isCurrent) {
        this.connections.delete(workerId);
        await this.taskBroker.markWorkerOffline(workerId).catch(() => {});
      }
    });
    connection.on("error", () => {});
  }

  async dispatchNext(workerId) {
    if (!workerId || this.dispatching.has(workerId)) return;
    const connection = this.connections.get(workerId);
    if (!connection || connection.closed) return;
    this.dispatching.add(workerId);
    try {
      const task = await this.taskBroker.claimTask(workerId);
      if (task) connection.sendJson({ type: "task.assigned", task });
    } catch (error) {
      connection.sendJson({ type: "server.error", code: error.code || "TASK_DISPATCH_FAILED", message: error.message });
    } finally {
      this.dispatching.delete(workerId);
    }
  }

  async dispatchPending(preferredWorkerId = null) {
    if (preferredWorkerId) return this.dispatchNext(preferredWorkerId);
    await Promise.all([...this.connections.keys()].map((workerId) => this.dispatchNext(workerId)));
  }
}
