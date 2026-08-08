function apiBaseUrl() {
  const runtimeConfig = typeof window === "undefined" ? {} : window.JEWELCHAIN_CONFIG || {};
  return String(runtimeConfig.apiBaseUrl || "").replace(/\/+$/, "");
}

function toUrlList(value, fallback) {
  const values = Array.isArray(value) ? value : value ? [value] : fallback ? [fallback] : [];
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function toChainIdHex(value) {
  if (typeof value === "string" && /^0x[\da-f]+$/i.test(value)) return value.toLowerCase();
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return `0x${value.toString(16)}`;
  return "";
}

// Go exposes compact scalar chain settings; the prior Master exposes the EIP-3085
// shape directly. Normalize once here so React components only consume one contract.
export function normalizeHackathonConfig(value) {
  if (!value || typeof value !== "object" || !value.chain || typeof value.chain !== "object") return value;
  const chain = value.chain;
  const chainIdHex = chain.chainIdHex || toChainIdHex(chain.chainId);
  const chainId = Number.isSafeInteger(chain.chainId) ? chain.chainId : Number.parseInt(chainIdHex, 16);
  const rpcUrls = toUrlList(chain.rpcUrls, chain.rpcUrl);
  const blockExplorerUrls = toUrlList(chain.blockExplorerUrls, chain.explorerUrl);
  return {
    ...value,
    chain: {
      ...chain,
      chainId,
      chainIdHex,
      chainName: chain.chainName || (chainId === 10143 ? "Monad Testnet" : "Monad"),
      nativeCurrency: chain.nativeCurrency || { name: "MON", symbol: "MON", decimals: 18 },
      rpcUrls,
      blockExplorerUrls,
    },
  };
}

export class ApiRequestError extends Error {
  constructor(message, { code, details, requestId, retryable, status, cause } = {}) {
    super(message, { cause });
    this.name = "ApiRequestError";
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.retryable = retryable;
    this.status = status;
  }
}

export function resolveApiUrl(pathname) {
  const value = String(pathname || "");
  if (/^https?:\/\//i.test(value)) return value;
  const normalized = value.startsWith("/") ? value : `/${value}`;
  const baseUrl = apiBaseUrl();
  return baseUrl ? `${baseUrl}${normalized}` : normalized;
}

export function resolveAssetUrl(value) {
  const raw = String(value || "");
  if (!raw || /^(https?:|data:|blob:)/i.test(raw)) return raw;
  return resolveApiUrl(raw);
}

export async function request(path, { accessCode, method = "GET", body, timeoutMs = 30_000, signal } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (accessCode) headers["X-Demo-Access-Code"] = accessCode;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  const fetchOptions = {
    method,
    headers,
    mode: "cors",
    signal: controller.signal,
  };
  if (body !== undefined && method !== "GET") {
    fetchOptions.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(resolveApiUrl(path), fetchOptions);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ApiRequestError(`Master（调度服务）响应超时（${Math.round(timeoutMs / 1000)}s）。网站仍可浏览，请稍后重试。`, { cause: error });
    }
    const target = apiBaseUrl() || "当前域名";
    throw new ApiRequestError(`Master（调度服务）暂时离线（${target}）。网站仍可浏览，实时生图与 Agent 功能将在服务恢复后可用。`, { cause: error });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }

  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { error: { message: raw || `HTTP ${response.status}` } };
  }
  const responseRequestId = response.headers.get("X-Request-Id") || payload?.error?.requestId;
  if (!response.ok) {
    throw new ApiRequestError(payload?.error?.message || `请求失败（HTTP ${response.status}）`, {
      code: payload?.error?.code,
      details: payload?.error?.details,
      requestId: responseRequestId,
      retryable: payload?.error?.retryable,
      status: response.status,
    });
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "data")) {
    throw new ApiRequestError("Master（调度服务）返回了无效响应格式，请稍后重试。", {
      code: "INVALID_API_RESPONSE",
      requestId: responseRequestId,
      status: response.status,
    });
  }
  return payload.data;
}
