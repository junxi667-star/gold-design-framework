# Windows 启动与维护脚本

根目录的 `.bat` 文件是兼容快捷入口，面向已下载完整包、已有桌面快捷方式或按旧文档操作的 Windows 用户。实际实现统一收纳在本目录，避免同一启动流程在中英文批处理文件中重复维护。

| 目录 | 内容 |
| --- | --- |
| `lifecycle/` | Master、Image Worker 的启动、停止与前台运行。 |
| `configuration/` | 本地 `.env` 初始化与编辑。 |
| `diagnostics/` | 诊断、图片服务配置和 Worker 连通性检查。 |
| `deployment/` | Cloudflared 下载与公网演示隧道。 |
| `service-manager.js` | Master 后台服务的状态文件、启动与停止。 |
| `worker-service-manager.js` | Image Worker 后台服务、日志与状态文件管理。 |

新增 Windows 操作脚本时，只在本目录添加实现；如需面向最终用户提供双击入口，再在项目根目录增加一个简短的兼容转发器。
