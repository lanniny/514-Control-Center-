/**
 * 系统总览 · 调用分析
 * 代理流量是成本真源；协作任务是原生 CLI 会话。缺数据就空着，不填演示数字。
 */

import { escapeHtml } from "../utils.js";

export const USAGE_DAYS = Object.freeze([1, 7, 30]);
export const USAGE_SOURCES = Object.freeze(["proxy", "runs"]);
export const FAILED_RUN_STATES = Object.freeze(["failed", "blocked", "cancelled", "canceled"]);
export const SUCCESS_RUN_STATES = Object.freeze(["complete", "completed", "succeeded"]);

export const SERIES_COLORS = Object.freeze([
  "oklch(0.55 0.13 38)",
  "oklch(0.62 0.10 55)",
  "oklch(0.48 0.08 30)",
  "oklch(0.70 0.08 70)",
  "oklch(0.58 0.07 20)",
  "oklch(0.52 0.09 80)",
  "oklch(0.64 0.05 45)",
  "oklch(0.44 0.07 50)",
  "oklch(0.68 0.06 90)",
  "oklch(0.50 0.04 15)",
]);

const icon = (name) => `<svg class="icon lucide" aria-hidden="true"><use href="#lucide-${name}"></use></svg>`;

export function formatCount(value) {
  if (value == null || value === "") return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const abs = Math.abs(number);
  if (abs >= 100_000_000) return `${(number / 100_000_000).toFixed(1)}亿`;
  if (abs >= 10_000) return `${(number / 10_000).toFixed(abs >= 100_000 ? 0 : 1)}万`;
  return Math.round(number).toLocaleString("zh-CN");
}

export function formatMoney(value) {
  if (value == null || value === "") return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (number === 0) return "$0.00";
  return number < 0.01 ? `$${number.toFixed(4)}` : `$${number.toFixed(2)}`;
}

export function formatExact(value) {
  if (value == null || value === "") return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return Math.round(number).toLocaleString("zh-CN");
}

