import { createAppError, INVALID_PUBLIC_BASE_URL, INVALID_ROUTE_PARAMETER, PUBLIC_BASE_URL_REQUIRED } from "../error-codes.js";

function normalizeConfiguredPublicBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw createAppError(INVALID_PUBLIC_BASE_URL, { message: "PUBLIC_BASE_URL 必须是完整的 http(s) URL" });
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
    throw createAppError(INVALID_PUBLIC_BASE_URL, { message: "PUBLIC_BASE_URL 仅支持不含凭据的 http(s) URL" });
  }
  return parsed.origin;
}

function isLoopbackOrigin(origin) {
  return ["localhost", "127.0.0.1", "::1"].includes(origin.hostname);
}

export function decodeRouteParam(value) {
  try {
    return decodeURIComponent(String(value));
  } catch {
    throw createAppError(INVALID_ROUTE_PARAMETER, { message: "请求路径参数编码无效" });
  }
}

export function resolvePublicBaseUrl(request, { publicBaseUrl } = {}) {
  const configured = normalizeConfiguredPublicBaseUrl(publicBaseUrl);
  if (configured) return configured;

  const host = String(request.headers.host || "").trim();
  try {
    const localOrigin = new URL(`http://${host}`);
    if (isLoopbackOrigin(localOrigin)) return localOrigin.origin;
  } catch {
    // Treat malformed Host headers exactly like other unconfigured public origins.
  }

  throw createAppError(PUBLIC_BASE_URL_REQUIRED, { message: "非本地部署必须设置 PUBLIC_BASE_URL，避免元数据 URI 受请求 Host 影响" });
}
