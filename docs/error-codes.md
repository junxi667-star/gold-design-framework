# 错误码参考

所有业务错误码集中在 `backend/error-codes.js` 注册。模块通过 `import { createAppError, XXX_CODE } from "./error-codes.js"` 使用，不得在业务代码中使用内联字符串。

## HTTP / 请求基础设施

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `PAYLOAD_TOO_LARGE` | 413 | false | 请求内容过大 | http-utils.js |
| `INVALID_JSON` | 400 | false | 请求 JSON 格式无效 | http-utils.js |
| `INVALID_PUBLIC_BASE_URL` | 500 | false | PUBLIC_BASE_URL 配置无效 | http/request-utils.js |
| `INVALID_ROUTE_PARAMETER` | 400 | false | 请求路径参数编码无效 | http/request-utils.js |

## 浏览器 API 路由

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `API_ROUTE_NOT_FOUND` | 404 | false | 接口不存在 | api-router.js |
| `INVALID_DEMO_ACCESS_CODE` | 401 | false | 演示访问码错误 | api-router.js |
| `GENERATION_RATE_LIMITED` | 429 | true | 生成次数已达上限 | api-router.js |

## Worker API 认证与路由

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `WORKER_TOKEN_NOT_CONFIGURED` | 503 | false | Master 尚未配置 WORKER_TOKEN | worker-api-router.js |
| `WORKER_UNAUTHORIZED` | 401 | false | Image Worker 认证失败 | worker-api-router.js / worker-websocket.js |
| `WORKER_ID_REQUIRED` | 400 | false | 缺少 Worker ID | worker-api-router.js / task-broker.js |
| `WORKER_ROUTE_NOT_FOUND` | 404 | false | Worker 接口不存在 | worker-api-router.js |

## Task Broker — Worker 生命周期

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `LEASE_EXPIRED` | 502 | varies | Worker 租约过期 | task-broker.js |
| `WORKER_NOT_REGISTERED` | 404 | false | Worker 尚未注册 | task-broker.js |
| `WORKER_WAIT_TIMEOUT` | 504 | true | 等待生图端超时 | task-broker.js |
| `WORKER_NOT_ONLINE` | 409 | false | Worker 不在线或未注册 | task-broker.js |

## Task Broker — 任务租约验证

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `WORKER_TASK_NOT_FOUND` | 404 | false | Worker 任务不存在 | task-broker.js |
| `WORKER_LEASE_MISMATCH` | 409 | false | Worker 租约不匹配 | task-broker.js |
| `WORKER_TASK_STATE_INVALID` | 409 | false | 当前任务状态不允许该操作 | task-broker.js |
| `WORKER_LEASE_EXPIRED` | 409 | true | Worker 租约已经过期 | task-broker.js |

## Task Broker — 图片上传验证

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `WORKER_UPLOAD_EMPTY` | 400 | false | 上传图片为空 | task-broker.js |
| `WORKER_UPLOAD_UNSUPPORTED_IMAGE` | 415 | false | 仅支持 PNG、JPEG 或 WebP 图片上传 | task-broker.js |
| `WORKER_UPLOAD_MIME_MISMATCH` | 415 | false | 上传图片的 Content-Type 与实际文件不一致 | task-broker.js |
| `WORKER_UPLOAD_HASH_MISMATCH` | 409 | false | 上传图片 SHA-256 校验失败 | task-broker.js |
| `WORKER_UPLOAD_NOT_FOUND` | 409 | false | 找不到本次任务上传的图片 | task-broker.js |

## Task Broker — 任务执行

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `WORKER_TASK_FAILED` | 502 | false | 生图任务失败 | task-broker.js |
| `WORKER_EXECUTION_FAILED` | 502 | false | Image Worker 执行失败 | task-broker.js / image-worker.js |

