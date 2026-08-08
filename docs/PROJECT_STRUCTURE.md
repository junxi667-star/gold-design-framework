# 项目结构与维护入口

JewelChain Studio 使用 Go 作为后端（Master API、Worker、WebSocket），React + Vite 作为前端构建工具链。Cloudflare Pages 使用独立、可直接上传的静态前端目录。

## 运行入口

| 路径 | 职责 |
| --- | --- |
| `cmd/jewelchain-server/main.go` | Go Master API、静态文件服务和 Worker WebSocket 接入点 |
| `cmd/jewelchain-worker/main.go` | Go Image Worker 进程入口 |
| `scripts/windows/service-manager.bat` | Windows 一键启动的 Master 后台进程管理 |
| `scripts/windows/worker-service-manager.bat` | Windows 一键启动的 Worker 后台进程管理 |
| `scripts/` | Windows 维护脚本 |

## Go 后端代码

| 路径 | 职责 |
| --- | --- |
| `internal/handler/server.go` | HTTP 路由、CORS、静态文件服务 |
| `internal/handler/websocket.go` | Worker WebSocket Hub |
| `internal/service/design.go` | V1/V2 设计流程编排（生成、版本状态机、时间线与 Agent 问答） |
| `internal/service/task.go` | Worker 注册、排队、租约、重试和上传归档 |
| `internal/service/ark.go` | Ark 图片生成器（直接调用） |
| `internal/service/chain.go` | 链上编排：登记准备、交易提交、链上验证与最终确认 |
| `internal/service/storage.go` | Supabase / 本地 Metadata 存储 |
| `internal/service/manifest.go` | 标准 Metadata 构建 |
| `internal/service/version_state.go` | 版本状态机（8 态 + 合法迁移表 + 断言） |
| `internal/service/requirement.go` | 需求解析与黄金珠宝产品模板 |
| `internal/worker/worker.go` | Image Worker 客户端（WebSocket + HTTP 轮询） |
| `internal/model/model.go` | 数据模型与错误处理 |
| `internal/config/config.go` | 环境变量配置加载 |
| `internal/repository/state.go` | JSON 文件持久化 |

## 前端与部署镜像

- `frontend/` 是 Vite + React 的唯一前端源目录；其中 `src/` 保存界面与客户端逻辑，`static/` 保存部署静态资源。
- `public/` 是 `pnpm run build` 生成的本地 Master 静态目录，不能手工编辑。
- `pages-frontend/` 是 `pnpm run build:pages` 生成的 Cloudflare Pages 目录，不能手工编辑。
- 两个产物的 `runtime-config.js` 有意不同：前者使用同源 API，后者固定指向 `https://api.jewelchain.xyz`。

## 常用校验

```bash
go build ./...
go test ./...
pnpm run build
```

生成的图片、Metadata、运行状态、日志及本地密钥均不属于源代码；具体忽略规则见 `.gitignore`。

## Windows 启动器

- 根目录的 `*.bat` 保留为兼容快捷入口，保证现有文档、压缩包用户和旧桌面快捷方式可继续使用。
- 实际批处理实现按职责归入 `scripts/windows/lifecycle/`、`scripts/windows/configuration/`、`scripts/windows/diagnostics/` 和 `scripts/windows/deployment/`。

公网 Master 必须在 `.env` 中设置 `PUBLIC_BASE_URL`。本地 `localhost` 可省略；其余环境不会依赖可伪造的 `Host` 或转发头生成公开 Metadata URI。
