# 文档索引

本目录存放用户指南、架构、部署、运维、设计与验证资料；根目录只保留项目入口、配置和兼容启动器。

| 文档 | 读者 | 用途 |
| --- | --- | --- |
| [项目结构与维护入口](./PROJECT_STRUCTURE.md) | 开发者、维护者 | 目录职责、前端镜像规则和本地校验。 |
| [故障复盘](./fault-reviews/) | 维护者 | 已修复问题的原因、边界和回归措施。 |
| [Agent / Storage / Image Worker 协作协议](./architecture/agent-storage-handoff.md) | 后端、Worker 开发者 | Master、Worker 与前端的责任边界和协议。 |
| [Cloudflare Pages 部署说明](./deployment/cloudflare-pages.md) | 运维、演示负责人 | 静态前端、云端 Master 与本地 Worker 的部署边界。 |
| [中文使用说明](./guides/user-guide.zh-CN.md) | 演示者、终端用户 | Windows 一键启动、生成、登记和排障。 |
| [演示指南](./guides/demo-guide.md) | 黑客松演示者 | 最短演示路径与答辩检查项。 |
| [已知限制](./operations/known-issues.md) | 所有读者 | MVP 范围、外部服务依赖和安全边界。 |
| [UI 设计与升级说明](./design/ui-upgrade-notes.md) | 前端开发者、设计者 | 品牌视觉、交互与保持不变的能力边界。 |
| [本地验证报告](./reports/local-verification-2026-08-05.md) | 维护者 | 该次本地验证的通过范围与未执行外部验证。 |

文档描述的是当前可验证能力。真实 Seedream 调用、MetaMask 签名、Monad Testnet 交易和 Cloudflare 公网部署需要对应凭据、网络与外部服务，不能由本地单元测试替代。
