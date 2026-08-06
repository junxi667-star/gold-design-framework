import { randomUUID } from "node:crypto";

import { decodeRouteParam, resolvePublicBaseUrl } from "./http/request-utils.js";

import { readJson, sendJson } from "./http-utils.js";
import { createAppError, INVALID_DEMO_ACCESS_CODE, GENERATION_RATE_LIMITED, API_ROUTE_NOT_FOUND, INTERNAL_ERROR } from "./error-codes.js";

function clientId(request) {
  return String(request.headers["cf-connecting-ip"] || request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

class MutationGuard {
  constructor() {
    this.accessCode = String(process.env.DEMO_ACCESS_CODE || "").trim();
    this.hourlyLimit = Math.max(1, Number(process.env.DEMO_GENERATION_LIMIT_PER_HOUR || 10));
    this.protectReads = String(process.env.DEMO_PROTECT_READS || "").toLowerCase() === "true";
    this.generationHits = new Map();
  }

  requireCode(request) {
    if (!this.accessCode) return;
    const provided = String(request.headers["x-demo-access-code"] || "");
    if (provided !== this.accessCode) {
      throw createAppError(INVALID_DEMO_ACCESS_CODE, { message: "演示访问码错误" });
    }
  }

  requireReadCode(request) {
    if (!this.protectReads) return;
    this.requireCode(request);
  }

  requireGenerationQuota(request) {
    const key = clientId(request);
    const now = Date.now();
    const cutoff = now - 60 * 60 * 1000;
    const entries = (this.generationHits.get(key) || []).filter((time) => time >= cutoff);
    if (entries.length >= this.hourlyLimit) {
      throw createAppError(GENERATION_RATE_LIMITED, {
        message: `当前设备每小时最多生成 ${this.hourlyLimit} 次，请稍后再试`,
      });
    }
    entries.push(now);
    this.generationHits.set(key, entries);
  }
}

function errorBody(error) {
  return {
    error: {
      code: error.code || INTERNAL_ERROR,
      message: error.httpStatus ? error.message : "服务发生未处理错误",
      retryable: Boolean(error.retryable),
      details: error.httpStatus ? error.details ?? null : null,
      requestId: randomUUID(),
    },
  };
}

export function createApiRouter(agent, chainService, taskBroker, { publicBaseUrl } = {}) {
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
            version: "1.3.1",
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
        sendJson(response, 202, { data: await agent.reviseDesign(decodeRouteParam(revisionMatch[1]), await readJson(request)) });
        return true;
      }
      const designMatch = pathname.match(/^\/api\/hackathon\/designs\/([^/]+)$/);
      if (method === "GET" && designMatch) {
        guard.requireReadCode(request);
        sendJson(response, 200, { data: await agent.getProject(decodeRouteParam(designMatch[1])) });
        return true;
      }
      const timelineMatch = pathname.match(/^\/api\/hackathon\/designs\/([^/]+)\/timeline$/);
      if (method === "GET" && timelineMatch) {
        guard.requireReadCode(request);
        sendJson(response, 200, { data: await agent.timeline(decodeRouteParam(timelineMatch[1])) });
        return true;
      }
      const certificateMatch = pathname.match(/^\/api\/hackathon\/designs\/([^/]+)\/certificate$/);
      if (method === "GET" && certificateMatch) {
        guard.requireReadCode(request);
        sendJson(response, 200, { data: await agent.certificate(decodeRouteParam(certificateMatch[1])) });
        return true;
      }
      const jobMatch = pathname.match(/^\/api\/hackathon\/jobs\/([^/]+)$/);
      if (method === "GET" && jobMatch) {
        guard.requireReadCode(request);
        sendJson(response, 200, { data: await agent.getJob(decodeRouteParam(jobMatch[1])) });
        return true;
      }
      const prepareRegistration = pathname.match(/^\/api\/hackathon\/versions\/([^/]+)\/prepare-registration$/);
      if (method === "POST" && prepareRegistration) {
        guard.requireCode(request);
        const body = await readJson(request);
        sendJson(response, 200, {
          data: await agent.prepareRegistration(decodeRouteParam(prepareRegistration[1]), {
            ...body,
            baseUrl: resolvePublicBaseUrl(request, { publicBaseUrl }),
          }),
        });
        return true;
      }
      const prepareFinalize = pathname.match(/^\/api\/hackathon\/versions\/([^/]+)\/prepare-finalize$/);
      if (method === "POST" && prepareFinalize) {
        guard.requireCode(request);
        sendJson(response, 200, { data: await agent.prepareFinalize(decodeRouteParam(prepareFinalize[1]), await readJson(request)) });
        return true;
      }
      const submissionMatch = pathname.match(/^\/api\/hackathon\/versions\/([^/]+)\/chain-submission$/);
      if (method === "POST" && submissionMatch) {
        guard.requireCode(request);
        sendJson(response, 202, { data: await agent.recordSubmission(decodeRouteParam(submissionMatch[1]), await readJson(request)) });
        return true;
      }
      const chainStatusMatch = pathname.match(/^\/api\/hackathon\/versions\/([^/]+)\/chain-status$/);
      if (method === "GET" && chainStatusMatch) {
        guard.requireReadCode(request);
        const kind = url.searchParams.get("kind") === "finalize" ? "finalize" : "register";
        sendJson(response, 200, { data: await agent.getChainStatus(decodeRouteParam(chainStatusMatch[1]), kind) });
        return true;
      }
      if (method === "POST" && pathname === "/api/hackathon/agent/query") {
        guard.requireReadCode(request);
        const body = await readJson(request);
        sendJson(response, 200, { data: await agent.answerQuestion(body.projectId, body.question) });
        return true;
      }

      sendJson(response, 404, { error: { code: API_ROUTE_NOT_FOUND, message: "接口不存在", retryable: false } });
      return true;
    } catch (error) {
      sendJson(response, error.httpStatus || 500, errorBody(error));
      return true;
    }
  };
}
