# v3.9 Wave I / J / G 落地纪要

Date: 2026-07-24  
Scope: `apps/control-center`  
Architecture lock: compositional Node control plane — **no Codeg fork**, **no LiveAgent Gateway as kernel**.

## Wave I — 协作内核（硬闸 + 权威图 + 异构 resume）

| 能力 | 实现 | 验证 |
|---|---|---|
| Capability Lease 签发 | `awaitBuildApproval` 批准后 `issueCapabilityLease`；事件 `capability.lease_issued` | orchestrator + approval-lock tests |
| Lease 强制 | `turn()` 在 workspace-write 前 `activeCapabilityLease`；过期/吊销 fail-closed | orchestrator tests |
| Lease 吊销 | `revokeCapabilityLease` / cancel / `revokeBuildGrants` | orchestrator tests |
| 权威 taskGraph 边 | `recordTaskGraphDelegation`；social 路由成功写 `delegations` + attempt 子任务 | taskGraph cancel test |
| Cancel 图 | cancel 标 tasks + edges `cancelled` | same |
| 异构 resume 契约 | `resumeHintsForRun` + adapter `canResume`/`resumeCommand`（Claude/Codex） | resume hints test |
| SSE streamEpoch 客户端 | header + ready 事件；epoch 变则 `lastEventSequence=0` + toast | modules + UI contract |

## Wave J — 前端模块化（渐进，不 React 化）

| 模块 | 路径 |
|---|---|
| stream epoch 纯函数 | `public/modules/stream-epoch.js` |
| welcome tips 目录 | `public/modules/welcome-tips.js` |
| 静态白名单 | `server.mjs` serveStatic 增加 modules/* |
| 独立测 | `tests/welcome-stream-modules.test.mjs` |

`app.js` 仍是主壳；后续可继续拆 palette/composer/rail。

## Wave G — 安全面骨架（fail-closed，未授权不开）

| 路径 | 行为 |
|---|---|
| `src/security/remote-gates.mjs` | Channels/Gateway/Office/PTY/SSH/SFTP/市场/remote_web 枚举 + 默认 blocked |
| `GET /api/security/remote-gates` | 快照 |
| `POST /api/security/remote-gates/open` | 一律 501 + 结构化 code（授权也 not-implemented） |
| `tests/remote-gates.test.mjs` | 4 用例 |

**不实现**远程安装器、公网绑定、PTY/SSH 实装——只焊死门闩，等 LO 单独授权再开实现波次。

## 验证

```powershell
cd I:\514claude\514cc\apps\control-center
node --test `
  tests/orchestrator.test.mjs `
  tests/approval-lock.test.mjs `
  tests/mission-control-ui-contract.test.mjs `
  tests/remote-gates.test.mjs `
  tests/welcome-stream-modules.test.mjs
# 67 pass / 0 fail
```

## 仍 blocked / 增强债

- 跨 run 子 run 递归 cancel（当前仍是单 run 图 + 可见 cascade 文案）
- Lease 在 Codex 常驻 thread 内二次 tool-approval 层（orchestrator 闸已有；thread 内工具审批仍是 broker 交互）
- Counterfactual 独立验证分支
- `app.js` 大规模拆包
- Wave G 真实实现（需 LO 授权 + 安全设计）
