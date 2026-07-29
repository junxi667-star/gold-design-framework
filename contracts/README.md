# DesignRegistry 本地开发说明

本目录只实现本地 EVM 版本登记闭环。它不是 Monad 测试网或主网部署，
不使用真实钱包、测试币、外部账户或秘密。

## 启动顺序

要求 Node.js 20 或更高版本，并在项目根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm web3:build
pnpm web3:chain
```

保持本地链终端运行，打开第二个终端：

```powershell
pnpm web3:deploy
pnpm start
```

打开第三个终端验证完整 API 闭环：

```powershell
pnpm web3:smoke
```

自动测试：

```powershell
pnpm test:web3
pnpm test
```

默认本地参数：

- RPC：`http://127.0.0.1:8545`
- Chain ID：`31337`
- HTTP 应用：`http://127.0.0.1:4173`
- 签名器：Ganache 解锁的确定性开发账户 0
- 运行配置：`data/web3-local-runtime.json`（已忽略，不进入仓库）
- Web3 API 状态：`data/web3-backend-state.json`（已忽略，不进入仓库）

## 真实能力边界

- 合约交易和读取确实在本机 Ganache EVM 执行。
- `submit-local` 使用的是明确标记的本地开发签名器，不是用户钱包。
- 链上只存设计 ID 哈希、内容哈希、父哈希、URI、登记地址和区块时间。
- 客户原话、姓名、电话和原图不能进入确认接口或合约。
- `imageSha256` 必须由上游对真实选定图片计算；接口不会生成占位哈希。
- `contentHash` 是固定 `design-manifest/v1` 规范化 JSON 的 Keccak-256。
- 本地成功不证明 Monad、公开网络、生产安全、版权归属或黄金材质。

## 合约保护

- 首版必须使用零父哈希。
- 后续版本必须引用已经存在的父版本。
- 同一设计不能重复登记同一内容哈希。
- 首版登记地址成为该设计的写入者；其他地址不能追加或最终确认。
- `confirmVersion` 最终确认后不可覆盖，也不能继续追加版本。

## Monad Testnet 隔离验证通道

仓库另有一组 `monad-testnet-*` 脚本，仅用于在明确授权后验证
DesignRegistry 能否运行于 Monad Testnet。它们不会改变本地 API 的默认模式，
也不会把 `submit-local` 变成公开网络接口。

安全约束：

- 官方 RPC 固定为 `https://testnet-rpc.monad.xyz`，chainId 必须为 `10143`。
- 只使用全新一次性测试账户，不使用个人钱包、主网资产或真实客户数据。
- keystore 必须位于仓库外，并由加密 JSON、Windows DPAPI CurrentUser 和目录 ACL 共同保护。
- 私钥、助记词、口令和写操作授权令牌不得写入 `.env`、日志、证据文件或 Git。
- 所有写交易的 `value` 必须为零；发送前必须先模拟、估算 Gas、解析签名交易并再次核对 chainId。
- 钱包初始化与链上写操作使用两个不同的临时确认令牌；默认行为都是拒绝执行。

预期顺序：

1. `web3:monad:wallet:init` 创建仓库外的一次性加密账户。
2. `web3:monad:preflight` 只读核验网络、账户余额、部署模拟和 Gas 预算。
3. 余额不足时，只能由用户通过官方 `https://faucet.monad.xyz` 人工领取测试币。
4. 再次预检通过后，`web3:monad:deploy-smoke -- --execute-testnet` 才可部署并验证 V1 → V2 → 最终确认。
5. `web3:monad:verify` 从公开 RPC 独立回读交易、事件、版本父子关系和最终版本。

脚本存在或测试通过并不等于已经创建钱包、已经获得测试币、已经上链或达到生产就绪。
测试网记录也可能因网络重置而失效。
