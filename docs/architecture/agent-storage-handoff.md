# Agent / Storage / Image Worker 协作协议 — v1.3.0

## 1. 责任边界

### Master API

- 创建 V1/V2 业务版本；
- 解析需求、构建 Prompt；
- 创建并持久化生图任务；
- 调度 Worker；
- 保存图片、Metadata、Hash 和链上记录；
- 准备 Monad 交易参数；
- 接收并验证 txHash；
- 提供版本时间线与 Agent 问答。

### Image Worker

- 主动连接 Master；
- 领取 `generate-image` 任务；
- 调用 Seedream；
- 下载图片并计算 SHA-256；
- 二进制上传 Master；
- 回传模型、Request ID 和任务结果。

### 前端

- 只调用 Master API；
- 连接 MetaMask；
- 用户确认交易；
- 回传 txHash；
- 不接触 Worker Token、API Key 或私钥。

## 2. 通信协议

主通道：

```text
WebSocket /ws/worker
```

兜底：

```text
HTTP /api/v1/workers/*
```

图片：

```text
HTTP PUT 二进制上传
```

图片上传仅接受服务端按文件签名识别的 PNG、JPEG 或 WebP；`Content-Type` 必须与实际字节一致。Master 会规范化归档扩展名，不能依赖 Worker 提供的文件扩展名。

v1.3.0 不实现 gRPC；接口保留未来迁移空间。

## 3. Worker API

所有写接口要求：

```http
Authorization: Bearer <WORKER_TOKEN>
X-Worker-Id: <WORKER_ID>
```

### 注册

```http
POST /api/v1/workers/register
```

### 心跳

```http
POST /api/v1/workers/heartbeat
```

### HTTP 兜底领取

```http
POST /api/v1/workers/tasks/claim
```

### 续租

```http
POST /api/v1/workers/tasks/:taskId/renew
```

### 进度

```http
POST /api/v1/workers/tasks/:taskId/progress
```

### 上传图片

```http
PUT /api/v1/workers/tasks/:taskId/upload
X-Lease-Id: <leaseId>
X-File-Name: result.png
X-Content-Sha256: <sha256>
Content-Type: image/png
```

### 完成

```http
POST /api/v1/workers/tasks/:taskId/complete
```

### 失败

```http
POST /api/v1/workers/tasks/:taskId/fail
```

## 4. WebSocket 消息

Worker 首条消息：

```json
{
  "type": "worker.register",
  "token": "...",
  "workerId": "long-pc-image-01",
  "workerVersion": "1.0.0",
  "capabilities": ["seedream", "jewelry-v1-v2"],
  "maxConcurrency": 1
}
```

Master 派发：

```json
{
  "type": "task.assigned",
  "task": {
    "id": "...",
    "leaseId": "...",
    "leaseExpiresAt": "...",
    "type": "generate-image",
    "payload": {
      "prompt": "...",
      "filenamePrefix": "..."
    }
  }
}
```

## 5. 可靠性策略

- 任务 `idempotencyKey = generation:<jobId>`；
- Worker 领取时获得 `leaseId`；
- 结果、进度、上传必须带相同 `leaseId`；
- 租约过期自动回到 `pending`；
- 默认最多尝试 3 次；
- Worker 断开不删除任务；
- Master 重启后恢复 queued/running Agent job；
- 图片上传后由 Master 再次校验 SHA-256。

## 6. 当前本地与未来云端

本地：

```text
Master = 127.0.0.1:4173
Worker = 同一台电脑
```

云端：

```text
Master = https://api.jewelchain.xyz
Worker = 用户电脑主动连接云端
```

云端 Master 可选设置：

```env
PUBLIC_BASE_URL=https://api.jewelchain.xyz
```

该值用于固定图片与 Metadata 的公开 URI；未设置时，Master 使用请求 `Host` 生成 URI。

只需要修改 Worker：

```env
MASTER_BASE_URL=https://api.jewelchain.xyz
WORKER_TOKEN=与云端一致
```