export function formatTokenShort(value) {
  if (value == null || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const abs = Math.abs(number);
  if (abs >= 100_000_000) return `~ ${(number / 100_000_000).toFixed(2)} 亿`;
  if (abs >= 10_000) return `~ ${(number / 10_000).toFixed(1)} 万`;
  if (abs >= 1000) return `~ ${(number / 1000).toFixed(1)} k`;
  return "";
}

export function formatStamp(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "--";
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function sanitizeUsageLog(entry) {
  const inputTokens = Number(entry?.inputTokens) || 0;
  const outputTokens = Number(entry?.outputTokens) || 0;
  const tokens = Number(entry?.tokens) || (inputTokens + outputTokens);
  return {
    id: entry?.id ?? null,
    startedAt: entry?.startedAt ?? null,
    app: entry?.app || null,
    providerId: entry?.providerId || null,
    providerName: entry?.providerName || entry?.providerId || null,
    model: entry?.model || null,
    inputTokens,
    outputTokens,
    tokens,
    costUsd: Number(entry?.costUsd) || 0,
    success: Boolean(entry?.success),
    httpStatus: entry?.httpStatus ?? null,
    durationMs: Number.isFinite(Number(entry?.durationMs)) ? Number(entry.durationMs) : null,
  };
}

export function costPerMillion(costUsd, tokens) {
  const cost = Number(costUsd);
  const count = Number(tokens);
  if (!Number.isFinite(cost) || !Number.isFinite(count) || count <= 0) return null;
  return (cost / count) * 1_000_000;
}

export function formatTokens(value) {
  if (value == null || value === "") return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const abs = Math.abs(number);
  if (abs >= 100_000_000) return `${(number / 100_000_000).toFixed(1)}亿`;
  if (abs >= 10_000) return `${(number / 10_000).toFixed(1)}万`;
  if (abs >= 1000) return `${(number / 1000).toFixed(1)}k`;
  return String(Math.round(number));
}

export function formatPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

export function formatDurationMs(value) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  const ms = Number(value);
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export function formatRate(value, digits = 2) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "--";
  const number = Number(value);
  if (number >= 10_000) return formatCount(number);
  if (number >= 100) return number.toFixed(0);
  if (number >= 10) return number.toFixed(1);
  return number.toFixed(digits);
}

export function seriesColor(index) {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

export function collapseSeries(buckets, { limit = 8, metric = "costUsd" } = {}) {
  const totals = new Map();
  for (const bucket of buckets || []) {
    for (const [key, item] of Object.entries(bucket.models || {})) {
      totals.set(key, (totals.get(key) || 0) + Number(item[metric] ?? item.requests ?? 0));
    }
  }
  const ranked = [...totals.entries()].sort((left, right) => right[1] - left[1]);
  const keep = ranked.slice(0, limit).map(([key]) => key);
  const keepSet = new Set(keep);
  const overflow = ranked.slice(limit).map(([key]) => key);
  const keys = overflow.length ? [...keep, "其他"] : keep;
  return {
    keys,
    buckets: (buckets || []).map((bucket) => {
      const models = {};
      const other = { requests: 0, failed: 0, costUsd: 0, tokens: 0 };
      for (const [key, item] of Object.entries(bucket.models || {})) {
        if (keepSet.has(key)) {
          models[key] = item;
          continue;
        }
        other.requests += Number(item.requests) || 0;
        other.failed += Number(item.failed) || 0;
        other.costUsd += Number(item.costUsd) || 0;
        other.tokens += Number(item.tokens) || 0;
      }
      if (overflow.length) models["其他"] = other;
      return { ...bucket, models };
    }),
  };
}

function runStamp(run) {
  return Date.parse(run?.updatedAt || run?.createdAt || 0);
}

function runTokens(run) {
  return (run?.turns || []).reduce((sum, turn) => sum + (Number(turn.tokens) || 0), 0);
}

function runCost(run) {
  const total = Number(run?.costUsdTotal);
  if (Number.isFinite(total) && total >= 0) return total;
  return (run?.turns || []).reduce((sum, turn) => sum + (Number(turn.costUsd) || 0), 0);
}

const KNOWN_SEATS = new Set([
  "claude-fable",
  "codex-technical",
  "codex-technical-fallback",
  "kimi-frontend",
  "gemini-research",
  "grok-search",
  "grok-build",
  "pi-resident",
]);

const MODEL_PLACEHOLDERS = new Set(["", "—", "-", "unknown", "运行时选择", "未记录"]);

export function looksLikeSeatOrMember(value) {
  const key = String(value || "").trim();
  if (!key) return false;
  if (key.startsWith("member-")) return true;
  return KNOWN_SEATS.has(key);
}

function cleanModelName(value) {
  const key = String(value || "").trim();
  if (!key || MODEL_PLACEHOLDERS.has(key) || looksLikeSeatOrMember(key)) return "";
  return key;
}

export function runBillingModel(run) {
  const fromTurns = (run?.turns || [])
    .map((turn) => cleanModelName(turn?.effectiveModel || turn?.requestedModel || turn?.model))
    .filter(Boolean);
  if (fromTurns.length) {
    const counts = new Map();
    for (const model of fromTurns) counts.set(model, (counts.get(model) || 0) + 1);
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
  }
  return cleanModelName(run?.modelOverride || run?.model) || "未记录";
}

export function runProviderLabel(run) {
  const bindings = (run?.turns || []).map((turn) => turn?.providerBinding).filter(Boolean);
  for (const binding of bindings.slice().reverse()) {
    const label = String(binding.providerApp || binding.effectiveProviderId || "").trim();
    if (label && !looksLikeSeatOrMember(label)) return label;
  }
  return providerBrandFromSeat(run?.requestedProvider || run?.startAgentId || run?.agentId);
}

export function runMemberKey(run) {
  return String(run?.startAgentId || run?.requestedProvider || run?.agentId || "").trim() || "unknown";
}

function providerBrandFromSeat(value) {
  const key = String(value || "").toLowerCase();
  if (key.includes("codex")) return "codex";
  if (key.includes("kimi")) return "kimi";
  if (key.includes("gemini")) return "gemini";
  if (key.includes("grok-search") || key.includes("grok_search")) return "grok-search";
  if (key.includes("grok")) return "grok-build";
  if (key.includes("pi")) return "pi";
  if (key.includes("claude") || key.includes("fable")) return "claude";
  return "unknown";
}

function runSeriesKey(run) {
  return runBillingModel(run);
}

function runDurationMs(run) {
  const start = Date.parse(run?.createdAt);
  const end = Date.parse(run?.completedAt || run?.updatedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function trendGrain(days) {
  return Number(days) <= 1 ? "hour" : "day";
}

function bucketKeyFromStamp(stamp, grain) {
  const iso = new Date(stamp).toISOString();
  return grain === "hour" ? iso.slice(0, 13) : iso.slice(0, 10);
}

function emptyBucket(key, grain) {
  const bucket = { key, day: key.slice(0, 10), requests: 0, failed: 0, costUsd: 0, tokens: 0, models: {} };
  if (grain === "hour") bucket.hour = Number(key.slice(11, 13));
  return bucket;
}

export function normalizeTrendBuckets(items) {
  return (items || []).map((bucket) => {
    const key = bucket.key || bucket.day;
    if (bucket.models && Object.keys(bucket.models).length) {
      return { ...bucket, key, day: bucket.day || String(key).slice(0, 10) };
    }
    const tokens = Number(bucket.tokens) || ((Number(bucket.inputTokens) || 0) + (Number(bucket.outputTokens) || 0));
    return {
      ...bucket,
      key,
      day: bucket.day || String(key).slice(0, 10),
      models: {
        合计: {
          requests: Number(bucket.requests) || 0,
          failed: Number(bucket.failed) || 0,
          costUsd: Number(bucket.costUsd) || 0,
          tokens,
        },
      },
    };
  });
}

export function fillTrendBuckets(items, { days = 7, now = Date.now() } = {}) {
  const grain = trendGrain(days);
  const step = grain === "hour" ? 3_600_000 : 86_400_000;
  const since = now - Number(days) * 86_400_000;
  const aligned = grain === "hour"
    ? Math.floor(since / step) * step
    : Date.parse(`${new Date(since).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const map = new Map((items || []).map((item) => [item.key || item.day, item]));
  const buckets = [];
  for (let ts = aligned; Number.isFinite(ts) && ts <= now; ts += step) {
    const key = bucketKeyFromStamp(ts, grain);
    buckets.push(map.get(key) || emptyBucket(key, grain));
  }
  return buckets;
}

export function summarizeRuns(runs, { days = 7, now = Date.now() } = {}) {
  const windowDays = Number(days) || 7;
  const since = now - windowDays * 86_400_000;
  const items = (runs || []).filter((run) => {
    const stamp = runStamp(run);
    return Number.isFinite(stamp) && stamp >= since;
  });
  const success = items.filter((run) => SUCCESS_RUN_STATES.includes(run.status));
  const failed = items.filter((run) => FAILED_RUN_STATES.includes(run.status));
  const tokens = items.reduce((sum, run) => sum + runTokens(run), 0);
  const costUsd = items.reduce((sum, run) => sum + runCost(run), 0);
  const durations = items.map(runDurationMs).filter((value) => value != null);
  const durationMs = durations.reduce((sum, value) => sum + value, 0);
  const windowMinutes = Math.max(1, (now - since) / 60_000);
  const grain = trendGrain(windowDays);
  const bucketMap = new Map();
  for (const run of items) {
    const key = bucketKeyFromStamp(runStamp(run), grain);
    const bucket = bucketMap.get(key) || emptyBucket(key, grain);
    const series = runSeriesKey(run);
    const model = bucket.models[series] ?? (bucket.models[series] = { requests: 0, failed: 0, costUsd: 0, tokens: 0 });
    const cost = runCost(run);
    const tokenCount = runTokens(run);
    if (FAILED_RUN_STATES.includes(run.status)) {
      bucket.failed += 1;
      model.failed += 1;
    } else {
      bucket.requests += 1;
      model.requests += 1;
    }
    bucket.costUsd += cost;
    bucket.tokens += tokenCount;
    model.costUsd += cost;
    model.tokens += tokenCount;
    bucketMap.set(key, bucket);
  }
  const models = [...items.reduce((groups, run) => {
    const key = runBillingModel(run);
    const item = groups.get(key) ?? { key, requests: 0, failed: 0, costUsd: 0, tokens: 0 };
    if (FAILED_RUN_STATES.includes(run.status)) item.failed += 1;
    else item.requests += 1;
    item.costUsd += runCost(run);
    item.tokens += runTokens(run);
    groups.set(key, item);
    return groups;
  }, new Map()).values()].map((item) => {
    const totalRequests = item.requests + item.failed;
    return { ...item, totalRequests, successRate: totalRequests ? item.requests / totalRequests : null };
  }).sort((left, right) => right.costUsd - left.costUsd || right.requests - left.requests);

  const terminal = items.filter((run) => SUCCESS_RUN_STATES.includes(run.status) || FAILED_RUN_STATES.includes(run.status));
  const providers = [...items.reduce((groups, run) => {
    const key = runProviderLabel(run);
    const item = groups.get(key) ?? { key, requests: 0, failed: 0, costUsd: 0, tokens: 0, inputTokens: 0, outputTokens: 0 };
    if (FAILED_RUN_STATES.includes(run.status)) item.failed += 1;
    else item.requests += 1;
    item.costUsd += runCost(run);
    item.tokens += runTokens(run);
    groups.set(key, item);
    return groups;
  }, new Map()).values()].map((item) => {
    const totalRequests = item.requests + item.failed;
    return { ...item, totalRequests, successRate: totalRequests ? item.requests / totalRequests : null };
  }).sort((left, right) => right.costUsd - left.costUsd || right.requests - left.requests);
  const logs = [...items]
    .sort((left, right) => runStamp(right) - runStamp(left))
    .slice(0, 80)
    .map((run) => ({
      id: run.id,
      startedAt: run.updatedAt || run.createdAt,
      app: runMemberKey(run),
      providerId: runProviderLabel(run),
      providerName: runProviderLabel(run),
      model: runBillingModel(run),
      inputTokens: 0,
      outputTokens: 0,
      tokens: runTokens(run),
      costUsd: runCost(run),
      success: SUCCESS_RUN_STATES.includes(run.status),
      httpStatus: run.status,
      durationMs: runDurationMs(run),
    }));
  return {
    source: "runs",
    summary: {
      requests: items.length - failed.length,
      failedRequests: failed.length,
      totalRequests: items.length,
      successRate: terminal.length ? success.length / terminal.length : null,
      tokens,
      inputTokens: null,
      outputTokens: null,
      costUsd,
      avgDurationMs: durations.length ? durationMs / durations.length : null,
      windowDays,
      windowMinutes,
      rpm: items.length / windowMinutes,
      tpm: tokens / windowMinutes,
      throughputTps: durationMs > 0 ? tokens / (durationMs / 1000) : null,
      completed: success.length,
    },
    trends: fillTrendBuckets([...bucketMap.values()], { days: windowDays, now }),
    models,
    providers,
    logs,
  };
}

function kpi(iconName, label, value, detail) {
  return { icon: iconName, label, value, detail };
}

function emptyKpis(source) {
  const unit = source === "runs" ? "任务" : "请求";
  return [
    kpi("activity", `总${unit}数`, "--", "等待真实记录"),
    kpi("wallet", "总额度", "--", "无费用数据"),
    kpi("layers", "总 TOKEN 数", "--", "无 token 数据"),
    kpi("gauge", source === "runs" ? "平均任务频率" : "平均 RPM", "--", "窗口内次数 / 分钟"),
    kpi("timer", source === "runs" ? "平均 TPM" : "平均 TPM", "--", "窗口内 token / 分钟"),
  ];
}

export function buildViewModel(payload, { source = "proxy", days = 7, error = null } = {}) {
  const summary = payload?.summary ?? {};
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const providers = Array.isArray(payload?.providers) ? payload.providers : [];
  const logs = (Array.isArray(payload?.logs) ? payload.logs : []).map(sanitizeUsageLog);
  const trends = normalizeTrendBuckets(Array.isArray(payload?.trends) ? payload.trends : []);
  const total = Number(summary.totalRequests || 0);
  const empty = Boolean(error) || !total;
  const unit = source === "runs" ? "任务" : "请求";
  const tokenTotal = Number(summary.tokens ?? ((Number(summary.inputTokens) || 0) + (Number(summary.outputTokens) || 0))) || 0;
  const hasIoSplit = source === "proxy" && (summary.inputTokens != null || summary.outputTokens != null);
  const kpis = empty
    ? emptyKpis(source)
    : [
      kpi("activity", `总${unit}数`, formatCount(summary.totalRequests), `${formatCount(summary.requests)} 成功 · ${formatCount(summary.failedRequests)} 失败`),
      kpi("wallet", "总额度", formatMoney(summary.costUsd), source === "proxy" ? "代理计价 · 无定价则记 $0" : "任务累计 costUsd"),
      kpi("layers", "总 TOKEN 数", formatTokens(tokenTotal), hasIoSplit ? `输入 ${formatTokens(summary.inputTokens)} · 输出 ${formatTokens(summary.outputTokens)}` : "来自已记账回合"),
      kpi("gauge", source === "runs" ? "平均任务频率" : "平均 RPM", formatRate(summary.rpm), `${summary.windowDays || days} 天窗口 · 每分钟`),
      kpi("timer", "平均 TPM", formatRate(summary.tpm, 1), `${summary.windowDays || days} 天窗口 · token / 分钟`),
    ];
  const successTone = summary.successRate == null
    ? "neutral"
    : summary.successRate >= 0.98 ? "ok" : summary.successRate >= 0.9 ? "warning" : "error";
  const modelOptions = [...new Set([
    ...models.map((item) => item.key).filter(Boolean),
    ...logs.map((item) => item.model).filter(Boolean),
  ])];
  return {
    source,
    days,
    empty,
    error: error ? String(error.message || error) : null,
    emptyTitle: error
      ? (source === "proxy" ? "代理用量暂不可读" : "任务用量暂不可读")
      : (source === "proxy" ? "代理还没有调用记录" : "这个窗口里还没有协作任务"),
    emptyDetail: error
      ? String(error.message || error)
      : (source === "proxy"
        ? "启动本地模型代理并产生真实请求后，次数、费用和趋势才会出现。这里不会用演示数字填满。"
        : "从协作台发起任务后，这里按真实会话记账。没有任务就保持空白。"),
    sourceNote: source === "proxy"
      ? "代理流量是成本真源。原生 CLI 会话请切到「协作任务」。"
      : "协作任务来自本机编排会话，不与代理流水合并，避免重复记账。",
    kpis,
    hero: {
      tokensExact: empty ? "--" : formatExact(tokenTotal),
      tokensShort: empty ? "" : formatTokenShort(tokenTotal),
      requests: empty ? "--" : formatExact(summary.totalRequests),
      cost: empty ? "--" : formatMoney(summary.costUsd),
    },
    split: [
      { label: "输入", value: empty || !hasIoSplit ? "--" : formatTokens(summary.inputTokens), note: source === "runs" ? "任务未分列输入输出" : "" },
      { label: "输出", value: empty || !hasIoSplit ? "--" : formatTokens(summary.outputTokens), note: "" },
      { label: "成功率", value: empty ? "--" : formatPercent(summary.successRate), tone: successTone },
      { label: "平均响应", value: empty ? "--" : formatDurationMs(summary.avgDurationMs), tone: "neutral" },
    ],
    hasIoSplit,
    perf: [
      { label: "成功率", value: formatPercent(summary.successRate), tone: successTone },
      { label: "平均响应", value: formatDurationMs(summary.avgDurationMs), tone: "neutral" },
      { label: source === "runs" ? "吞吐" : "吞吐率", value: summary.throughputTps == null ? "--" : `${formatRate(summary.throughputTps, 1)} t/s`, tone: "neutral" },
    ],
    models,
    providers,
    logs,
    modelOptions,
    buckets: trends,
    totals: {
      costUsd: Number(summary.costUsd) || 0,
      requests: Number(summary.totalRequests) || 0,
      tokens: tokenTotal,
    },
  };
}

function metricFromModel(item, metric) {
  if (metric === "errors") return Number(item?.failed) || 0;
  if (metric === "costUsd") return Number(item?.costUsd) || 0;
  if (metric === "tokens") return Number(item?.tokens) || 0;
  return Number(item?.requests) || 0;
}

function bucketTotal(bucket, metric) {
  if (metric === "errors") return Number(bucket.failed) || 0;
  if (metric === "costUsd") return Number(bucket.costUsd) || 0;
  if (metric === "tokens") return Number(bucket.tokens) || 0;
  return Number(bucket.requests) || 0;
}

function formatTick(bucket) {
  if (bucket.hour != null && Number.isFinite(bucket.hour)) {
    return `${String(bucket.day || bucket.key).slice(5, 10)} ${String(bucket.hour).padStart(2, "0")}:00`;
  }
  return String(bucket.day || bucket.key).slice(5, 10);
}

function svgFrame(width, height, plot, children, ariaLabel) {
  return `<svg class="overview-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(ariaLabel)}">${children}${plot.labels}</svg>`;
}

function axisLabels(buckets, plot) {
  if (!buckets.length) return "";
  const first = formatTick(buckets[0]);
  const last = formatTick(buckets[buckets.length - 1]);
  const mid = formatTick(buckets[Math.floor(buckets.length / 2)]);
  return `<text class="overview-chart-tick" x="${plot.left}" y="${plot.height - 8}">${escapeHtml(first)}</text><text class="overview-chart-tick" x="${plot.left + plot.plotW / 2}" y="${plot.height - 8}" text-anchor="middle">${escapeHtml(mid)}</text><text class="overview-chart-tick" x="${plot.left + plot.plotW}" y="${plot.height - 8}" text-anchor="end">${escapeHtml(last)}</text>`;
}

function chartPlot(width = 640, height = 220) {
  const left = 8;
  const right = 8;
  const top = 10;
  const bottom = 28;
  return { width, height, left, right, top, bottom, plotW: width - left - right, plotH: height - top - bottom };
}

export function stackedBarSvg(buckets, keys, { metric = "costUsd", label = "额度分布" } = {}) {
  const plot = chartPlot();
  if (!buckets.length || !keys.length) return "";
  const max = Math.max(0, ...buckets.map((bucket) => keys.reduce((sum, key) => sum + metricFromModel(bucket.models?.[key], metric), 0)));
  if (max <= 0) return `<div class="overview-chart-empty">这个窗口没有可堆叠的${escapeHtml(label)}</div>`;
  const gap = plot.plotW / buckets.length;
  const barW = Math.max(2, Math.min(18, gap * 0.62));
  const bars = buckets.map((bucket, index) => {
    const x = plot.left + index * gap + (gap - barW) / 2;
    let y = plot.top + plot.plotH;
    const slices = keys.map((key, seriesIndex) => {
      const value = metricFromModel(bucket.models?.[key], metric);
      const h = (value / max) * plot.plotH;
      y -= h;
      if (h <= 0) return "";
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" fill="${seriesColor(seriesIndex)}" rx="1.5"></rect>`;
    }).join("");
    return `<g>${slices}</g>`;
  }).join("");
  plot.labels = axisLabels(buckets, plot);
  return svgFrame(plot.width, plot.height, plot, `<line class="overview-chart-axis" x1="${plot.left}" y1="${plot.top + plot.plotH}" x2="${plot.left + plot.plotW}" y2="${plot.top + plot.plotH}"></line>${bars}`, label);
}

export function stackedAreaSvg(buckets, keys, { metric = "requests", label = "调用趋势" } = {}) {
  const plot = chartPlot();
  if (!buckets.length || !keys.length) return "";
  const totals = buckets.map((bucket) => keys.reduce((sum, key) => sum + metricFromModel(bucket.models?.[key], metric), 0));
  const max = Math.max(0, ...totals);
  if (max <= 0) return `<div class="overview-chart-empty">这个窗口没有可绘制的${escapeHtml(label)}</div>`;
  const xAt = (index) => plot.left + (buckets.length === 1 ? plot.plotW / 2 : (index / (buckets.length - 1)) * plot.plotW);
  const yAt = (value) => plot.top + plot.plotH - (value / max) * plot.plotH;
  const bands = keys.map((key, seriesIndex) => {
    const top = buckets.map((bucket, index) => {
      const below = keys.slice(0, seriesIndex).reduce((sum, item) => sum + metricFromModel(bucket.models?.[item], metric), 0);
      return { x: xAt(index), y: yAt(below + metricFromModel(bucket.models?.[key], metric)) };
    });
    const bottom = buckets.map((bucket, index) => {
      const below = keys.slice(0, seriesIndex).reduce((sum, item) => sum + metricFromModel(bucket.models?.[item], metric), 0);
      return { x: xAt(index), y: yAt(below) };
    }).reverse();
    const d = [...top, ...bottom].map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ") + " Z";
    return `<path d="${d}" fill="${seriesColor(seriesIndex)}" fill-opacity="0.42"></path>`;
  }).join("");
  const line = buckets.map((bucket, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)},${yAt(totals[index]).toFixed(2)}`).join(" ");
  plot.labels = axisLabels(buckets, plot);
  return svgFrame(plot.width, plot.height, plot, `<line class="overview-chart-axis" x1="${plot.left}" y1="${plot.top + plot.plotH}" x2="${plot.left + plot.plotW}" y2="${plot.top + plot.plotH}"></line>${bands}<path d="${line}" class="overview-chart-line" fill="none"></path>`, label);
}

export function lineSvg(buckets, keys, { metric = "costUsd", label = "额度折线" } = {}) {
  const plot = chartPlot();
  if (!buckets.length || !keys.length) return "";
  const max = Math.max(0, ...keys.flatMap((key) => buckets.map((bucket) => metricFromModel(bucket.models?.[key], metric))));
  if (max <= 0) return `<div class="overview-chart-empty">这个窗口没有可绘制的${escapeHtml(label)}</div>`;
  const xAt = (index) => plot.left + (buckets.length === 1 ? plot.plotW / 2 : (index / (buckets.length - 1)) * plot.plotW);
  const yAt = (value) => plot.top + plot.plotH - (value / max) * plot.plotH;
  const lines = keys.map((key, seriesIndex) => {
    const d = buckets.map((bucket, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)},${yAt(metricFromModel(bucket.models?.[key], metric)).toFixed(2)}`).join(" ");
    return `<path d="${d}" fill="none" stroke="${seriesColor(seriesIndex)}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"></path>`;
  }).join("");
  plot.labels = axisLabels(buckets, plot);
  return svgFrame(plot.width, plot.height, plot, `<line class="overview-chart-axis" x1="${plot.left}" y1="${plot.top + plot.plotH}" x2="${plot.left + plot.plotW}" y2="${plot.top + plot.plotH}"></line>${lines}`, label);
}

