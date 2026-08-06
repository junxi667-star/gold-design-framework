# 项目结构与维护入口

JewelChain Studio 保持零运行时依赖：Node.js 负责 Master API、任务调度和静态文件服务；Cloudflare Pages 使用独立、可直接上传的静态前端目录。

## 运行入口

| 路径 | 职责 |
| --- | --- |
| `server.js` | Master API、静态文件服务和 Worker WebSocket 接入点 |
| `worker/image-worker.js` | 本地 Image Worker 进程入口 |
| `scripts/windows/service-manager.js` | Windows 一键启动的 Master 后台进程管理 |
| `scripts/windows/worker-service-manager.js` | Windows 一键启动的 Worker 后台进程管理 |
| `scripts/` | 诊断、API 测试、前端镜像与 Windows 维护脚本 |

## 业务代码

| 路径 | 职责 |
| --- | --- |
| `backend/api-router.js` | 面向浏览器的设计、链上凭证和 Agent API 路由 |
| `backend/worker-api-router.js` | 面向 Image Worker 的认证、租约、上传和完成路由 |
| `backend/http-utils.js` | 两套 API 路由共用的 JSON 响应、请求体限制和错误对象 |
| `backend/http/request-utils.js` | 路径参数解码与公开 Metadata 根地址的受限解析 |
| `backend/media/image-type.js` | 图片二进制签名识别与 MIME 规范化 |
| `backend/task-broker.js` | Worker 注册、排队、租约、重试和上传归档 |
| `backend/agent-orchestrator.js` | V1/V2 设计流程编排（需求解析、生成、版本状态机、时间线与 Agent 问答） |
| `backend/chain-orchestrator.js` | 链上编排：登记准备、交易提交、链上验证与最终确认 |
| `backend/version-states.js` | 版本状态机集中定义（8 态 + 合法迁移表 + 断言） |
| `backend/requirements/` | 需求解析、训练数据和可选 OpenAI 兼容 Provider |
| `backend/templates/` | 黄金珠宝产品模板 |

## 前端与部署镜像

- `public/` 是本地 Master 服务使用的前端源目录。
- `pages-frontend/` 是 Cloudflare Pages 的自包含部署目录。
- 两个目录中的 `runtime-config.js` 有意不同：前者使用同源 API，后者固定指向 `https://api.jewelchain.xyz`。
- 其余共享资源（`favicon.svg`、`index.html`、`styles.css`、`js/app.js`）只能从 `public/` 编辑。修改后运行 `npm run sync:frontend`，再运行 `npm run check:frontend` 验证镜像一致性。

## 常用校验

```bash
npm run check:frontend
npm test
npm run check
```

生成的图片、Metadata、运行状态、日志及本地密钥均不属于源代码；具体忽略规则见 `.gitignore`。

## Windows 启动器

- 根目录的 `*.bat` 保留为兼容快捷入口，保证现有文档、压缩包用户和旧桌面快捷方式可继续使用。
- 实际批处理实现按职责归入 `scripts/windows/lifecycle/`、`scripts/windows/configuration/`、`scripts/windows/diagnostics/` 和 `scripts/windows/deployment/`。
- 中文 `.bat` 是对英文兼容入口的别名，不再维护重复的启动逻辑。

公网 Master 必须在 `.env` 中设置 `PUBLIC_BASE_URL`。本地 `localhost` 可省略；其余环境不会依赖可伪造的 `Host` 或转发头生成公开 Metadata URI。
