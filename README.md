# JewelChain Studio v1.3.1 — 安全加固与工程规范化

> Monad Playground 黑客松最终升级版：更明亮的黄金 UI、明显流动粒子特效、Cloud-ready Master / 本地 Image Worker 架构与可验证版本树。

本版本在 **不改变后端架构、API 域名、Cloudflare Pages 部署方式和 Master / Image Worker 通信协议** 的前提下，完成面向普通用户与黑客松评委的文案统一，并新增安全加固与工程规范化：

- 主流程优先使用中文业务语言；
- 技术区保留 Master、Image Worker、Metadata、contentHash，并提供首次解释；
- 统一设计确认、钱包签名、链上确认和最终版确认四类状态；
- Agent 快捷问题与实际发送问题逐字一致；
- 保留 `demo.jewelchain.xyz → Cloudflare Pages`，关闭 BAT 后网站仍可浏览并显示调度服务离线。

## v1.3.1 核心变化

### 安全加固

- 图片上传和下载改为 **魔数字节检测**（PNG/JPEG/WebP），不再信任 Content-Type 头。
- 文件服务增加 **扩展名白名单**：`/generated/` 只返回图片，`/metadata/` 只返回 JSON。
- `PUBLIC_BASE_URL` 强制配置：非本地部署必须设置，防止元数据 URI 被伪造 Host 污染。
- `decodeURIComponent` 失败时返回 400 而非 500。
- WebSocket 连接增加 `track()`/`waitForIdle()` 优雅关闭机制。

### 工程规范化

- **错误码集中注册**：`backend/error-codes.js` 统一定义 71 个错误码常量、元数据和 `createAppError` 工厂。业务模块不再使用内联字符串。参见 [`docs/error-codes.md`](./docs/error-codes.md)。
- **HTTP 工具去重**：`sendJson`/`readJson`/`readBody` 从两个路由抽取到 `backend/http-utils.js`。
- **请求工具抽取**：`decodeRouteParam`/`resolvePublicBaseUrl` 集中到 `backend/http/request-utils.js`。
- **前端同步脚本**：`npm run sync:frontend` 同步 `public/` 到 `pages-frontend/`，`npm run check:frontend` 校验一致性。
- **AGENTS.md**：新增代理协作约定，定义编码风格、验证流程和目录职责。

### 前端无障碍

- 新增 skip-link（键盘跳转）、ARIA 属性、语义化列表。
- 模态框焦点管理与 Tab 键陷阱。
- CSS 语义 Design Token 和响应式优化。

## v1.3.0 架构

```text
浏览器
  │ HTTPS / HTTP
  ▼
Master API
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
Image Worker
  ├─ 调用现有 Seedream API
  ├─ 下载并校验图片（魔数字节检测）
  └─ 二进制上传 Master（MIME + SHA-256 校验）
```

本地使用时，Master 和 Worker 都运行在同一台电脑；上云后，只需要把 Master 放到云服务器，电脑继续运行 Worker。

## 已完成

- Seedream 真实生图；
- Master / Image Worker 分离；
- WebSocket 实时推送任务；
- HTTP 注册、心跳、领取、续租、进度、上传、完成和失败兜底；
- 任务租约、超时回收、重试、幂等与重复领取保护；
- 图片二进制上传、魔数字节检测和 SHA-256 校验；
- V1/V2 父子版本关系；
- 标准 Metadata 和 Keccak-256 Hash；
- 本地存储和可选 Supabase；
- MetaMask + Monad Testnet；
- Design Registry 登记与最终版本确认；
- txHash、Receipt 和事件验证；
- 版本时间线、Explorer、最终凭证、Agent 问答；
- 错误码集中注册与文档化；
- 前端无障碍（skip-link、ARIA、焦点管理）；
- Windows 一键启动和后台 Worker 日志。

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

## 生图执行模式

`.env`：

```env
IMAGE_EXECUTION_MODE=worker
```

可选值：

- `worker`：所有生图进入 Master 队列，由 Worker 执行；
- `direct`：Master 直接调用图片 API；
- `hybrid`：优先 Worker，无在线 Worker 时由 Master 直接调用 API。

黑客松建议使用 `worker`；答辩保底可以使用 `hybrid`。

## 常用命令

| 操作 | 命令 |
| --- | --- |
| 启动 Master | `npm run start:master` |
| 启动 Worker | `npm run start:worker` |
| 同步 Pages 前端 | `npm run sync:frontend` |
| 校验前端一致性 | `npm run check:frontend` |
| 全量校验 | `npm run check` |
| 测试图片服务配置 | `npm run test:ark` |

## 未来迁移到云服务器

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

## 安全边界

- Master 和网页不读取钱包私钥；
- API Key 不会返回给浏览器；
- 图片不通过 WebSocket/Base64 传输；
- Worker 上传时校验魔数字节、MIME 一致性和 SHA-256；
- 文件服务限制扩展名白名单；
- 非本地部署强制设置 `PUBLIC_BASE_URL`；
- 上链只保存 Hash、版本关系和 Metadata URI；
- 链上记录不等于法律版权确权。

## 文档

| 文档 | 用途 |
| --- | --- |
| [`docs/error-codes.md`](./docs/error-codes.md) | 错误码参考（71 个） |
| [`docs/PROJECT_STRUCTURE.md`](./docs/PROJECT_STRUCTURE.md) | 目录结构与维护入口 |
| [`docs/architecture/`](./docs/architecture/) | Master / Worker / 前端协作协议 |
| [`docs/deployment/`](./docs/deployment/) | Cloudflare Pages 部署说明 |
| [`docs/guides/`](./docs/guides/) | 用户指南与演示指南 |
| [`AGENTS.md`](./AGENTS.md) | 代理协作约定 |

完整操作见：`小白使用说明.md`。