## Agent Orchestrator — 输入验证

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `INVALID_WALLET_ADDRESS` | 400 | false | 钱包地址格式无效 | chain-orchestrator.js |
| `INVALID_REQUIREMENT` | 400 | false | 珠宝需求描述无效 | agent-orchestrator.js |
| `INVALID_CHANGE_REQUEST` | 400 | false | 修改要求无效 | agent-orchestrator.js |
| `INVALID_TX_HASH` | 400 | false | txHash 格式无效 | chain-orchestrator.js / chain-service.js |
| `VALIDATION_FAILED` | 400 | false | 验证失败 | utils.js |
| `UNSUPPORTED_PRODUCT_TEMPLATE` | 400 | false | 不支持的产品类型 | gold-product-template-router.js |

## Agent Orchestrator — 实体未找到

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `PROJECT_NOT_FOUND` | 404 | false | 设计项目不存在 | agent-orchestrator.js |
| `PARENT_VERSION_NOT_FOUND` | 404 | false | 作为修改来源的上一版本不存在 | agent-orchestrator.js |
| `JOB_NOT_FOUND` | 404 | false | 任务不存在 | agent-orchestrator.js |
| `VERSION_NOT_FOUND` | 404 | false | 设计版本不存在 | agent-orchestrator.js |

## Agent Orchestrator — 设计状态 / 链上登记

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `PARENT_NOT_ONCHAIN` | 409 | false | 请先将当前版本登记到 Monad | agent-orchestrator.js |
| `DESIGN_FINALIZED` | 409 | false | 该设计已经确定最终版本 | agent-orchestrator.js |
| `INVALID_VERSION_STATE` | 409 | false | 当前版本状态不允许该操作 | chain-orchestrator.js / version-states.js |
| `VERSION_NOT_READY` | 409 | false | 版本缺少真实图片或提示词 | chain-orchestrator.js |
| `REGISTRANT_LOCKED` | 409 | false | 该版本已经绑定另一个登记钱包 | chain-orchestrator.js |
| `PARENT_NOT_CONFIRMED` | 409 | false | 父版本尚未在 Monad 确认 | chain-orchestrator.js |
| `DESIGN_OWNER_WALLET_REQUIRED` | 409 | false | V2 必须使用与 V1 相同的钱包登记 | chain-orchestrator.js |
| `WALLET_MISMATCH` | 409 | false | 回传钱包与登记钱包不一致 | chain-orchestrator.js / chain-service.js |
| `VERSION_NOT_REGISTERED` | 409 | false | 只有已登记到 Monad 的版本才能确认为最终版 | chain-orchestrator.js |
| `UNAUTHORIZED_FINALIZER` | 403 | false | 只有原登记钱包可以确认最终版 | chain-orchestrator.js |
| `DESIGN_NOT_FINALIZED` | 409 | false | 该设计还没有完成链上最终确认 | agent-orchestrator.js |

## Monad Chain Service — RPC 与验证

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `RPC_UNAVAILABLE` | 502 | true | 当前环境不支持网络请求 | chain-service.js |
| `RPC_REQUEST_FAILED` | 502 | true | Monad RPC 请求失败 | chain-service.js |
| `RPC_TIMEOUT` | 502 | true | Monad RPC 请求超时 | chain-service.js |
| `RPC_CONNECT_FAILED` | 502 | true | 无法连接 Monad RPC | chain-service.js |
| `CHAIN_STATUS_FAILED` | 502 | true | 获取链上状态失败 | chain-service.js |
| `TRANSACTION_REVERTED` | 502 | false | Monad 交易执行失败 | chain-service.js (返回值) |
| `WRONG_CONTRACT` | 502 | false | 交易目标不是当前 Design Registry 合约 | chain-service.js (返回值) |
| `EXPECTED_EVENT_NOT_FOUND` | 502 | false | 交易成功但没有找到匹配的版本登记事件 | chain-service.js (返回值) |

