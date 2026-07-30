import { randomUUID } from "node:crypto";

import { apiError, fingerprint, iso, text } from "./utils.js";

const BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const CONTRACT_VERSION = "1.2";

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const requestId = randomUUID();
  const normalized = payload?.data !== undefined
    ? {
      ...payload,
      meta: {
        requestId,
        contractVersion: CONTRACT_VERSION,
        ...(payload.meta || {}),
      },
    }
    : payload?.error
      ? { error: { ...payload.error, requestId } }
      : payload;
  const body = JSON.stringify(normalized);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) {
      throw apiError("请求内容超过 2 MB 限制", {
        code: "PAYLOAD_TOO_LARGE",
        httpStatus: 413,
      });
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw apiError("请求 JSON 格式无效", {
      code: "INVALID_JSON",
      httpStatus: 400,
    });
  }
}

function errorPayload(error) {
  const known = Number.isInteger(error.httpStatus);
  return {
    error: {
      code: known ? error.code || "REQUEST_FAILED" : "INTERNAL_ERROR",
      message: known ? error.message : "本地后端发生未处理错误",
      retryable: known ? Boolean(error.retryable) : false,
      details: known ? error.details ?? null : null,
    },
  };
}

function idempotencyKey(request) {
  const key = text(request.headers["idempotency-key"]);
  if (!key) return "";
  if (key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw apiError("Idempotency-Key 格式无效", {
      code: "INVALID_IDEMPOTENCY_KEY",
      httpStatus: 400,
    });
  }
  return key;
}

