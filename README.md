# JewelChain Studio v1.3.1

## v1.3.1 核心变化

### Go 后端迁移

- 后端已从 Node.js 完整迁移到 Go，所有 API、Worker、WebSocket 功能由 Go 二进制提供。
- `go build ./cmd/jewelchain-server` 构建 Master 服务。
- `go build ./cmd/jewelchain-worker` 构建 Image Worker。
- 前端仍使用 React + Vite 构建（`pnpm run build`）。

### 安全加固

- 图片上传和下载改为 **魔数字节检测**（PNG/JPEG/WebP），不再信任 Content-Type 头。
- 文件服务增加 **扩展名白名单**：`/generated/` 只返回图片，`/metadata/` 只返回 JSON。
- `PUBLIC_BASE_URL` 可选配置：未设置时使用请求 `Host` 生成图片和 Metadata URI。

### 前端无障碍

- 新增 skip-link（键盘跳转）、ARIA 属性、语义化列表。
- 模态框焦点管理与 Tab 键陷阱。
- CSS 语义 Design Token 和响应式优化。

## 架构

```text
浏览器
  │ HTTPS / HTTP
  ▼
Go Master API (jewelchain-server)
  ├─ Agent 编排
  ├─ 任务队列
  ├─ V1/V2 状态机
  ├─ Metadata / Hash
  ├─ Supabase 或本地存储
  ├─ Monad 交易准备与验证
  └─ Worker 调度
       ▲
       │ WebSocket 主通道
       │ HTTP 轮询与回传兜底
       ▼
Go Image Worker (jewelchain-worker)
  ├─ 调用现有 Seedream API
  ├─ 下载并校验图片（魔数字节检测）
  └─ 二进制上传 Master（MIME + SHA-256 校验）
```

本地使用时，Master 和 Worker 都运行在同一台电脑；上云后，只需要把 Master 放到云服务器，电脑继续运行 Worker。

## 本地一键使用

1. 完整解压 ZIP。
2. 双击 `START_JEWELCHAIN.bat`。
3. 浏览器自动打开 `http://127.0.0.1:4173/`。
4. 页面"生图执行端"显示 `Image Worker 在线（1）` 后开始生成。
5. 停止时双击 `STOP_JEWELCHAIN.bat`。

现有 `.env` 中的图片 API 配置已保留。不要把包含 `.env` 的压缩包上传公开 GitHub。

## 单独运行

Master：

```text
START_MASTER_ONLY.bat
```

Image Worker：

```text
START_IMAGE_WORKER_ONLY.bat
```

前台调试 Worker：

```text
RUN_IMAGE_WORKER.bat
```

Worker 日志：

```text
logs/image-worker.log
```

## 常用命令

| 操作 | 命令 |
| --- | --- |
| 构建 Master | `go build -o jewelchain-server ./cmd/jewelchain-server` |
| 构建 Worker | `go build -o jewelchain-worker ./cmd/jewelchain-worker` |
| 运行 Master | `./jewelchain-server` |
| 运行 Worker | `./jewelchain-worker` |
| 前端本地开发 | `pnpm run dev` |
| 构建前端 | `pnpm run build` |
| 构建 Pages 前端 | `pnpm run build:pages` |
| Go 测试 | `go test ./...` |

默认情况下，`pnpm run dev` 会将 `/api`、`/generated` 与 `/metadata` 代理到 Go Master 的 `http://127.0.0.1:4173`。

## 生图执行模式

`.env`：

```env
IMAGE_EXECUTION_MODE=worker
```

可选值：

- `worker`：所有生图进入 Master 队列，由 Worker 执行；
- `direct`：Master 直接调用图片 API；
- `hybrid`：优先 Worker，无在线 Worker 时由 Master 直接调用 API。

## 部署方式

云服务器：

```env
HOST=0.0.0.0
PORT=4173
IMAGE_EXECUTION_MODE=worker
WORKER_TOKEN=与本地Worker一致的随机长Token
PUBLIC_BASE_URL=https://api.jewelchain.xyz
```

本地电脑：

```env
MASTER_BASE_URL=https://api.jewelchain.xyz
WORKER_TOKEN=与云端一致
ARK_API_KEY=保留在本地Worker
```

然后云端只运行 Master，本地只运行 `START_IMAGE_WORKER_ONLY.bat`。

## 安全

- Master 和网页不读取钱包私钥；
- API Key 不会返回给浏览器；
- 图片不通过 WebSocket/Base64 传输；
- Worker 上传时校验魔数字节、MIME 一致性和 SHA-256；
- 文件服务限制扩展名白名单；
- 可通过 `PUBLIC_BASE_URL` 固定图片和 Metadata URI 的公开根地址；
- 上链只保存 Hash、版本关系和 Metadata URI；
- 链上记录不等于法律版权确权。

## 文档

| 文档 | 用途 |
| --- | --- |
| [`docs/error-codes.md`](./docs/error-codes.md) | 错误码参考 |
| [`docs/PROJECT_STRUCTURE.md`](./docs/PROJECT_STRUCTURE.md) | 目录结构与维护入口 |
| [`docs/architecture/`](./docs/architecture/) | Master / Worker / 前端协作协议 |
| [`docs/deployment/`](./docs/deployment/) | Cloudflare Pages 部署说明 |
| [`docs/guides/`](./docs/guides/) | 用户指南与演示指南 |
| [`docs/README.md`](./docs/README.md) | 全部技术、运维与验证文档索引 |
