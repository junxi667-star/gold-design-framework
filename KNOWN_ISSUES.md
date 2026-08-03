# Known Issues

1. 当前 Demo 的 V2 是根据“上一版结构化需求 + 修改意见”重新生成，不是像素级局部重绘，外形可能发生变化。
2. Seedream 是外部 API，生成时间、额度和稳定性受服务商影响。
3. 本地模式的图片与 Metadata 地址依赖 Master 进程；正式公网提交建议配置 Supabase。
4. Image Worker 离线时，生图任务会保留在 Master 队列中，但用户需要等待 Worker 恢复上线。
5. v0.8.0 实现 WebSocket 主通道和 HTTP 兜底，没有实现 gRPC；这是两周 MVP 的主动范围控制。
6. 当前任务队列持久化在单机 JSON 中，适合黑客松演示；多实例 Master 需要迁移到 PostgreSQL/Redis 队列。
7. Worker Token 当前为共享 Bearer Token。上云前必须更换为随机长 Token，并为每台 Worker 分配独立凭证。
8. 手机签名依赖钱包内置浏览器；微信、QQ 等普通内置浏览器通常不能直接调用 MetaMask。
9. 默认 Design Registry 地址来自既有 Monad Testnet 部署；测试网或合约变化时需要更新 `.env`。
10. 当前 Agent 问答是确定性受限问答，不是开放式通用聊天机器人，也未封装 Moss Adapter。
11. 本 Demo 不提供版权确权、原创性检测、生产可行性承诺或黄金交易。