function legendMarkup(keys) {
  if (!keys.length) return "";
  return `<ul class="overview-chart-legend">${keys.map((key, index) => `<li><i data-series="${index}"></i><span>${escapeHtml(key)}</span></li>`).join("")}</ul>`;
}

function cardMarkup(item) {
  return `<article class="overview-kpi"><span class="overview-kpi-icon">${icon(item.icon)}</span><span class="overview-kpi-label">${escapeHtml(item.label)}</span><strong class="overview-kpi-value">${escapeHtml(item.value)}</strong><span class="overview-kpi-detail">${escapeHtml(item.detail)}</span></article>`;
}

function trendPlot(width = 720, height = 260) {
  const left = 46;
  const right = 48;
  const top = 12;
  const bottom = 28;
  return { width, height, left, right, top, bottom, plotW: width - left - right, plotH: height - top - bottom };
}

function axisValueLabels(values, plot, { x, anchor = "end" } = {}) {
  return values.map((item) => `<text class="overview-chart-tick" x="${x}" y="${item.y + 3}" text-anchor="${anchor}">${escapeHtml(item.label)}</text>`).join("");
}

export function compositeTrendSvg(buckets, { label = "使用趋势", split = true } = {}) {
  const plot = trendPlot();
  if (!buckets.length) return "";
  const inputs = buckets.map((bucket) => Number(bucket.inputTokens) || 0);
  const outputs = buckets.map((bucket) => Number(bucket.outputTokens) || 0);
  const tokens = buckets.map((bucket, index) => Number(bucket.tokens) || (inputs[index] + outputs[index]));
  const costs = buckets.map((bucket) => Number(bucket.costUsd) || 0);
  const hasSplit = Boolean(split) && (inputs.some((value) => value > 0) || outputs.some((value) => value > 0));
  const tokenMax = Math.max(1, ...(hasSplit ? [...inputs, ...outputs] : tokens));
  const costMax = Math.max(0.01, ...costs);
  const xAt = (index) => plot.left + (buckets.length === 1 ? plot.plotW / 2 : (index / (buckets.length - 1)) * plot.plotW);
  const yToken = (value) => plot.top + plot.plotH - (value / tokenMax) * plot.plotH;
  const yCost = (value) => plot.top + plot.plotH - (value / costMax) * plot.plotH;
  const base = plot.top + plot.plotH;
  const volume = hasSplit ? inputs : tokens;
  const area = [
    `M${xAt(0).toFixed(2)},${base.toFixed(2)}`,
    ...volume.map((value, index) => `L${xAt(index).toFixed(2)},${yToken(value).toFixed(2)}`),
    `L${xAt(volume.length - 1).toFixed(2)},${base.toFixed(2)} Z`,
  ].join(" ");
  const outputLine = hasSplit
    ? `<path d="${outputs.map((value, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)},${yToken(value).toFixed(2)}`).join(" ")}" class="overview-trend-output" fill="none"></path>`
    : "";
  const costLine = `<path d="${costs.map((value, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)},${yCost(value).toFixed(2)}`).join(" ")}" class="overview-trend-cost" fill="none"></path>`;
  const leftTicks = [0, 0.5, 1].map((ratio) => ({ y: yToken(tokenMax * ratio), label: formatTokens(tokenMax * ratio) }));
  const rightTicks = [0, 0.5, 1].map((ratio) => ({ y: yCost(costMax * ratio), label: formatMoney(costMax * ratio) }));
  plot.labels = `${axisLabels(buckets, plot)}${axisValueLabels(leftTicks, plot, { x: plot.left - 6, anchor: "end" })}${axisValueLabels(rightTicks, plot, { x: plot.left + plot.plotW + 6, anchor: "start" })}`;
  return svgFrame(plot.width, plot.height, plot, `<line class="overview-chart-axis" x1="${plot.left}" y1="${plot.top + plot.plotH}" x2="${plot.left + plot.plotW}" y2="${plot.top + plot.plotH}"></line><path d="${area}" class="overview-trend-input"></path>${outputLine}${costLine}`, label);
}

