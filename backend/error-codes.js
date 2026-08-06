// backend/error-codes.js — 集中错误码注册表
// 新增错误码必须在本文件注册，不得在业务模块中使用内联字符串。

// ─── HTTP / 请求基础设施 ────────────────────────────────────
export const PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE";
export const INVALID_JSON = "INVALID_JSON";
export const INVALID_PUBLIC_BASE_URL = "INVALID_PUBLIC_BASE_URL";
export const INVALID_ROUTE_PARAMETER = "INVALID_ROUTE_PARAMETER";
export const PUBLIC_BASE_URL_REQUIRED = "PUBLIC_BASE_URL_REQUIRED";

// ─── 浏览器 API 路由 ───────────────────────────────────────
export const API_ROUTE_NOT_FOUND = "API_ROUTE_NOT_FOUND";
export const INVALID_DEMO_ACCESS_CODE = "INVALID_DEMO_ACCESS_CODE";
export const GENERATION_RATE_LIMITED = "GENERATION_RATE_LIMITED";

// ─── Worker API 认证与路由 ──────────────────────────────────
export const WORKER_TOKEN_NOT_CONFIGURED = "WORKER_TOKEN_NOT_CONFIGURED";
export const WORKER_UNAUTHORIZED = "WORKER_UNAUTHORIZED";
export const WORKER_ID_REQUIRED = "WORKER_ID_REQUIRED";
export const WORKER_ROUTE_NOT_FOUND = "WORKER_ROUTE_NOT_FOUND";

// ─── Task Broker — Worker 生命周期 ─────────────────────────
export const LEASE_EXPIRED = "LEASE_EXPIRED";
export const WORKER_NOT_REGISTERED = "WORKER_NOT_REGISTERED";
export const WORKER_WAIT_TIMEOUT = "WORKER_WAIT_TIMEOUT";
export const WORKER_NOT_ONLINE = "WORKER_NOT_ONLINE";

// ─── Task Broker — 任务租约验证 ────────────────────────────
export const WORKER_TASK_NOT_FOUND = "WORKER_TASK_NOT_FOUND";
export const WORKER_LEASE_MISMATCH = "WORKER_LEASE_MISMATCH";
export const WORKER_TASK_STATE_INVALID = "WORKER_TASK_STATE_INVALID";
export const WORKER_LEASE_EXPIRED = "WORKER_LEASE_EXPIRED";

// ─── Task Broker — 图片上传验证 ────────────────────────────
export const WORKER_UPLOAD_EMPTY = "WORKER_UPLOAD_EMPTY";
export const WORKER_UPLOAD_UNSUPPORTED_IMAGE = "WORKER_UPLOAD_UNSUPPORTED_IMAGE";
export const WORKER_UPLOAD_MIME_MISMATCH = "WORKER_UPLOAD_MIME_MISMATCH";
export const WORKER_UPLOAD_HASH_MISMATCH = "WORKER_UPLOAD_HASH_MISMATCH";
export const WORKER_UPLOAD_NOT_FOUND = "WORKER_UPLOAD_NOT_FOUND";

// ─── Task Broker — 任务执行 ────────────────────────────────
export const WORKER_TASK_FAILED = "WORKER_TASK_FAILED";
export const WORKER_EXECUTION_FAILED = "WORKER_EXECUTION_FAILED";

// ─── Agent Orchestrator — 输入验证 ─────────────────────────
export const INVALID_WALLET_ADDRESS = "INVALID_WALLET_ADDRESS";
export const INVALID_REQUIREMENT = "INVALID_REQUIREMENT";
export const INVALID_CHANGE_REQUEST = "INVALID_CHANGE_REQUEST";
export const INVALID_TX_HASH = "INVALID_TX_HASH";
export const VALIDATION_FAILED = "VALIDATION_FAILED";
export const UNSUPPORTED_PRODUCT_TEMPLATE = "UNSUPPORTED_PRODUCT_TEMPLATE";

// ─── Agent Orchestrator — 实体未找到 ───────────────────────
export const PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND";
export const PARENT_VERSION_NOT_FOUND = "PARENT_VERSION_NOT_FOUND";
export const JOB_NOT_FOUND = "JOB_NOT_FOUND";
export const VERSION_NOT_FOUND = "VERSION_NOT_FOUND";

