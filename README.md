# 黄金产业 AI 智能设计框架 V0.6.0

V0.6.0 是面向团队演示和后续联调的 Windows 本地优先版本。它保留完整的设计协作闭环，并把电影感前端、同源 AI 接口框架、本地 Design Registry 和 Monad Testnet 只读核验放进同一套可审计的运行边界中。

> 当前版本是框架和演示系统，不是已经训练完成的黄金设计模型，也不代表可生产、可制造、原创或版权结论。

## 工作流程

1. 客户输入主题、原话、表单字段和参考图片信息。
2. 系统输出可人工修改的结构化需求和缺失信息。
3. 一个任务返回三个有名称、有说明的设计方向。
4. 每个方向独立显示状态、模型、耗时和失败原因，可部分成功、单方向失败和单独重试。
5. 客户选择方向后继续细化，系统保留 V1、V2、V3 的父版本关系和反馈。
6. 专家资料经过人工录入、人工审核后，才可供设计调用。
7. 最终版本可以在本地 Registry 演示登记，也可查看既有 Monad Testnet 公开证据。

这形成两个相互连接的闭环：

- 客户反馈让设计流程逐轮收敛；
- 审核通过的专家知识让专业依据逐步积累。

## V0.6.0 包含什么

- 电影感黄金设计前端与桌面/移动端响应式布局；
- 需求解析、任务查询、三方向结果、细化、反馈、版本关系、模型和提示词接口框架；
- 默认占位设计生成，以及显式启用的同源 ComfyUI 接口；
- Windows 便携包中的本地 Ganache EVM、预编译 DesignRegistry artifact 和本地登记流程；
- Monad Testnet 已有公开交易和版本树的只读核验页；
- 源码绑定、依赖锁定且可追溯的 Windows x64 白名单打包脚本、构建信息和 SHA-256 清单；不声明 ZIP 字节级可复现。

## 能力与联网边界

- 默认本地演示不连接外部 AI，不上传客户资料，只返回明确标识的占位方向。
- 当前项目不识别照片、不做 OCR、不训练或微调模型，也不自动联网采集专业知识。
- 照片上传框和专家知识中心目前是录入、审核、引用框架，不等于系统已经从照片学习。
- 只有手动配置并通过健康检查的同源 ComfyUI、有效 checkpoint 和工作流，后端才会提交真实图片生成任务；失败时不会伪装成功。
- Windows 便携包启动的 Registry 是 `127.0.0.1` 上的本地开发链，使用确定性的开发账户，不是用户钱包，也不是 Monad。
- Monad Testnet 页面会为了实时只读核验访问公开 RPC；不可用时必须显示缓存或失败状态，不会执行写交易。
- 测试网记录只证明指定地址、内容哈希和时间上的公开状态；测试网可能重置，链上记录不等于版权登记、原创认定或身份认证。

## 本地开发运行

需要 Node.js 20 或更高版本，以及通过锁文件安装的依赖：

```powershell
pnpm install --frozen-lockfile
pnpm start
```

- 普通入口：`http://127.0.0.1:4173/`
- 演示入口：`http://127.0.0.1:4173/?demo=1`
- 健康接口：`http://127.0.0.1:4173/api/health`
- 本地 Registry 开发链：

```powershell
pnpm run web3:chain
pnpm run web3:deploy
```

`web3:chain` 需要保持运行。开发链和 Registry 只用于本机演示。

## Windows 便携包

打包机需要 PowerShell、Git、pnpm，以及一个完整的 Windows x64 Node.js 20+ 运行时目录。运行时目录至少要包含 `node.exe` 和 Node 自带许可证文件。

仓库必须处于干净 Git 状态，然后执行：

```powershell
pnpm run package:windows -- -RuntimeDir "D:\path\to\node-runtime"
```

脚本只复制明示白名单中的项目文件，生成：

- `dist/gold-ai-demo-win-x64-v0.6.0/`
- `dist/gold-ai-demo-win-x64-v0.6.0.zip`
- `dist/gold-ai-demo-win-x64-v0.6.0.zip.sha256.txt`

包内包含 `BUILD_INFO.json`、`SHA256SUMS.txt`、启动/停止脚本和简明使用说明。脚本拒绝覆盖已有同名输出，也拒绝从脏工作树构建。

## 验证

```powershell
pnpm test
pnpm run evaluate:requirements
pnpm run check:comfyui
```

`evaluate:requirements` 只验证解析结构和程序流程，不输出虚假的行业准确率。`check:comfyui` 只检查本机 ComfyUI、checkpoint 和工作流是否真实就绪。

## 配置

`.env.example` 只包含无密钥示例。项目不会自动加载 `.env`；启动前应在可信的本地环境中设置所需环境变量。私钥、助记词、API Key、客户附件、内部资料和运行证据不得写入仓库或便携包。

正式 ComfyUI 工作流为 `workflows/sdxl_base_refiner_gold_v1_api.json`。

## 私有分发与第三方材料

本项目自身代码采用私有、保留所有权利的分发声明，详见 `LICENSE` 和 `PRIVATE_DISTRIBUTION.md`。第三方运行时、依赖与图片来源不受该私有声明重新授权，详见 `THIRD_PARTY_NOTICES.md`、`public/assets/editorial-gold/SOURCES.md` 以及包内保留的对应许可证文件。