## Ark Image Provider (火山方舟 Seedream)

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `ARK_NOT_CONFIGURED` | 409 | false | 火山方舟尚未配置 | ark-image-provider.js |
| `ARK_INVALID_RESPONSE` | 502 | true | 火山方舟返回了无法解析的响应 | ark-image-provider.js |
| `ARK_REQUEST_FAILED` | 502 | varies | 火山方舟请求失败 | ark-image-provider.js |
| `ARK_NO_IMAGE_URL` | 502 | true | 火山方舟没有返回图片 URL | ark-image-provider.js |
| `ARK_IMAGE_DOWNLOAD_FAILED` | 502 | true | 下载生成图片失败 | ark-image-provider.js |
| `ARK_EMPTY_IMAGE` | 502 | true | 下载到的图片为空 | ark-image-provider.js |
| `ARK_UNSUPPORTED_IMAGE` | 502 | false | 下载结果不是受支持的图片格式 | ark-image-provider.js |
| `ARK_TIMEOUT` | 502 | true | 火山方舟请求超时 | ark-image-provider.js |
| `ARK_CONNECT_FAILED` | 502 | true | 无法连接火山方舟 | ark-image-provider.js |

## Requirement Provider (OpenAI 兼容)

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `REQUIREMENT_PROVIDER_NOT_CONFIGURED` | 502 | false | 外部需求解析服务未配置 | openai-compatible-requirement-provider.js |
| `REQUIREMENT_PROVIDER_TIMEOUT` | 502 | true | 外部需求解析超时 | openai-compatible-requirement-provider.js |

## Storage Service (Supabase)

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `SUPABASE_REQUEST_FAILED` | 502 | true | Supabase 请求失败 | storage-service.js |

## Worker 进程

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `UNSUPPORTED_TASK_TYPE` | 400 | false | 不支持的任务类型 | image-worker.js |
| `GENERATION_FAILED` | 502 | true | 图片生成失败 | agent-orchestrator.js |
| `WORKER_BUSY` | 409 | true | 生图端正在执行其他任务 | image-worker.js |

## WebSocket 专用

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `WS_MESSAGE_FAILED` | 400 | false | WebSocket 消息处理失败 | worker-websocket.js |
| `TASK_DISPATCH_FAILED` | 500 | false | 任务分发失败 | worker-websocket.js |

## 通用回退

| Code | httpStatus | retryable | 默认消息 | 定义文件 |
|---|---|---|---|---|
| `INTERNAL_ERROR` | 500 | false | 服务发生未处理错误 | api-router.js / worker-api-router.js |
| `HTTP_ERROR` | 400 | false | HTTP 请求错误 | http-utils.js |
| `AGENT_ERROR` | 400 | false | Agent 错误 | agent-orchestrator.js |
| `TASK_BROKER_ERROR` | 400 | false | 任务调度错误 | task-broker.js |
| `WORKER_API_ERROR` | 400 | false | Worker API 错误 | worker-api-router.js |
| `CHAIN_ERROR` | 502 | true | 链上操作错误 | chain-service.js |
| `STORAGE_ERROR` | 502 | true | 存储服务错误 | storage-service.js |
| `REQUIREMENT_PROVIDER_FAILED` | 502 | true | 需求解析服务错误 | openai-compatible-requirement-provider.js |
| `ARK_IMAGE_PROVIDER_ERROR` | 502 | true | 图片生成服务错误 | ark-image-provider.js |

## 使用方式

```js
import { createAppError, PROJECT_NOT_FOUND } from "./error-codes.js";

// 抛出错误（使用注册表默认消息和 httpStatus）
throw createAppError(PROJECT_NOT_FOUND);

// 抛出错误（自定义消息）
throw createAppError(PROJECT_NOT_FOUND, { message: "自定义消息" });

// 抛出错误（覆盖 httpStatus）
throw createAppError(PROJECT_NOT_FOUND, { httpStatus: 500 });
```

## 响应格式

所有 API 错误响应遵循统一格式：

```json
{
  "error": {
    "code": "PROJECT_NOT_FOUND",
    "message": "设计项目不存在",
    "retryable": false,
    "details": null,
    "requestId": "uuid"
  }
}
```
