import test from "node:test";
import assert from "node:assert/strict";
import {
  buildViewModel,
  collapseSeries,
  compositeTrendSvg,
  formatCount,
  formatExact,
  formatMoney,
  formatPercent,
  runBillingModel,
  runProviderLabel,
  sanitizeUsageLog,
  stackedBarSvg,
  stackedAreaSvg,
  summarizeRuns,
  normalizeTrendBuckets,
} from "../public/modules/overview-usage.js";

test("formatters stay honest on empty and small numbers", () => {
  assert.equal(formatCount(null), "--");
  assert.equal(formatCount(12), "12");
  assert.equal(formatExact(142298), "142,298");
  assert.equal(formatMoney(0), "$0.00");
  assert.equal(formatMoney(0.0031), "$0.0031");
  assert.equal(formatPercent(null), "--");
  assert.equal(formatPercent(0.9713), "97.13%");
});

test("summarizeRuns only counts the selected window and does not invent cost", () => {
  const now = Date.parse("2026-08-16T10:00:00.000Z");
  const runs = [
    {
      id: "old",
      status: "completed",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:01:00.000Z",
      costUsdTotal: 99,
      turns: [{ tokens: 8000, costUsd: 99 }],
      requestedProvider: "claude-fable",
    },
    {
      id: "ok",
      status: "completed",
      createdAt: "2026-08-16T09:00:00.000Z",
      updatedAt: "2026-08-16T09:01:00.000Z",
      costUsdTotal: 0.12,
      turns: [{ tokens: 1200, costUsd: 0.12 }],
      requestedProvider: "claude-fable",
    },
    {
      id: "fail",
      status: "failed",
      createdAt: "2026-08-16T09:30:00.000Z",
      updatedAt: "2026-08-16T09:31:00.000Z",
      costUsdTotal: 0.01,
      turns: [{ tokens: 80, costUsd: 0.01 }],
      requestedProvider: "codex-technical",
    },
  ];
  const summary = summarizeRuns(runs, { days: 1, now });
  assert.equal(summary.summary.totalRequests, 2);
  assert.equal(summary.summary.failedRequests, 1);
  assert.equal(summary.summary.costUsd, 0.13);
  assert.equal(summary.summary.tokens, 1280);
  assert.equal(summary.models.length, 1);
  assert.equal(summary.models[0].key, "未记录");
  assert.deepEqual(summary.providers.map((item) => item.key).sort(), ["claude", "codex"]);
  assert.ok(summary.trends.length >= 20);
});

test("run billing model uses turn effectiveModel and never falls back to member or seat ids", () => {
  assert.equal(runBillingModel({
    startAgentId: "member-051ef0d3-2bca-4e61-9c0f-69ab20abe400",
    requestedProvider: "kimi-frontend",
    model: "kimi-frontend",
    turns: [{ effectiveModel: "kimi-k2.5", requestedModel: "kimi-frontend" }],
  }), "kimi-k2.5");
  assert.equal(runBillingModel({
    startAgentId: "claude-fable",
    requestedProvider: "claude-fable",
    modelOverride: "claude-sonnet-4-6",
    turns: [],
  }), "claude-sonnet-4-6");
  assert.equal(runBillingModel({
    startAgentId: "member-d744e1be-2ca0-48eb-912c-73fbf538d7fc",
    requestedProvider: "codex-technical",
    turns: [{ tokens: 80 }],
  }), "未记录");
  assert.equal(runProviderLabel({
    startAgentId: "member-051ef0d3-2bca-4e61-9c0f-69ab20abe400",
    requestedProvider: "kimi-frontend",
    turns: [{ providerBinding: { providerApp: "kimi" } }],
  }), "kimi");
  const grouped = summarizeRuns([
    {
      id: "a",
      status: "completed",
      createdAt: "2026-08-16T09:00:00.000Z",
      updatedAt: "2026-08-16T09:01:00.000Z",
      startAgentId: "member-051ef0d3-2bca-4e61-9c0f-69ab20abe400",
      requestedProvider: "claude-fable",
      turns: [{ effectiveModel: "claude-opus-4-6", tokens: 100, costUsd: 0.2 }],
      costUsdTotal: 0.2,
    },
    {
      id: "b",
      status: "completed",
      createdAt: "2026-08-16T09:10:00.000Z",
      updatedAt: "2026-08-16T09:11:00.000Z",
      startAgentId: "kimi-frontend",
      requestedProvider: "kimi-frontend",
      turns: [{ tokens: 10 }],
    },
  ], { days: 1, now: Date.parse("2026-08-16T10:00:00.000Z") });
  assert.deepEqual(grouped.models.map((item) => item.key).sort(), ["claude-opus-4-6", "未记录"]);
  assert.equal(grouped.logs[0].model, "未记录");
  assert.equal(grouped.logs[1].model, "claude-opus-4-6");
  assert.doesNotMatch(JSON.stringify(grouped.models), /member-|kimi-frontend|claude-fable/);
});