// ─── Agent Orchestrator — 设计状态 / 链上登记 ──────────────
export const PARENT_NOT_ONCHAIN = "PARENT_NOT_ONCHAIN";
export const DESIGN_FINALIZED = "DESIGN_FINALIZED";
export const INVALID_VERSION_STATE = "INVALID_VERSION_STATE";
export const VERSION_NOT_READY = "VERSION_NOT_READY";
export const REGISTRANT_LOCKED = "REGISTRANT_LOCKED";
export const PARENT_NOT_CONFIRMED = "PARENT_NOT_CONFIRMED";
export const DESIGN_OWNER_WALLET_REQUIRED = "DESIGN_OWNER_WALLET_REQUIRED";
export const WALLET_MISMATCH = "WALLET_MISMATCH";
export const VERSION_NOT_REGISTERED = "VERSION_NOT_REGISTERED";
export const UNAUTHORIZED_FINALIZER = "UNAUTHORIZED_FINALIZER";
export const DESIGN_NOT_FINALIZED = "DESIGN_NOT_FINALIZED";

// ─── Monad Chain Service — RPC 与验证 ─────────────────────
export const RPC_UNAVAILABLE = "RPC_UNAVAILABLE";
export const RPC_REQUEST_FAILED = "RPC_REQUEST_FAILED";
export const RPC_TIMEOUT = "RPC_TIMEOUT";
export const RPC_CONNECT_FAILED = "RPC_CONNECT_FAILED";
export const CHAIN_STATUS_FAILED = "CHAIN_STATUS_FAILED";
export const TRANSACTION_REVERTED = "TRANSACTION_REVERTED";
export const WRONG_CONTRACT = "WRONG_CONTRACT";
export const EXPECTED_EVENT_NOT_FOUND = "EXPECTED_EVENT_NOT_FOUND";

// ─── Ark Image Provider (火山方舟 Seedream) ───────────────
export const ARK_NOT_CONFIGURED = "ARK_NOT_CONFIGURED";
export const ARK_INVALID_RESPONSE = "ARK_INVALID_RESPONSE";
export const ARK_REQUEST_FAILED = "ARK_REQUEST_FAILED";
export const ARK_NO_IMAGE_URL = "ARK_NO_IMAGE_URL";
export const ARK_IMAGE_DOWNLOAD_FAILED = "ARK_IMAGE_DOWNLOAD_FAILED";
export const ARK_EMPTY_IMAGE = "ARK_EMPTY_IMAGE";
export const ARK_UNSUPPORTED_IMAGE = "ARK_UNSUPPORTED_IMAGE";
export const ARK_TIMEOUT = "ARK_TIMEOUT";
export const ARK_CONNECT_FAILED = "ARK_CONNECT_FAILED";

// ─── Requirement Provider (OpenAI 兼容) ───────────────────
export const REQUIREMENT_PROVIDER_NOT_CONFIGURED = "REQUIREMENT_PROVIDER_NOT_CONFIGURED";
export const REQUIREMENT_PROVIDER_TIMEOUT = "REQUIREMENT_PROVIDER_TIMEOUT";

// ─── Storage Service (Supabase) ───────────────────────────
export const SUPABASE_REQUEST_FAILED = "SUPABASE_REQUEST_FAILED";

// ─── Worker 进程 ──────────────────────────────────────────
export const UNSUPPORTED_TASK_TYPE = "UNSUPPORTED_TASK_TYPE";
export const GENERATION_FAILED = "GENERATION_FAILED";
export const WORKER_BUSY = "WORKER_BUSY";

// ─── WebSocket 专用 ───────────────────────────────────────
export const WS_MESSAGE_FAILED = "WS_MESSAGE_FAILED";
export const TASK_DISPATCH_FAILED = "TASK_DISPATCH_FAILED";

// ─── 通用回退 ─────────────────────────────────────────────
export const INTERNAL_ERROR = "INTERNAL_ERROR";
export const HTTP_ERROR = "HTTP_ERROR";
export const AGENT_ERROR = "AGENT_ERROR";
export const TASK_BROKER_ERROR = "TASK_BROKER_ERROR";
export const WORKER_API_ERROR = "WORKER_API_ERROR";
export const CHAIN_ERROR = "CHAIN_ERROR";
export const STORAGE_ERROR = "STORAGE_ERROR";
export const REQUIREMENT_PROVIDER_FAILED = "REQUIREMENT_PROVIDER_FAILED";
export const ARK_IMAGE_PROVIDER_ERROR = "ARK_IMAGE_PROVIDER_ERROR";

