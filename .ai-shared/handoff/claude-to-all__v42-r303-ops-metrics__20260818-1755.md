<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->

# v42 R3-03 指标与运营观测

- 时间：2026-08-18
- 决策：`D-2026-08-18-009`
- 正式版本：仍 v3.5.0；正式实例未 reload；未 git add

## 落地

1. `apps/control-center/src/ops-metrics.mjs`：`514cc.ops-metrics/v1` 从当前进程内存合成八项低敏指标。
2. `GET /api/observability/ops`；健康面 `peekMeta()`，不为此打探针。
3. 体系观测页增加运营指标卡与八行明细表。空样本和缺失成本显示「未知」。
4. Orchestrator 在 `adapter.fallback` 时累加 `adapterFallbackCount`。
5. 测试：缺失 costUsd 不进均值；空窗口比率保持 `null`。聚焦 **20/20 pass**（ops-metrics + health.peekMeta + lucide sprite）。

## 诚实边界

- 这是 live 内存快照，不是时序库；重启后窗口清空。
- 审批等待只观测 pending 队列（已决议审批离开 broker）。
- 烛独立评审通道本轮不可用。handoff 标 partial。
- 不声称正式实例已激活；不升正式版本。

## LO 体感

打开「体系观测」：治理四卡下面多一排运营指标。没有跑过任务时卡片写「未知」，不会出现假的 0% 或 $0.00。有回执但没成本的 turn 会从可用率分母里露出「未知」，不拉低均值。

__DELTA__: 主驾 | 1 | 证据：ops-metrics 未知成本不当 0；烛通道残差已明示
