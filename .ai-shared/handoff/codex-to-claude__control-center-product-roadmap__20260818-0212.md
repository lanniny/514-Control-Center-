<!-- 514cc-session-id: 01a00fb1-8675-7990-b545-9b22735b7ddb -->
# Codex 项目经理整理：Control Center v42 产品路线图

- **日期**：2026-08-18
- **角色**：项目经理视角；主驾保留最终取舍权
- **产物**：`proposals/v42-control-center-product-roadmap.md`
- **状态**：`DRAFT / NEEDS LO DECISION`
- **范围**：产品能力、用户工作流、交付治理、运行态、远程与协作消息生命周期

## 关键结论

1. 当前最重要的问题不是缺页面，而是“项目识别 → 派工 → 执行 → 协作 → 干预 → 证据 → 恢复 → 交付/激活”这条链没有全部可证明闭环。
2. 历史真实 provider 隔离闭环报告中文提示词到 CLI 变成 `?`（ASCII 正常），应先做 Windows/各 CLI 的 UTF-8 往返契约；这是新功能之前的产品 P0 候选，证据见 `kimi-to-claude__shutdown-chain-deadline__20260816-1137.md:100-110`。
3. `qa:delivery --strict` 的 55 个未跟踪源码/测试、v3.5.0 版本真源与 v4 波次漂移，以及 `.workflow/ultracode/collab-console-review-20260815/state.json` 的 `executing/in_progress/pending` 悬挂，共同构成发布真实性问题。
4. CCB Message Bureau 当前适合继续保持只读稳定投影；可写 Inbox 必须单独设计 Ask/Answer/ACK、CAS、幂等和审计，不能直接把浏览器变成第二个编排器。

## 优先级

### P0：可信发布基线

- Unicode/中文传输契约
- tracked ownership manifest + strict CI
- `source/runtime/process/evidence` 对账与 workflow 终态
- shutdown/provider 引用竞态及可重试关闭链

### P1：可理解、可恢复的主路径

- 稳定项目锚点 + Bridge Doctor
- 首次使用 readiness 向导
- Provider 派工预演器（成本缺失显示未知）
- 协作运行 replay/recovery read model
- Evidence/Artifact 卡

### P2：真正的团队协作与扩展

- Ask/Answer/ACK 生命周期、队列和注意力中心
- opt-in socialLoop
- 远程 agent 真实主机认证
- Skill/MCP 制品账本与供应链信任
- Channels/Office 的真实运营成熟化

## 暂缓项

- 全量 IDE 重写、可视化万能编排器、无限自治互聊
- 未有签名信任根前的一键市场/Updater
- CCB tmux/daemon/pane/mobile gateway 生命周期复制
- 以更多状态卡片替代稳定 read model 和证据链

## 推荐首批 DAG

```text
Unicode -> delivery manifest -> releaseTruth/workflow 终态
        -> shutdown/provider race -> anchor/Bridge Doctor
        -> dispatch preview -> replay/recovery -> Artifact
        -> Ask/Answer/ACK
```

## LO 需要拍板

1. 是否把 Unicode/中文传输列为当前唯一产品 P0？
2. v42 是否只收 P0，还是同时纳入稳定项目锚点/Doctor？
3. Inbox 是否先保持只读稳定版，再单独批准可写 ACK 生命周期？
4. 是否启动正式版本升格，结束 v3.5.0 与 v4 未发布波次的漂移？
5. 远程 agent 是否进入当前季度目标？

## 交付边界

- 未修改正式运行时、provider 凭据或运行中的 Control Center。
- 未执行 `git add/commit/push`。
- 路线图中的未验证能力均明确标为候选、待授权或待真实验收。

__VERDICT__: ROADMAP_DRAFT
__DELTA__: 烛(Codex) | 1 | 证据：`kimi-to-claude__shutdown-chain-deadline__20260816-1137.md:107` 将中文传输失真从普通技术债提升为产品主路径 P0 候选；`.workflow/ultracode/collab-console-review-20260815/state.json:6-36` 补出 workflow 终态悬挂这一发布治理缺口。