// ═══════════════════════════════════════════════════════════
// 元数据注册表
// ═══════════════════════════════════════════════════════════

const REGISTRY = {
  // HTTP / 请求基础设施
  [PAYLOAD_TOO_LARGE]:              { httpStatus: 413, retryable: false, message: "请求内容过大" },
  [INVALID_JSON]:                   { httpStatus: 400, retryable: false, message: "请求 JSON 格式无效" },
  [INVALID_PUBLIC_BASE_URL]:        { httpStatus: 500, retryable: false, message: "PUBLIC_BASE_URL 配置无效" },
  [INVALID_ROUTE_PARAMETER]:        { httpStatus: 400, retryable: false, message: "请求路径参数编码无效" },
  [PUBLIC_BASE_URL_REQUIRED]:       { httpStatus: 503, retryable: false, message: "非本地部署必须设置 PUBLIC_BASE_URL" },

  // 浏览器 API 路由
  [API_ROUTE_NOT_FOUND]:            { httpStatus: 404, retryable: false, message: "接口不存在" },
  [INVALID_DEMO_ACCESS_CODE]:       { httpStatus: 401, retryable: false, message: "演示访问码错误" },
  [GENERATION_RATE_LIMITED]:        { httpStatus: 429, retryable: true,  message: "生成次数已达上限" },

  // Worker API 认证与路由
  [WORKER_TOKEN_NOT_CONFIGURED]:    { httpStatus: 503, retryable: false, message: "Master 尚未配置 WORKER_TOKEN" },
  [WORKER_UNAUTHORIZED]:            { httpStatus: 401, retryable: false, message: "Image Worker 认证失败" },
  [WORKER_ID_REQUIRED]:             { httpStatus: 400, retryable: false, message: "缺少 Worker ID" },
  [WORKER_ROUTE_NOT_FOUND]:         { httpStatus: 404, retryable: false, message: "Worker 接口不存在" },

  // Task Broker — Worker 生命周期
  [LEASE_EXPIRED]:                  { httpStatus: 502, retryable: true,  message: "Worker 租约过期" },
  [WORKER_NOT_REGISTERED]:          { httpStatus: 404, retryable: false, message: "Worker 尚未注册" },
  [WORKER_WAIT_TIMEOUT]:            { httpStatus: 504, retryable: true,  message: "等待生图端超时" },
  [WORKER_NOT_ONLINE]:              { httpStatus: 409, retryable: false, message: "Worker 不在线或未注册" },

  // Task Broker — 任务租约验证
  [WORKER_TASK_NOT_FOUND]:          { httpStatus: 404, retryable: false, message: "Worker 任务不存在" },
  [WORKER_LEASE_MISMATCH]:          { httpStatus: 409, retryable: false, message: "Worker 租约不匹配" },
  [WORKER_TASK_STATE_INVALID]:      { httpStatus: 409, retryable: false, message: "当前任务状态不允许该操作" },
  [WORKER_LEASE_EXPIRED]:           { httpStatus: 409, retryable: true,  message: "Worker 租约已经过期" },

  // Task Broker — 图片上传验证
  [WORKER_UPLOAD_EMPTY]:            { httpStatus: 400, retryable: false, message: "上传图片为空" },
  [WORKER_UPLOAD_UNSUPPORTED_IMAGE]:{ httpStatus: 415, retryable: false, message: "仅支持 PNG、JPEG 或 WebP 图片上传" },
  [WORKER_UPLOAD_MIME_MISMATCH]:    { httpStatus: 415, retryable: false, message: "上传图片的 Content-Type 与实际文件不一致" },
  [WORKER_UPLOAD_HASH_MISMATCH]:    { httpStatus: 409, retryable: false, message: "上传图片 SHA-256 校验失败" },
  [WORKER_UPLOAD_NOT_FOUND]:        { httpStatus: 409, retryable: false, message: "找不到本次任务上传的图片" },

  // Task Broker — 任务执行
  [WORKER_TASK_FAILED]:             { httpStatus: 502, retryable: false, message: "生图任务失败" },
  [WORKER_EXECUTION_FAILED]:        { httpStatus: 502, retryable: false, message: "Image Worker 执行失败" },

  // Agent Orchestrator — 输入验证
  [INVALID_WALLET_ADDRESS]:         { httpStatus: 400, retryable: false, message: "钱包地址格式无效" },
  [INVALID_REQUIREMENT]:            { httpStatus: 400, retryable: false, message: "珠宝需求描述无效" },
  [INVALID_CHANGE_REQUEST]:         { httpStatus: 400, retryable: false, message: "修改要求无效" },
  [INVALID_TX_HASH]:                { httpStatus: 400, retryable: false, message: "txHash 格式无效" },
  [VALIDATION_FAILED]:              { httpStatus: 400, retryable: false, message: "验证失败" },
  [UNSUPPORTED_PRODUCT_TEMPLATE]:   { httpStatus: 400, retryable: false, message: "不支持的产品类型" },

  // Agent Orchestrator — 实体未找到
  [PROJECT_NOT_FOUND]:              { httpStatus: 404, retryable: false, message: "设计项目不存在" },
  [PARENT_VERSION_NOT_FOUND]:       { httpStatus: 404, retryable: false, message: "作为修改来源的上一版本不存在" },
  [JOB_NOT_FOUND]:                  { httpStatus: 404, retryable: false, message: "任务不存在" },
  [VERSION_NOT_FOUND]:              { httpStatus: 404, retryable: false, message: "设计版本不存在" },

  // Agent Orchestrator — 设计状态 / 链上登记
  [PARENT_NOT_ONCHAIN]:             { httpStatus: 409, retryable: false, message: "请先将当前版本登记到 Monad" },
  [DESIGN_FINALIZED]:               { httpStatus: 409, retryable: false, message: "该设计已经确定最终版本" },
  [INVALID_VERSION_STATE]:          { httpStatus: 409, retryable: false, message: "当前版本状态不允许该操作" },
  [VERSION_NOT_READY]:              { httpStatus: 409, retryable: false, message: "版本缺少真实图片或提示词" },
  [REGISTRANT_LOCKED]:              { httpStatus: 409, retryable: false, message: "该版本已经绑定另一个登记钱包" },
  [PARENT_NOT_CONFIRMED]:           { httpStatus: 409, retryable: false, message: "父版本尚未在 Monad 确认" },
  [DESIGN_OWNER_WALLET_REQUIRED]:   { httpStatus: 409, retryable: false, message: "V2 必须使用与 V1 相同的钱包登记" },
  [WALLET_MISMATCH]:                { httpStatus: 409, retryable: false, message: "回传钱包与登记钱包不一致" },
  [VERSION_NOT_REGISTERED]:         { httpStatus: 409, retryable: false, message: "只有已登记到 Monad 的版本才能确认为最终版" },
  [UNAUTHORIZED_FINALIZER]:         { httpStatus: 403, retryable: false, message: "只有原登记钱包可以确认最终版" },
  [DESIGN_NOT_FINALIZED]:           { httpStatus: 409, retryable: false, message: "该设计还没有完成链上最终确认" },

  // Monad Chain Service — RPC 与验证
  [RPC_UNAVAILABLE]:                { httpStatus: 502, retryable: true,  message: "当前环境不支持网络请求" },
  [RPC_REQUEST_FAILED]:             { httpStatus: 502, retryable: true,  message: "Monad RPC 请求失败" },
  [RPC_TIMEOUT]:                    { httpStatus: 502, retryable: true,  message: "Monad RPC 请求超时" },
  [RPC_CONNECT_FAILED]:             { httpStatus: 502, retryable: true,  message: "无法连接 Monad RPC" },
  [CHAIN_STATUS_FAILED]:            { httpStatus: 502, retryable: true,  message: "获取链上状态失败" },
  [TRANSACTION_REVERTED]:           { httpStatus: 502, retryable: false, message: "Monad 交易执行失败" },
  [WRONG_CONTRACT]:                 { httpStatus: 502, retryable: false, message: "交易目标不是当前 Design Registry 合约" },
  [EXPECTED_EVENT_NOT_FOUND]:       { httpStatus: 502, retryable: false, message: "交易成功但没有找到匹配的版本登记事件" },

  // Ark Image Provider
  [ARK_NOT_CONFIGURED]:             { httpStatus: 409, retryable: false, message: "火山方舟尚未配置" },
  [ARK_INVALID_RESPONSE]:           { httpStatus: 502, retryable: true,  message: "火山方舟返回了无法解析的响应" },
  [ARK_REQUEST_FAILED]:             { httpStatus: 502, retryable: true,  message: "火山方舟请求失败" },
  [ARK_NO_IMAGE_URL]:               { httpStatus: 502, retryable: true,  message: "火山方舟没有返回图片 URL" },
  [ARK_IMAGE_DOWNLOAD_FAILED]:      { httpStatus: 502, retryable: true,  message: "下载生成图片失败" },
  [ARK_EMPTY_IMAGE]:                { httpStatus: 502, retryable: true,  message: "下载到的图片为空" },
  [ARK_UNSUPPORTED_IMAGE]:          { httpStatus: 502, retryable: false, message: "下载结果不是受支持的图片格式" },
  [ARK_TIMEOUT]:                    { httpStatus: 502, retryable: true,  message: "火山方舟请求超时" },
  [ARK_CONNECT_FAILED]:             { httpStatus: 502, retryable: true,  message: "无法连接火山方舟" },

  // Requirement Provider
  [REQUIREMENT_PROVIDER_NOT_CONFIGURED]: { httpStatus: 502, retryable: false, message: "外部需求解析服务未配置" },
  [REQUIREMENT_PROVIDER_TIMEOUT]:        { httpStatus: 502, retryable: true,  message: "外部需求解析超时" },

  // Storage Service
  [SUPABASE_REQUEST_FAILED]:        { httpStatus: 502, retryable: true,  message: "Supabase 请求失败" },

  // Worker 进程
  [UNSUPPORTED_TASK_TYPE]:          { httpStatus: 400, retryable: false, message: "不支持的任务类型" },
  [GENERATION_FAILED]:              { httpStatus: 502, retryable: true,  message: "图片生成失败" },
  [WORKER_BUSY]:                    { httpStatus: 409, retryable: true,  message: "生图端正在执行其他任务" },

  // WebSocket 专用
  [WS_MESSAGE_FAILED]:              { httpStatus: 400, retryable: false, message: "WebSocket 消息处理失败" },
  [TASK_DISPATCH_FAILED]:           { httpStatus: 500, retryable: false, message: "任务分发失败" },

  // 通用回退
  [INTERNAL_ERROR]:                 { httpStatus: 500, retryable: false, message: "服务发生未处理错误" },
  [HTTP_ERROR]:                     { httpStatus: 400, retryable: false, message: "HTTP 请求错误" },
  [AGENT_ERROR]:                    { httpStatus: 400, retryable: false, message: "Agent 错误" },
  [TASK_BROKER_ERROR]:              { httpStatus: 400, retryable: false, message: "任务调度错误" },
  [WORKER_API_ERROR]:               { httpStatus: 400, retryable: false, message: "Worker API 错误" },
  [CHAIN_ERROR]:                    { httpStatus: 502, retryable: true,  message: "链上操作错误" },
  [STORAGE_ERROR]:                  { httpStatus: 502, retryable: true,  message: "存储服务错误" },
  [REQUIREMENT_PROVIDER_FAILED]:    { httpStatus: 502, retryable: true,  message: "需求解析服务错误" },
  [ARK_IMAGE_PROVIDER_ERROR]:       { httpStatus: 502, retryable: true,  message: "图片生成服务错误" },
};

// ═══════════════════════════════════════════════════════════
// 错误工厂
// ═══════════════════════════════════════════════════════════

export function createAppError(code, { message, httpStatus, retryable, details = null } = {}) {
  const meta = REGISTRY[code];
  const error = new Error(message || (meta ? meta.message : "未知错误"));
  error.code = code;
  error.httpStatus = httpStatus ?? (meta ? meta.httpStatus : 500);
  error.retryable = retryable ?? (meta ? meta.retryable : false);
  error.details = details;
  return error;
}
