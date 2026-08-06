import { createAppError, PAYLOAD_TOO_LARGE, INVALID_JSON } from "./error-codes.js";

export const JSON_BODY_LIMIT = 2 * 1024 * 1024;

export function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

export async function readBody(request, { limit = JSON_BODY_LIMIT } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw createAppError(PAYLOAD_TOO_LARGE, {
        message: `请求内容超过 ${Math.round(limit / 1024 / 1024)} MB 限制`,
      });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(request, options) {
  const body = await readBody(request, options);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw createAppError(INVALID_JSON, { message: "请求 JSON 格式无效" });
  }
}