test("buildViewModel keeps empty proxy dashboards blank", () => {
  const empty = buildViewModel({ summary: { totalRequests: 0, requests: 0, failedRequests: 0, costUsd: 0, tokens: 0 } }, { source: "proxy", days: 7 });
  assert.equal(empty.empty, true);
  assert.match(empty.emptyTitle, /还没有调用记录/);
  assert.equal(empty.kpis[0].value, "--");
  assert.equal(empty.hero.tokensExact, "--");
  assert.equal(empty.hero.cost, "--");
  const error = buildViewModel(null, { source: "proxy", days: 7, error: new Error("proxy store blocked") });
  assert.equal(error.empty, true);
  assert.match(error.emptyTitle, /暂不可读/);
  assert.match(error.emptyDetail, /blocked/);
});

test("buildViewModel exposes hero numbers and sanitized logs without inventing cache hits", () => {
  const model = buildViewModel({
    summary: { totalRequests: 2, requests: 1, failedRequests: 1, tokens: 150, inputTokens: 100, outputTokens: 50, costUsd: 0.02, successRate: 0.5 },
    models: [{ key: "claude-sonnet", requests: 1, failed: 1, tokens: 150, costUsd: 0.02, successRate: 0.5 }],
    providers: [{ key: "prov-a", requests: 1, failed: 1, tokens: 150, costUsd: 0.02, successRate: 0.5 }],
    logs: [{ id: "ok-1", startedAt: "2026-08-16T09:00:00.000Z", app: "claude", providerName: "Claude", model: "claude-sonnet", inputTokens: 100, outputTokens: 50, costUsd: 0.02, success: true, httpStatus: 200, secret: "nope" }],
    trends: [{ key: "2026-08-16T09", day: "2026-08-16", hour: 9, inputTokens: 100, outputTokens: 50, tokens: 150, costUsd: 0.02, requests: 1 }],
  }, { source: "proxy", days: 1 });
  assert.equal(model.empty, false);
  assert.equal(model.hero.tokensExact, "150");
  assert.equal(model.hero.cost, "$0.02");
  assert.equal(model.split[0].value, "100");
  assert.equal(model.logs[0].inputTokens, 100);
  assert.equal(model.logs[0].secret, undefined);
  assert.doesNotMatch(JSON.stringify(model), /缓存命中|92\.9%/);
});

test("sanitizeUsageLog only keeps public ledger fields", () => {
  const row = sanitizeUsageLog({ id: "x", startedAt: "2026-08-16T09:00:00.000Z", app: "claude", model: "m", inputTokens: 10, outputTokens: 5, costUsd: 0.1, success: true, httpStatus: 200, requestBody: "secret", attempts: [] });
  assert.deepEqual(Object.keys(row).sort(), ["app", "costUsd", "durationMs", "httpStatus", "id", "inputTokens", "model", "outputTokens", "providerId", "providerName", "startedAt", "success", "tokens"]);
  assert.equal(row.tokens, 15);
  assert.equal(row.requestBody, undefined);
});

test("legacy daily trends without models collapse into a single 合计 series", () => {
  const buckets = normalizeTrendBuckets([
    { day: "2026-08-16", requests: 4, inputTokens: 10, outputTokens: 5, costUsd: 0.2 },
  ]);
  assert.equal(buckets[0].key, "2026-08-16");
  assert.equal(buckets[0].models["合计"].tokens, 15);
  assert.equal(buckets[0].models["合计"].costUsd, 0.2);
});

test("stacked charts render real series and collapse overflow into 其他", () => {
  const buckets = [
    {
      key: "2026-08-16T09",
      day: "2026-08-16",
      hour: 9,
      requests: 3,
      failed: 1,
      costUsd: 0.3,
      models: {
        a: { requests: 1, failed: 0, costUsd: 0.1, tokens: 10 },
        b: { requests: 1, failed: 0, costUsd: 0.1, tokens: 10 },
        c: { requests: 1, failed: 1, costUsd: 0.1, tokens: 10 },
      },
    },
  ];
  const collapsed = collapseSeries(buckets, { limit: 2, metric: "costUsd" });
  assert.equal(collapsed.keys.length, 3);
  assert.ok(collapsed.keys.includes("其他"));
  assert.ok(collapsed.keys.slice(0, 2).every((key) => ["a", "b", "c"].includes(key)));
  const bar = stackedBarSvg(collapsed.buckets, collapsed.keys, { metric: "costUsd", label: "额度分布" });
  assert.match(bar, /<svg /);
  assert.match(bar, /<rect /);
  const area = stackedAreaSvg(collapsed.buckets, collapsed.keys, { metric: "requests", label: "调用趋势" });
  assert.match(area, /<path /);
  const trend = compositeTrendSvg([{
    key: "2026-08-16T09",
    day: "2026-08-16",
    hour: 9,
    inputTokens: 100,
    outputTokens: 20,
    tokens: 120,
    costUsd: 0.4,
  }], { label: "使用趋势", split: true });
  assert.match(trend, /overview-trend-input/);
  assert.match(trend, /overview-trend-output/);
  assert.match(trend, /overview-trend-cost/);
});
