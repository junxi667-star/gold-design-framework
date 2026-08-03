# JewelChain Studio v0.8.0

JewelChain Studio 是一个面向 Monad Playground 黑客松的 AI 珠宝设计协作 Agent。

核心闭环：

```text
客户输入珠宝需求
→ Master Agent 建立 V1 生图任务
→ Image Worker 领取任务并调用 Seedream
→ 图片上传回 Master，形成 V1
→ 用户确认并通过 MetaMask 登记到 Monad
→ 用户提出修改，生成 V2
→ V2 记录 V1 的 parentContentHash
→ 用户登记 V2 并设为最终确认版
→ 时间线与 Agent 问答提供链上证据
```

## v0.8.0 架构

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
  ├─ 下载并校验图片
  └─ 二进制上传 Master
```

本地使用时，Master 和 Worker 都运行在同一台电脑；上云后，只需要把 Master 放到云服务器，电脑继续运行 Worker。

## 已完成

- Seedream 真实生图；
- Master / Image Worker 分离；
- WebSocket 实时推送任务；
- HTTP 注册、心跳、领取、续租、进度、上传、完成和失败兜底；
- 任务租约、超时回收、重试、幂等与重复领取保护；
- 图片二进制上传和 SHA-256 校验；
- V1/V2 父子版本关系；
- 标准 Metadata 和 Keccak-256 Hash；
- 本地存储和可选 Supabase；
- MetaMask + Monad Testnet；
- Design Registry 登记与最终版本确认；
- txHash、Receipt 和事件验证；
- 版本时间线、Explorer、最终凭证、Agent 问答；
- Windows 一键启动和后台 Worker 日志。

## 本地一键使用

1. 完整解压 ZIP。
2. 双击 `START_JEWELCHAIN.bat`。
3. 浏览器自动打开 `http://127.0.0.1:4173/`。
4. 页面“生图执行端”显示 `Image Worker 在线（1）` 后开始生成。
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

## 未来迁移到云服务器

云服务器：

```env
HOST=0.0.0.0
PORT=4173
IMAGE_EXECUTION_MODE=worker
WORKER_TOKEN=与本地Worker一致的随机长Token
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
- Worker 上传时校验 SHA-256；
- 上链只保存 Hash、版本关系和 Metadata URI；
- 链上记录不等于法律版权确权。

完整操作见：`小白使用说明.md`。
