## 1.3.0-copy-refinement - 2026-08-04

- 统一普通用户主流程文案，减少未解释的技术术语；
- 修复 Agent 快捷按钮与实际问题不一致；
- 将“等待确认”明确为“等待您确认设计”，并区分钱包签名、链上确认和最终版确认；
- V1 首次出现解释为“第一版设计（V1）”；
- 解释生成下一版前登记上一版的原因与用户价值；
- 增加 Master、Image Worker、Metadata、contentHash 术语说明；
- 保留 Cloudflare Pages / Master / Image Worker 架构、域名和 `.env` 配置不变；
- 保留关闭 JewelChain BAT 后 `demo.jewelchain.xyz` 仍可访问的离线浏览能力。

## 1.2.0-pages-master-worker - 2026-08-03

- 新增 Cloudflare Pages 独立静态前端包；
- Master 关闭时网站仍可浏览并显示离线状态；
- 前端支持可配置 API Base URL 与跨域资源 URL；
- Master API 增加白名单 CORS 与 OPTIONS 预检；
- Worker 离线时任务继续保留，默认等待 7 天；
- Worker 上线后通过 WebSocket 或 HTTP 自动领取任务；
- 保持原 `.env`、API Key、域名和钱包配置不变。

# Changelog

## v0.8.0

- Added a cloud-ready Master API + local Image Worker architecture.
- Added persistent image-generation task queue, worker registry, task leases, heartbeat, idempotency, retry and timeout recovery.
- Added WebSocket as the primary task push channel.
- Added authenticated HTTP registration, claim, heartbeat, renew, progress, binary upload, complete and fail endpoints as the fallback path.
- Added direct binary image upload from Worker to Master; images are not sent as Base64 through WebSocket.
- Added SHA-256 verification when Master receives Worker images.
- Added background Windows Image Worker service, one-click start/stop scripts and worker logs.
- Added `worker`, `direct` and `hybrid` image execution modes.
- Added Master restart recovery for queued/running Agent generation jobs.
- Added Worker status to the UI and diagnostics.
- Preserved the v0.7.0 Seedream API configuration and all Monad/Supabase behavior.

## v0.7.0

- Rebuilt the demo around the hackathon core flow: V1 → Monad → V2 → finalization.
- Removed the local ComfyUI dependency; uses Volcengine Ark Seedream image generation API.
- Added deterministic Agent orchestration and task states.
- Added local/Supabase image and Metadata storage.
- Added canonical Metadata, Keccak-256 hashes, parentContentHash and integrity checks.
- Added MetaMask connection and automatic Monad Testnet network setup.
- Added manual ABI transaction encoding without third-party runtime dependencies.
- Added txHash receipt/event verification on the backend.
- Added version timeline, Explorer links, final certificate download and Agent evidence Q&A.

## 1.1.0-cloud-worker-ui-upgrade - 2026-08-03

- UI 改成更明亮的香槟金 / 紫蓝渐变基调，弱化纯黑背景；
- 粒子系统升级为更明显的流动金色粒子与柔和连线；
- 首页新增 Master / Image Worker 拆分说明与云端迁移提示；
- 保持现有 .env、域名、API Key 和 Worker 拆分逻辑不变；
- 继续使用 WebSocket 主通道 + HTTP 兜底；gRPC 仍保留为后续版本。

## 1.0.0-hackathon-final - 2026-08-03

- 全面升级为 Obsidian Gold「曜石金智能珠宝工坊」视觉系统。
- 新增低负载 Canvas 金粉/数据粒子、渐变光晕、珠宝轨道动效与滚动入场动画。
- 重构创建设计、系统状态、版本档案、修改迭代、Agent 问答和链上凭证信息层级。
- 新增 V1/最新版本拖动对比、图片大图预览、Hash/交易复制、固定演示链接复制。
- 新增设计预设、修改建议、字符计数、新建设计入口与钱包静默恢复。
- 新增 Agent 执行阶段可视化和移动端底部主操作入口。
- 保持原有 `.env`、Seedream API、Master/Worker、Cloudflare 域名和 Monad 配置不变。
- 补充移动端适配与 `prefers-reduced-motion` 无障碍降级。