function heroMarkup(hero) {
  return `<div class="overview-hero-tokens"><span class="overview-hero-label">真实消耗 Tokens</span><div class="overview-hero-value-row"><strong>${escapeHtml(hero.tokensExact)}</strong>${hero.tokensShort ? `<em>${escapeHtml(hero.tokensShort)}</em>` : ""}</div></div><div class="overview-hero-side"><div><span>总请求数</span><strong>${escapeHtml(hero.requests)}</strong></div><div><span>总成本</span><strong class="is-cost">${escapeHtml(hero.cost)}</strong></div></div>`;
}

function splitMarkup(items) {
  return items.map((item) => `<div class="overview-split-cell${item.tone ? ` is-${item.tone}` : ""}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong>${item.note ? `<em>${escapeHtml(item.note)}</em>` : ""}</div>`).join("");
}

function trendLegendMarkup(hasIoSplit) {
  const items = hasIoSplit
    ? [{ cls: "is-input", label: "输入" }, { cls: "is-output", label: "输出" }, { cls: "is-cost", label: "成本" }]
    : [{ cls: "is-input", label: "Tokens" }, { cls: "is-cost", label: "成本" }];
  return items.map((item) => `<li><i class="${item.cls}"></i><span>${item.label}</span></li>`).join("");
}

