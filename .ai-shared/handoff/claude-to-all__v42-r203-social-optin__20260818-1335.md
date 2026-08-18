<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->
# R2-03 受控社会协作：social 改为显式 opt-in

- **时间**：2026-08-18 13:35 +08:00
- **范围**：项目经理方案 R2-03
- **正式版本**：仍为 v3.5.0
- **独立评审**：
  - R1 `.ai-shared/handoff/codex-to-claude__v42-r203-social-optin__20260818-1315.md`（烛 DELTA=1，自动化侧门当场收）
  - R2 `.ai-shared/handoff/codex-to-claude__v42-r203-social-optin-r2__20260818-1325.md`（烛 APPROVED）

## LO 能看见什么

1. 普通发送走 **Pipeline**，不会自动互聊。
2. 输入框写 `/social …` 才进社会模拟；任务条会标「社会模拟」。
3. 互聊必须点名收件人。同一对来回超过 2 跳会被丢掉，并写进总线。
4. 自动化：没点名同事就按流水线跑；点了名才会显式开社会模拟。

## 实现

- `src/social-contract.mjs`：mode 解析、composer `/social`、合同（轮次/预算/深度/乒乓）
- `orchestrator.create` 缺省 pipeline；`socialContract` 落在 run 上
- `appendBus` 无收件人拒绝；`socialLoop` 用 `classifyAgentRoute`
- composer 默认 `orchestrationMode: "pipeline"`
- 自动化 trigger / create / update 落盘并传递 mode

## 烛推翻（已收）

自动化仍带 `requestedAgentIds` 却不声明 social，真触发会撞门失败。现有点名就传 social，否则 pipeline。

## 验证

- social-orchestration + contract：81 pass / 0 fail
- automations + contract：21 pass / 0 fail
- 未 reload 正式实例，未 git add，**不能称为已激活**

## 没做

R3 Delivery Gate 2.0、R4、无限互聊、从终态文本反推团队图、正式版本升格。

__DELTA__: 烛(Codex) | 1 | 证据：automations.mjs trigger 侧门已收。见 codex-to-claude__v42-r203-social-optin__20260818-1315.md
