# 故障复盘：WebSocket 测试在异步下线尚未完成时删除临时目录

## 基本信息

| 字段 | 内容 |
|------|------|
| 日期 | 2026-08-05 |
| 发现人 | Codex 自动化校验 |
| 严重程度 | P3-轻微 |
| 影响范围 | `test/worker-websocket.test.js` 与本地/CI 全量测试 |
| 关联 Issue/PR | 未关联 |
| 关联提交 | 未提交 |

## 1. 问题描述

### 1.1 问题场景

执行 `npm test` 时，Worker WebSocket 回归测试完成注册和任务分配断言后立即关闭连接、关闭 HTTP 服务并递归删除测试临时目录。

### 1.2 具体表现

11 项测试中有 10 项通过，WebSocket 测试在清理阶段失败；业务断言本身已通过。

### 1.3 错误信息

```text
Error: ENOTEMPTY: directory not empty, rmdir
'/var/folders/.../T/jewelchain-ws-<random>'
```

## 2. 根本原因分析

### 2.1 问题分析过程

1. 单独重复执行 WebSocket 测试，均在临时目录删除阶段复现失败，排除测试并发干扰。
2. 查看清理顺序，发现测试仅调用 `ws.close()`，没有等待客户端关闭事件或服务端的下线写入完成。
3. 查看 `backend/worker-websocket.js`，连接 `close` 监听器异步调用 `taskBroker.markWorkerOffline()`；EventEmitter 不会等待该 Promise。
4. `markWorkerOffline()` 继续经由 `JewelChainStore.update()` 写入 `state.json`。测试已开始递归删除根目录时，该写入可能重新创建状态文件，因此删除目录报 `ENOTEMPTY`。

### 2.2 直接原因

`backend/worker-websocket.js` 的连接关闭处理没有提供可等待的异步生命周期；`test/worker-websocket.test.js` 因而在下线持久化仍在执行时删除临时目录。

相关位置：

- `backend/worker-websocket.js:105-116`
- `backend/worker-websocket.js:180-187`
- `test/worker-websocket.test.js:59-69`

### 2.3 根本原因

- 设计层面：WebSocket Hub 仅处理消息发送和任务调度，未公开其后台异步操作的收敛点。
- 开发层面：测试清理把 `ws.close()` 误当作服务端下线处理已经完成。
- 流程层面：此前用例只覆盖注册和派发成功，没有验证断连持久化完成后再回收测试资源。

### 2.4 为什么没有提前发现

- 代码审查未将 EventEmitter 监听器返回的 Promise 不会被等待列为检查项。
- 测试没有显式等待 WebSocket `close` 事件和服务端的异步任务空闲状态。

## 3. 解决方案

### 3.1 根本解决方案

`WorkerWebSocketHub` 现在跟踪消息与断连触发的 Promise，并提供 `waitForIdle()`。测试在删除临时目录前等待 WebSocket 关闭、HTTP 服务关闭和 Hub 空闲。

该方案不改变 Worker 协议、认证、任务派发或持久化行为，只明确异步生命周期边界。

### 3.2 影响范围评估

- 浏览器/Worker 协议不变。
- 生产运行继续异步处理断连；新增跟踪集合会在 Promise 结束后立即移除引用。
- 回归测试可以可靠回收临时状态目录。

## 4. 预防措施

### 4.1 代码层面

- [x] 对 Hub 触发的后台 Promise 提供 `waitForIdle()` 收敛点。
- [ ] 后续新增 EventEmitter 异步监听器时，明确其错误处理和关闭语义。

### 4.2 测试层面

- [x] WebSocket 测试在清理前等待客户端关闭和 Hub 空闲。
- [ ] 新增断连后 Worker 状态变为离线的断言。

### 4.3 流程/规范层面

- [x] 在项目结构文档中保留完整校验入口 `npm run check`。

## 5. 经验总结

> 对会落盘的异步断连处理，资源清理必须等待业务 Promise 收敛，不能只等待网络连接发起关闭。