function statusMarkup(row) {
  const ok = Boolean(row.success);
  const label = row.httpStatus == null || row.httpStatus === "" ? (ok ? "成功" : "失败") : String(row.httpStatus);
  return `<span class="overview-status ${ok ? "is-ok" : "is-error"}">${escapeHtml(label)}</span>`;
}

function ledgerEmpty(viewModel) {
  return `<div class="overview-usage-empty"><strong>${escapeHtml(viewModel.emptyTitle)}</strong><span>${escapeHtml(viewModel.emptyDetail)}</span></div>`;
}

function tableMarkup(headers, rows) {
  if (!rows.length) return "";
  return `<div class="overview-ledger-wrap"><table class="overview-ledger-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function logRows(logs) {
  return logs.map((row) => {
    const split = row.inputTokens > 0 || row.outputTokens > 0;
    const tokens = row.tokens || (row.inputTokens + row.outputTokens);
    const perMillion = costPerMillion(row.costUsd, tokens);
    return `<tr><td>${escapeHtml(formatStamp(row.startedAt))}</td><td>${escapeHtml(row.providerName || row.providerId || "—")}</td><td>${escapeHtml(row.model || "—")}</td><td>${escapeHtml(split ? formatExact(row.inputTokens) : (tokens ? formatExact(tokens) : "--"))}</td><td>${escapeHtml(split ? formatExact(row.outputTokens) : "--")}</td><td>${escapeHtml(formatMoney(row.costUsd))}</td><td>${escapeHtml(perMillion == null ? "--" : formatMoney(perMillion))}</td><td>${statusMarkup(row)}</td><td>${escapeHtml(row.app || "—")}</td></tr>`;
  });
}

function statRows(items) {
  return items.map((item) => {
    const tokens = Number(item.tokens) || ((Number(item.inputTokens) || 0) + (Number(item.outputTokens) || 0));
    return `<tr><td>${escapeHtml(item.key || "—")}</td><td>${escapeHtml(formatExact(item.totalRequests ?? ((item.requests || 0) + (item.failed || 0))))}</td><td>${escapeHtml(formatExact(item.failed))}</td><td>${escapeHtml(formatPercent(item.successRate))}</td><td>${escapeHtml(formatExact(tokens))}</td><td>${escapeHtml(formatMoney(item.costUsd))}</td></tr>`;
  });
}

function ledgerMarkup(viewModel, { ledger = "logs", model = "" } = {}) {
  if (viewModel.empty) return ledgerEmpty(viewModel);
  if (ledger === "providers") {
    return viewModel.providers.length
      ? tableMarkup(["Provider", "请求", "失败", "成功率", "Tokens", "成本"], statRows(viewModel.providers))
      : `<div class="overview-usage-empty"><strong>还没有 Provider 统计</strong><span>有真实请求后才会按供应商汇总。</span></div>`;
  }
  if (ledger === "models") {
    return viewModel.models.length
      ? tableMarkup(["模型", "请求", "失败", "成功率", "Tokens", "成本"], statRows(viewModel.models))
      : `<div class="overview-usage-empty"><strong>还没有模型统计</strong><span>有真实请求后才会按模型汇总。</span></div>`;
  }
  const logs = model ? viewModel.logs.filter((row) => row.model === model) : viewModel.logs;
  return logs.length
    ? tableMarkup(["时间", "供应商", "计费模型", "输入", "输出", "总成本", "消耗/百万", "状态", "来源"], logRows(logs))
    : `<div class="overview-usage-empty"><strong>这个筛选下没有请求记录</strong><span>换一个模型，或等代理产生新的真实请求。</span></div>`;
}

export function paintUsageDeck(root, viewModel, { chartKind = "bar", chartMetric = "requests", ledger = "logs", model = "" } = {}) {
  if (!root) return viewModel;
  const note = root.querySelector("[data-usage-source-note]");
  const hero = root.querySelector("[data-usage-hero]");
  const split = root.querySelector("[data-usage-split]");
  const kpis = root.querySelector("[data-usage-kpis]");
  const perf = root.querySelector("[data-usage-perf]");
  const models = root.querySelector("[data-usage-models]");
  const costTotal = root.querySelector("[data-usage-cost-total]");
  const costChart = root.querySelector("[data-usage-cost-chart]");
  const trendTotal = root.querySelector("[data-usage-trend-total]");
  const trendLegend = root.querySelector("[data-usage-trend-legend]");
  const trendChart = root.querySelector("[data-usage-trend-chart]");
  const ledgerBody = root.querySelector("[data-usage-ledger-body]");
  const modelSelect = root.querySelector("[data-usage-model]");
  if (note) note.textContent = viewModel.sourceNote;
  if (hero) hero.innerHTML = heroMarkup(viewModel.hero);
  if (split) split.innerHTML = splitMarkup(viewModel.split);
  if (kpis) kpis.innerHTML = viewModel.kpis.map(cardMarkup).join("");
  if (perf) {
    perf.innerHTML = viewModel.perf.map((item) => `<span class="overview-perf-pill is-${item.tone}"><em>${escapeHtml(item.label)}</em><strong>${escapeHtml(item.value)}</strong></span>`).join("");
  }
  if (models) {
    models.innerHTML = viewModel.empty || !viewModel.models.length
      ? ""
      : viewModel.models.slice(0, 16).map((item) => {
        const rate = item.successRate;
        const tone = rate == null ? "neutral" : rate >= 0.98 ? "ok" : rate >= 0.9 ? "warning" : "error";
        return `<span class="overview-model-pill is-${tone}"><span>${escapeHtml(item.key)}</span><strong>${formatPercent(rate)}</strong></span>`;
      }).join("");
  }
  const collapsed = collapseSeries(viewModel.buckets, { metric: chartKind === "bar" ? "costUsd" : chartMetric });
  if (costTotal) costTotal.textContent = viewModel.empty ? "" : formatMoney(viewModel.totals.costUsd);
  if (trendTotal) trendTotal.textContent = viewModel.empty ? "" : `${formatExact(viewModel.totals.requests)} 次 · ${formatExact(viewModel.totals.tokens)} tokens`;
  if (trendLegend) trendLegend.innerHTML = viewModel.empty ? "" : trendLegendMarkup(viewModel.hasIoSplit);
  const emptyMarkup = `<div class="overview-usage-empty"><strong>${escapeHtml(viewModel.emptyTitle)}</strong><span>${escapeHtml(viewModel.emptyDetail)}</span></div>`;
  const costGraphic = viewModel.empty
    ? emptyMarkup
    : (chartKind === "line" ? lineSvg(collapsed.buckets, collapsed.keys, { metric: "costUsd", label: "额度折线" }) : stackedBarSvg(collapsed.buckets, collapsed.keys, { metric: "costUsd", label: "额度分布" }));
  const trendGraphic = viewModel.empty
    ? emptyMarkup
    : compositeTrendSvg(viewModel.buckets, { split: viewModel.hasIoSplit, label: "使用趋势" });
  if (costChart) costChart.innerHTML = `${costGraphic}${viewModel.empty ? "" : legendMarkup(collapsed.keys)}`;
  if (trendChart) trendChart.innerHTML = trendGraphic;
  if (ledgerBody) ledgerBody.innerHTML = ledgerMarkup(viewModel, { ledger, model });
  if (modelSelect) {
    const options = ["", ...(viewModel.modelOptions || [])];
    const current = options.includes(model) ? model : "";
    modelSelect.innerHTML = options.map((key) => `<option value="${escapeHtml(key)}">${key ? escapeHtml(key) : "全部模型"}</option>`).join("");
    modelSelect.value = current;
    modelSelect.disabled = ledger !== "logs";
  }
  root.querySelectorAll("[data-usage-ledger]").forEach((button) => {
    const active = button.dataset.usageLedger === ledger;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  root.querySelectorAll("[data-series]").forEach((swatch) => {
    swatch.style.background = seriesColor(Number(swatch.dataset.series));
  });
  return viewModel;
}
