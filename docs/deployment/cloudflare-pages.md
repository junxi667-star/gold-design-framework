# Cloudflare Pages + Master + Image Worker 部署说明

## 目标架构

```text
demo.jewelchain.xyz -> Cloudflare Pages（永久在线静态前端）
api.jewelchain.xyz  -> Master API（现在可先通过 Tunnel 指向本地，后续迁移云服务器）
本地电脑 Image Worker -> wss/https 主动连接 api.jewelchain.xyz
```

电脑或 Master 关闭时，`demo.jewelchain.xyz` 仍会显示 UI、项目介绍、粒子和动效，并提示“Master 暂时离线”。

## Pages 部署目录

直接上传或连接 Git 仓库时，构建输出目录使用：

```text
pages-frontend
```

该目录中的 `runtime-config.js` 已配置：

```js
apiBaseUrl: "https://api.jewelchain.xyz"
```

前端源码位于 `frontend/`。Pages 部署前在项目根目录构建：

```bash
pnpm run build:pages
pnpm run check:frontend
```

不要手工覆盖 `pages-frontend/runtime-config.js`；Vite 会在 Pages 构建时写入独立 API 地址。`_headers` 同时覆盖 `/assets/*` 的长期缓存和运行时配置的 `no-store`。

## Master 配置

Master `.env` 至少需要：

```env
HOST=0.0.0.0
PORT=4173
PUBLIC_BASE_URL=https://api.jewelchain.xyz
IMAGE_EXECUTION_MODE=worker
CORS_ALLOWED_ORIGINS=https://demo.jewelchain.xyz
WORKER_TOKEN=云端与本地 Worker 相同的随机长 Token
```

`PUBLIC_BASE_URL` 可选；设置后必须是浏览器和链上 Metadata 都能访问到的 Master API 根地址。未设置时，生产环境从请求的 `Host` 推断该地址（不会使用 `X-Forwarded-*` 头）。

现阶段本地 Master 可继续由 Cloudflare Tunnel 暴露为 `api.jewelchain.xyz -> http://127.0.0.1:4173`。

部署前至少运行：

```bash
pnpm run check
```

## 本地 Image Worker

```env
MASTER_BASE_URL=https://api.jewelchain.xyz
WORKER_TOKEN=与 Master 完全一致
ARK_API_KEY=保留原值
```

运行：

```text
START_IMAGE_WORKER_ONLY.bat
```

Worker 优先通过 WebSocket 接收任务；断线时自动使用 HTTP 注册、心跳和任务领取兜底。图片通过 HTTP PUT 二进制上传。

## gRPC

v1.3.0 没有宣称已实现 gRPC。黑客松最终版继续采用 WebSocket 主通道 + HTTP 可靠兜底；gRPC 预留为后续生产化升级，避免当前引入 HTTP/2、protobuf、反向代理和证书联调风险。
