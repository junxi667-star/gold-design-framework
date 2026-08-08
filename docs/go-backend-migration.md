# Go Master API 迁移与运行

Go 后端入口是 `cmd/jewelchain-server/main.go`；`cmd/jewelchain-worker/main.go` 是独立的 Image Worker。Master 默认使用项目根目录作为数据目录并读取已有 `.env`，同时托管 `public/` 中已构建的 React 页面、浏览器 API 和生成资源，不依赖 Node.js 运行时。

## 迁移范围与架构

迁移保留浏览器 API、Worker HTTP / WebSocket 协议和 `jewelchain-state/v2` 状态文件。实现采用模块化单体：`handler → service → repository → model`；配置仅来自环境变量和本地 `.env`，密钥不得写入日志或响应。

| 范围 | 原实现 | Go 实现 |
| --- | --- | --- |
| HTTP API | Node `http` 路由 | `net/http` Handler 与统一响应/错误壳 |
| Worker | Node Image Worker | `cmd/jewelchain-worker`：Ark、HTTP 轮询回退、WebSocket 推送、租约与上传 |
| 生图 | Ark 或远程 Worker | Go Ark HTTP 适配器和 Go Worker |
| 存储 | 本地 / Supabase | 本地 Metadata 与 Supabase Storage 适配器 |
| Monad | JSON-RPC、ABI、Keccak | JSON-RPC、ABI、Legacy Keccak、canonical JSON |

核心状态保持如下：

```text
design: generating → awaiting_confirmation → awaiting_wallet_signature
      → tx_submitted → chain_confirmed → finalized

worker task: pending → claimed → running/uploading → completed
            ↘ retryable failure/expired lease → pending
```

| 模块 | 主要路径 |
| --- | --- |
| 浏览器 API | `/api/hackathon/*` |
| Worker API | `/api/v1/workers/*` |
| Worker 推送 | `GET /ws/worker` 升级 WebSocket |
| 健康检查 | `/health`、`/ready`、`/api/health` |
| 资产 | `/generated/*`、`/metadata/*`（白名单扩展名） |

## 本地运行

```bash
go test ./...
go vet ./...
go build ./cmd/jewelchain-server ./cmd/jewelchain-worker
go run ./cmd/jewelchain-server --root .
# 第二个终端；MASTER_BASE_URL 默认 http://127.0.0.1:4173
go run ./cmd/jewelchain-worker --root .
```

关键环境变量沿用现有名称：`HOST`、`PORT`、`JEWELCHAIN_STATE_PATH`、`WORKER_TOKEN`、`IMAGE_EXECUTION_MODE`、`ARK_*`、`STORAGE_MODE`、`SUPABASE_*`、`MONAD_*`、`DESIGN_REGISTRY_ADDRESS` 和 `CORS_ALLOWED_ORIGINS`。

## 切换与验证

1. 保留现有 `.env`，确认 `PORT`、`WORKER_TOKEN`、`JEWELCHAIN_STATE_PATH`、存储和 Monad 配置。
2. 运行上述测试、静态检查和构建命令。
3. 构建 React：`pnpm build`。Go Master 会从 `public/` 提供页面；开发时 Vite 继续将 `/api`、`/generated` 与 `/metadata` 代理给 Go Master。
4. 停止 Node Master 和 Node Worker；不要删除 `data/jewelchain-state.json`、`generated/` 或 `metadata/`。
5. 启动 Go Master 和 Go Worker。两个 Master 进程不得同时写同一状态文件，否则会产生丢失更新。
6. 检查 `/api/health`、Worker 注册/领取/上传、React 页面、历史项目读取和链状态。

Go Worker 保持既有 `Authorization: Bearer <WORKER_TOKEN>`、`X-Worker-Id`、`/api/v1/workers/*` 与 `/ws/worker` 协议，可直接替换 Node Worker。

## 接口与安全边界

公开响应保持以下包裹格式：

```json
{"data": {}}
```

失败响应为：

```json
{"error":{"code":"...","message":"...","retryable":false,"details":null,"requestId":"..."}}
```

图片上传限制为 25 MiB；服务端校验 PNG/JPEG/WebP 魔数、声明 MIME、SHA-256（如提供）和当前租约。`/generated/` 仅允许图片，`/metadata/` 仅允许 JSON，且两者都会拒绝路径穿越。

## 当前运行边界

- 当前持久化格式只适用于单个 Master 进程。横向扩容前应迁移至关系数据库，并以条件更新或行锁替代 JSON 文件互斥。
- 链上和 Metadata 的内容哈希依赖 Legacy Keccak 与 canonical JSON；升级提示词或 Metadata schema 前必须增加 Node 到 Go 的 golden fixture。
- `STORAGE_MODE=auto` 在 Supabase Metadata 写入失败时会回退到本地并返回警告；`supabase` 模式会严格失败。
