# v3.9 Wave K — 接 UI 到内核 + Evidence 可导航 + 模块再跃迁

Date: 2026-07-24  
Prerequisite: Wave H/I/J/G

## 交付

### 1. 异构 resume 可见
- `public/modules/resume-hints.js`
- recovery 条 + worktree 结算卡展示 Claude/Codex/Kimi 原生命令
- 复制命令 / 复制 git 命令 / 打开路径（复制+提示）

### 2. 安全诊断页 remote-gates
- `index.html` 增加远程门闩区块 `#remote-gates-list`
- `renderRemoteGates()` 拉 `GET /api/security/remote-gates`
- 默认 blocked 卡片，不假装可开

### 3. Evidence 可导航
- Mission 证据节点可点击 → 会话流滚到对应 agent 消息并高亮
- mission-control 图节点带 `attemptId`；messageRoutes 透传 `sourceAttemptId`

### 4. 模块再跃迁
- `public/modules/agent-roles.js`（角色副标真源）
- server 静态白名单放行 modules/*

## 验证

```powershell
cd I:\514claude\514cc\apps\control-center
node --test `
  tests/orchestrator.test.mjs `
  tests/approval-lock.test.mjs `
  tests/mission-control.test.mjs `
  tests/mission-control-ui-contract.test.mjs `
  tests/remote-gates.test.mjs `
  tests/welcome-stream-modules.test.mjs `
  tests/resume-hints.test.mjs
```

目标：全绿。

## 诚实边界（仍不宣称）

- 跨 run 子 run 递归 cancel 未做
- Counterfactual 分支未做
- Wave G 远程能力未实现（仅门闩）
- 浏览器无法直接 `explorer.exe` 打开目录（复制路径代替）