export function createApiRouter(aiService, {
  web3Service = null,
  monadTestnetReadService = null,
} = {}) {
  let idempotencyQueue = Promise.resolve();

  function runIdempotent(request, scope, body, action) {
    const key = idempotencyKey(request);
    if (!key) return action();
    const requestFingerprint = fingerprint({ scope, body });
    const execute = async () => {
      const existing = await aiService.getIdempotencyRecord(key);
      if (existing) {
        if (existing.scope !== scope || existing.fingerprint !== requestFingerprint) {
          throw apiError("同一 Idempotency-Key 已用于不同请求", {
            code: "IDEMPOTENCY_CONFLICT",
            httpStatus: 409,
            details: { originalScope: existing.scope, requestedScope: scope },
          });
        }
        return {
          statusCode: existing.statusCode,
          data: existing.data,
          replayed: true,
        };
      }
      const outcome = await action();
      await aiService.saveIdempotencyRecord(key, {
        scope,
        fingerprint: requestFingerprint,
        statusCode: outcome.statusCode,
        data: outcome.data,
        createdAt: iso(),
      });
      return { ...outcome, replayed: false };
    };
    const operation = idempotencyQueue.then(execute, execute);
    idempotencyQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return async function routeApi(request, response, url) {
    const method = request.method || "GET";
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/")) return false;

    try {
      if (method === "GET" && pathname === "/api/health") {
        sendJson(response, 200, {
          data: {
            status: "ok",
            service: "gold-ai-local-backend",
            version: "0.5.0",
            timestamp: new Date().toISOString(),
            capabilities: await aiService.getCapabilities(),
          },
        });
        return true;
      }
      if (method === "GET" && pathname === "/api/ai/capabilities") {
        sendJson(response, 200, { data: await aiService.getCapabilities() });
        return true;
      }
      if (method === "GET" && pathname === "/api/ai/models") {
        sendJson(response, 200, { data: { items: await aiService.listModels() } });
        return true;
      }
      if (method === "GET" && pathname === "/api/ai/providers/status") {
        sendJson(response, 200, { data: await aiService.getProviderStatus() });
        return true;
      }
      if (method === "GET" && pathname === "/api/ai/prompt-templates") {
        sendJson(response, 200, { data: { items: await aiService.listPromptTemplates() } });
        return true;
      }
      if (method === "GET" && pathname === "/api/ai/prompt-templates/current") {
        sendJson(response, 200, { data: await aiService.getPublishedPrompt() });
        return true;
      }
      if (method === "GET" && pathname === "/api/ai/requirements/status") {
        sendJson(response, 200, { data: aiService.getRequirementParserStatus() });
        return true;
      }
      if (method === "GET" && pathname === "/api/ai/requirements/schema") {
        sendJson(response, 200, { data: aiService.getRequirementSchema() });
        return true;
      }
      if (method === "GET" && pathname === "/api/ai/requirements/evaluation-cases") {
        sendJson(response, 200, { data: { items: aiService.getRequirementEvaluationCases() } });
        return true;
      }
      if (method === "GET" && pathname === "/api/web3/config" && web3Service) {
        sendJson(response, 200, { data: await web3Service.getConfig() });
        return true;
      }
      if (
        method === "GET"
        && pathname === "/api/web3/monad-testnet/evidence"
        && monadTestnetReadService
      ) {
        if ([...url.searchParams.keys()].length) {
          throw apiError("Monad Testnet 证据接口不接受查询参数", {
            code: "MONAD_TESTNET_EVIDENCE_PARAMS_REJECTED",
            httpStatus: 400,
          });
        }
        sendJson(response, 200, {
          data: await monadTestnetReadService.getEvidence(),
        });
        return true;
      }

      const taskMatch = pathname.match(/^\/api\/ai\/tasks\/([^/]+)$/);
      if (method === "GET" && taskMatch) {
        sendJson(response, 200, { data: await aiService.getTask(decodeURIComponent(taskMatch[1])) });
        return true;
      }
      const requirementDetailMatch = pathname.match(/^\/api\/projects\/([^/]+)\/requirements\/([^/]+)$/);
      if (method === "GET" && requirementDetailMatch) {
        sendJson(response, 200, {
          data: await aiService.getProjectRequirement(
            decodeURIComponent(requirementDetailMatch[1]),
            decodeURIComponent(requirementDetailMatch[2]),
          ),
        });
        return true;
      }
      const requirementsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/requirements$/);
      if (method === "GET" && requirementsMatch) {
        sendJson(response, 200, {
          data: { items: await aiService.listProjectRequirements(decodeURIComponent(requirementsMatch[1])) },
        });
        return true;
      }
      const versionsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/versions$/);
      if (method === "GET" && versionsMatch) {
        sendJson(response, 200, {
          data: { items: await aiService.listProjectVersions(decodeURIComponent(versionsMatch[1])) },
        });
        return true;
      }
      const chainTimelineMatch = pathname.match(
        /^\/api\/projects\/([^/]+)\/chain-timeline$/,
      );
      if (method === "GET" && chainTimelineMatch && web3Service) {
        sendJson(response, 200, {
          data: await web3Service.getProjectTimeline(
            decodeURIComponent(chainTimelineMatch[1]),
          ),
        });
        return true;
      }

      if (method !== "POST") {
        sendJson(response, 404, {
          error: {
            code: "API_ROUTE_NOT_FOUND",
            message: "接口不存在",
            retryable: false,
            details: { method, pathname },
          },
        });
        return true;
      }

      const body = await readJson(request);
      let action = null;
      let statusCode = 200;

      if (pathname === "/api/ai/requirements/parse") {
        action = () => aiService.parseRequirements(body);
      } else if (pathname === "/api/ai/requirements/evaluate") {
        action = () => aiService.evaluateRequirementParser(body);
      } else if (pathname === "/api/ai/generations") {
        statusCode = 202;
        action = () => aiService.createGeneration(body);
      } else if (pathname === "/api/ai/prompt-templates") {
        statusCode = 201;
        action = () => aiService.createPromptVersion(body);
      } else if (pathname === "/api/ai/prompt-templates/compare") {
        action = () => aiService.comparePromptVersions(body.leftVersionId, body.rightVersionId);
      } else if (pathname === "/api/knowledge/search") {
        action = () => ({ items: aiService.searchApprovedKnowledge(body) });
      } else if (pathname === "/api/web3/registrations/prepare" && web3Service) {
        statusCode = 201;
        action = () => web3Service.prepareRegistration(body);
      }

      const cancelMatch = pathname.match(/^\/api\/ai\/tasks\/([^/]+)\/cancel$/);
      if (cancelMatch) action = () => aiService.cancelTask(decodeURIComponent(cancelMatch[1]));
      const retryMatch = pathname.match(/^\/api\/ai\/tasks\/([^/]+)\/retry$/);
      if (retryMatch) {
        statusCode = 202;
        action = () => aiService.retryTask(decodeURIComponent(retryMatch[1]), body);
      }
      const refineMatch = pathname.match(/^\/api\/ai\/generations\/([^/]+)\/refine$/);
      if (refineMatch) {
        statusCode = 202;
        action = () => aiService.refineGeneration(decodeURIComponent(refineMatch[1]), body);
      }
      const feedbackMatch = pathname.match(/^\/api\/ai\/results\/([^/]+)\/feedback$/);
      if (feedbackMatch) {
        statusCode = 201;
        action = () => aiService.submitFeedback(decodeURIComponent(feedbackMatch[1]), body);
      }
      const requirementConfirmMatch = pathname.match(/^\/api\/projects\/([^/]+)\/requirements\/([^/]+)\/confirm$/);
      if (requirementConfirmMatch) {
        action = () => aiService.confirmProjectRequirement(
          decodeURIComponent(requirementConfirmMatch[1]),
          decodeURIComponent(requirementConfirmMatch[2]),
          body,
        );
      } else if (requirementsMatch) {
        statusCode = 201;
        action = () => aiService.createRequirementRevision(
          decodeURIComponent(requirementsMatch[1]),
          body,
        );
      }
      const publishMatch = pathname.match(/^\/api\/ai\/prompt-templates\/([^/]+)\/publish$/);
      if (publishMatch) {
        action = () => aiService.publishPromptVersion(decodeURIComponent(publishMatch[1]), body);
      }
      const versionConfirmMatch = pathname.match(
        /^\/api\/projects\/([^/]+)\/versions\/([^/]+)\/confirm$/,
      );
      if (versionConfirmMatch && web3Service) {
        statusCode = 201;
        action = () => web3Service.confirmProjectVersion(
          decodeURIComponent(versionConfirmMatch[1]),
          decodeURIComponent(versionConfirmMatch[2]),
          body,
        );
      }
      const localSubmitMatch = pathname.match(
        /^\/api\/web3\/registrations\/([^/]+)\/submit-local$/,
      );
      if (localSubmitMatch && web3Service) {
        action = () => web3Service.submitLocal(
          decodeURIComponent(localSubmitMatch[1]),
          body,
        );
      }
      const registrationVerifyMatch = pathname.match(
        /^\/api\/web3\/registrations\/([^/]+)\/verify$/,
      );
      if (registrationVerifyMatch && web3Service) {
        action = () => web3Service.verifyRegistration(
          decodeURIComponent(registrationVerifyMatch[1]),
          body,
        );
      }

      if (!action) {
        sendJson(response, 404, {
          error: {
            code: "API_ROUTE_NOT_FOUND",
            message: "接口不存在",
            retryable: false,
            details: { method, pathname },
          },
        });
        return true;
      }

      const scope = `${method} ${pathname}`;
      const outcome = await runIdempotent(request, scope, body, async () => ({
        statusCode,
        data: await action(),
      }));
      sendJson(
        response,
        outcome.statusCode,
        { data: outcome.data },
        outcome.replayed ? { "Idempotency-Replayed": "true" } : {},
      );
      return true;
    } catch (error) {
      sendJson(response, error.httpStatus || 500, errorPayload(error));
      return true;
    }
  };
}
