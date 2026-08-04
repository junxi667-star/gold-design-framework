import { randomUUID } from "node:crypto";

const BODY_LIMIT = 2 * 1024 * 1024;

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      const error = new Error("请求内容超过 2 MB 限制");
      error.code = "PAYLOAD_TOO_LARGE";
      error.httpStatus = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("请求 JSON 格式无效");
    error.code = "INVALID_JSON";
    error.httpStatus = 400;
    throw error;
  }
}

function requestBaseUrl(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(request.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const protocol = forwardedProto || "http";
  const host = forwardedHost || request.headers.host || "127.0.0.1:4173";
  return `${protocol}://${host}`;
}

function clientId(request) {
  return String(request.headers["cf-connecting-ip"] || request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

class MutationGuard {
  constructor() {
    this.accessCode = String(process.env.DEMO_ACCESS_CODE || "").trim();
    this.hourlyLimit = Math.max(1, Number(process.env.DEMO_GENERATION_LIMIT_PER_HOUR || 10));
    this.generationHits = new Map();
  }

  requireCode(request) {
    if (!this.accessCode) return;
    const provided = String(request.headers["x-demo-access-code"] || "");
    if (provided !== this.accessCode) {
      const error = new Error("演示访问码错误");
      error.code = "INVALID_DEMO_ACCESS_CODE";
      error.httpStatus = 401;
      throw error;
    }
  }

  requireGenerationQuota(request) {
    const key = clientId(request);
    const now = Date.now();
    const cutoff = now - 60 * 60 * 1000;
    const entries = (this.generationHits.get(key) || []).filter((time) => time >= cutoff);
    if (entries.length >= this.hourlyLimit) {
      const error = new Error(`当前设备每小时最多生成 ${this.hourlyLimit} 次，请稍后再试`);
      error.code = "GENERATION_RATE_LIMITED";
      error.httpStatus = 429;
      error.retryable = true;
      throw error;
    }
    entries.push(now);
    this.generationHits.set(key, entries);
  }
}

function errorBody(error) {
  return {
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: error.httpStatus ? error.message : "服务发生未处理错误",
      retryable: Boolean(error.retryable),
      details: error.httpStatus ? error.details ?? null : null,
      requestId: randomUUID(),
    },
  };
}

export function createApiRouter(agent, chainService, taskBroker) {
  const guard = new MutationGuard();
  return async function routeApi(request, response, url) {
    const method = request.method || "GET";
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/")) return false;

    try {
      if (method === "GET" && pathname === "/api/health") {
        sendJson(response, 200, {
          data: {
            status: "ok",
            service: "jewelchain-studio",
            version: "1.3.0",
            timestamp: new Date().toISOString(),
          },
        });
        return true;
      }
      if (method === "GET" && pathname === "/api/hackathon/config") {
        const config = await agent.config();
        const workerStatus = taskBroker ? await taskBroker.status() : null;
        sendJson(response, 200, {
          data: {
            ...config,
            workerStatus,
            demoAccessCodeRequired: Boolean(guard.accessCode),
            generationLimitPerHour: guard.hourlyLimit,
          },
        });
        return true;
      }
      if (method === "GET" && pathname === "/api/hackathon/chain/status") {
        sendJson(response, 200, { data: await chainService.status() });
        return true;
      }
      if (method === "POST" && pathname === "/api/hackathon/designs") {
        guard.requireCode(request);
        guard.requireGenerationQuota(request);
        sendJson(response, 202, { data: await agent.createDesign(await readJson(request)) });
        return true;
      }
      const revisionMatch = pathname.match(/^\/api\/hackathon\/designs\/([^/]+)\/revisions$/);
      if (method === "POST" && revisionMatch) {
        guard.requireCode(request);
        guard.requireGenerationQuota(request);
        sendJson(response, 202, { data: await agent.reviseDesign(decodeURIComponent(revisionMatch[1]), await readJson(request)) });
        return true;
      }
      const designMatch = pathname.match(/^\/api\/hackathon\/designs\/([^/]+)$/);
      if (method === "GET" && designMatch) {
        sendJson(response, 200, { data: await agent.getProject(decodeURIComponent(designMatch[1])) });
        return true;
      }
      const timelineMatch = pathname.match(/^\/api\/hackathon\/designs\/([^/]+)\/timeline$/);
      if (method === "GET" && timelineMatch) {
        sendJson(response, 200, { data: await agent.timeline(decodeURIComponent(timelineMatch[1])) });
        return true;
      }
      const certificateMatch = pathname.match(/^\/api\/hackathon\/designs\/([^/]+)\/certificate$/);
      if (method === "GET" && certificateMatch) {
        sendJson(response, 200, { data: await agent.certificate(decodeURIComponent(certificateMatch[1])) });
        return true;
      }
      const jobMatch = pathname.match(/^\/api\/hackathon\/jobs\/([^/]+)$/);
      if (method === "GET" && jobMatch) {
        sendJson(response, 200, { data: await agent.getJob(decodeURIComponent(jobMatch[1])) });
        return true;
      }
      const prepareRegistration = pathname.match(/^\/api\/hackathon\/versions\/([^/]+)\/prepare-registration$/);
      if (method === "POST" && prepareRegistration) {
        guard.requireCode(request);
        const body = await readJson(request);
        sendJson(response, 200, {
          data: await agent.prepareRegistration(decodeURIComponent(prepareRegistration[1]), {
            ...body,
            baseUrl: requestBaseUrl(request),
          }),
        });
        return true;
      }
      const prepareFinalize = pathname.match(/^\/api\/hackathon\/versions\/([^/]+)\/prepare-finalize$/);
      if (method === "POST" && prepareFinalize) {
        guard.requireCode(request);
        sendJson(response, 200, { data: await agent.prepareFinalize(decodeURIComponent(prepareFinalize[1]), await readJson(request)) });
        return true;
      }
      const submissionMatch = pathname.match(/^\/api\/hackathon\/versions\/([^/]+)\/chain-submission$/);
      if (method === "POST" && submissionMatch) {
        guard.requireCode(request);
        sendJson(response, 202, { data: await agent.recordSubmission(decodeURIComponent(submissionMatch[1]), await readJson(request)) });
        return true;
      }
      const chainStatusMatch = pathname.match(/^\/api\/hackathon\/versions\/([^/]+)\/chain-status$/);
      if (method === "GET" && chainStatusMatch) {
        const kind = url.searchParams.get("kind") === "finalize" ? "finalize" : "register";
        sendJson(response, 200, { data: await agent.getChainStatus(decodeURIComponent(chainStatusMatch[1]), kind) });
        return true;
      }
      if (method === "POST" && pathname === "/api/hackathon/agent/query") {
        const body = await readJson(request);
        sendJson(response, 200, { data: await agent.answerQuestion(body.projectId, body.question) });
        return true;
      }

      sendJson(response, 404, { error: { code: "API_ROUTE_NOT_FOUND", message: "接口不存在", retryable: false } });
      return true;
    } catch (error) {
      sendJson(response, error.httpStatus || 500, errorBody(error));
      return true;
    }
  };
}
