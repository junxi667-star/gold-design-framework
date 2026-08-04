# JewelChain Studio v1.3.0：Cloudflare Pages + Master + Image Worker

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

## Master 配置

Master `.env` 至少需要：

```env
HOST=0.0.0.0
PORT=4173
IMAGE_EXECUTION_MODE=worker
CORS_ALLOWED_ORIGINS=https://demo.jewelchain.xyz
WORKER_TOKEN=云端与本地 Worker 相同的随机长 Token
```

现阶段本地 Master 可继续由 Cloudflare Tunnel 暴露为 `api.jewelchain.xyz -> http://127.0.0.1:4173`。

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
