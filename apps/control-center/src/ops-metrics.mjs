export const OPS_METRICS_SCHEMA = "514cc.ops-metrics/v1";
export const STALE_RUN_MS = 120_000;

const TERMINAL = new Set([
  "complete", "completed", "succeeded", "failed", "blocked", "cancelled", "canceled",
]);
const IN_FLIGHT = new Set([
  "queued", "running", "waiting_agent", "waiting_approval", "recovery_required", "interrupted",
]);
const PROMPT_TRANSPORT_CODES = new Set([
  "PROMPT_TRANSPORT_UNSAFE",
  "PROMPT_TRANSPORT_CORRUPT",
]);

function asText(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
}

function asTimeMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

function roundMs(value) {
  return value == null ? null : Math.round(value);
}

function statusOf(run) {
  return asText(run?.status).toLowerCase() || "unknown";
}

function isExecuteRun(run) {
  return run?.execute !== false;
}

function firstUsefulMs(run) {
  if (!isExecuteRun(run)) return { kind: "skip" };
  const start = asTimeMs(run?.createdAt);
  const turns = Array.isArray(run?.turns) ? run.turns : [];
  const useful = turns.filter((turn) => (
    turn?.role === "assistant"
    && turn?.outcome === "completed"
    && asText(turn?.text)
  ));
  if (!useful.length) {
    return TERMINAL.has(statusOf(run)) ? { kind: "unknown" } : { kind: "skip" };
  }
  if (start == null) return { kind: "unknown" };
  const validTimes = useful
    .map((turn) => asTimeMs(turn.createdAt))
    .filter((value) => value != null && value >= start);
  if (!validTimes.length) return { kind: "unknown" };
  const end = Math.min(...validTimes);
  return { kind: "sample", ms: end - start };
}

function collectCodes(value, into) {
  if (!value) return;
  if (typeof value === "string") {
    const code = asText(value);
    if (PROMPT_TRANSPORT_CODES.has(code)) into.push(code);
    return;
  }
  if (typeof value === "object") {
    collectCodes(value.code, into);
    collectCodes(value.recoveryNote, into);
    collectCodes(value.message, into);
  }
}

function promptTransportFailures(run) {
  const codes = [];
  collectCodes(run?.error, codes);
  collectCodes(run?.recoveryNote, codes);
  for (const attempt of run?.turnAttempts || []) {
    collectCodes(attempt?.error, codes);
    collectCodes(attempt?.code, codes);
    collectCodes(attempt?.failureCode, codes);
  }
  if (asText(run?.recoveryNote).includes("PROMPT_TRANSPORT_")) {
    for (const code of PROMPT_TRANSPORT_CODES) {
      if (asText(run.recoveryNote).includes(code)) codes.push(code);
    }
  }
  return [...new Set(codes)];
}

function evidenceComplete(run) {
  const turns = Array.isArray(run?.turns) ? run.turns : [];
  if (turns.some((turn) => turn?.role === "assistant" && turn?.outcome === "completed" && asText(turn?.text))) {
    return true;
  }
  return Boolean(run?.result && run.result.type !== "route-preview");
}

function receiptTurns(run) {
  return (Array.isArray(run?.turns) ? run.turns : []).filter((turn) => turn?.role === "assistant");
}

export function synthesizeOpsMetrics({
  runs = [],
  approvals = [],
  healthMeta = null,
  now = Date.now(),
} = {}) {
  const capturedAt = new Date(typeof now === "number" ? now : Date.parse(now) || Date.now()).toISOString();
  const nowMs = asTimeMs(now) ?? Date.now();
  const list = Array.isArray(runs) ? runs : [];

  const firstUsefulSamples = [];
  let firstUsefulUnknown = 0;
  const outcomes = {
    total: list.length,
    inFlight: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    recoveryRequired: 0,
    terminal: 0,
  };
  let staleRunCount = 0;
  let routeFallbackRuns = 0;
  let adapterFallbackEvents = 0;
  let evidenceTerminal = 0;
  let evidenceCompleteCount = 0;
  let receiptCount = 0;
  let costKnown = 0;
  let costUnknown = 0;
  let knownTotalUsd = 0;
  const transportCodes = { PROMPT_TRANSPORT_UNSAFE: 0, PROMPT_TRANSPORT_CORRUPT: 0 };
  let transportFailures = 0;

  for (const run of list) {
    const status = statusOf(run);
    if (IN_FLIGHT.has(status)) outcomes.inFlight += 1;
    if (status === "succeeded" || status === "complete" || status === "completed") outcomes.succeeded += 1;
    if (status === "failed") outcomes.failed += 1;
    if (status === "cancelled" || status === "canceled") outcomes.cancelled += 1;
    if (status === "recovery_required") outcomes.recoveryRequired += 1;
    if (TERMINAL.has(status)) outcomes.terminal += 1;

    const useful = firstUsefulMs(run);
    if (useful.kind === "sample") firstUsefulSamples.push(useful.ms);
    else if (useful.kind === "unknown") firstUsefulUnknown += 1;

    if (IN_FLIGHT.has(status)) {
      const updated = asTimeMs(run?.updatedAt) ?? asTimeMs(run?.createdAt);
      if (updated == null || nowMs - updated >= STALE_RUN_MS) staleRunCount += 1;
    }

    if (run?.route?.fallbackUsed === true) routeFallbackRuns += 1;
    const adapterCount = Number(run?.adapterFallbackCount);
    if (Number.isFinite(adapterCount) && adapterCount > 0) adapterFallbackEvents += adapterCount;

    if (isExecuteRun(run) && TERMINAL.has(status)) {
      evidenceTerminal += 1;
      if (evidenceComplete(run)) evidenceCompleteCount += 1;
    }

    for (const turn of receiptTurns(run)) {
      receiptCount += 1;
      if (Number.isFinite(turn?.costUsd)) {
        costKnown += 1;
        knownTotalUsd += Number(turn.costUsd);
      } else {
        costUnknown += 1;
      }
    }

    const codes = promptTransportFailures(run);
    if (codes.length) {
      transportFailures += 1;
      for (const code of codes) {
        if (Object.hasOwn(transportCodes, code)) transportCodes[code] += 1;
      }
    }
  }

  const pendingApprovals = (Array.isArray(approvals) ? approvals : [])
    .filter((item) => asText(item?.status).toLowerCase() === "pending" || !item?.status);
  const approvalWaits = pendingApprovals
    .map((item) => {
      const created = asTimeMs(item?.createdAt);
      return created == null ? null : Math.max(0, nowMs - created);
    })
    .filter((value) => value != null);

  const healthAvailable = Boolean(healthMeta?.available);
  const healthAgeMs = Number.isFinite(healthMeta?.ageMs) ? healthMeta.ageMs : null;
  const healthTtlMs = Number.isFinite(healthMeta?.ttlMs) ? healthMeta.ttlMs : null;
  const healthCacheStale = healthMeta?.stale === true || !healthAvailable;
  const healthItems = Array.isArray(healthMeta?.items) ? healthMeta.items : [];
  const profileCount = Number.isFinite(healthMeta?.profileCount)
    ? healthMeta.profileCount
    : healthItems.length;
  const staleHealthItemCount = healthCacheStale
    ? Math.max(profileCount, healthItems.length)
    : 0;

  const outcomeSample = outcomes.succeeded + outcomes.failed + outcomes.cancelled + outcomes.recoveryRequired;

  return {
    schema: OPS_METRICS_SCHEMA,
    capturedAt,
    window: "in-memory-live",
    firstUsefulResponse: {
      samples: firstUsefulSamples.length,
      unknown: firstUsefulUnknown,
      p50Ms: roundMs(percentile(firstUsefulSamples, 0.5)),
      meanMs: roundMs(mean(firstUsefulSamples)),
    },
    outcomes: {
      ...outcomes,
      successRate: rate(outcomes.succeeded, outcomeSample),
      failureRate: rate(outcomes.failed, outcomeSample),
      recoveryRate: rate(outcomes.recoveryRequired, outcomeSample),
    },
    approvalWait: {
      pending: pendingApprovals.length,
      samples: approvalWaits.length,
      p50Ms: roundMs(percentile(approvalWaits, 0.5)),
      maxMs: approvalWaits.length ? Math.max(...approvalWaits) : null,
      observable: "pending-only",
    },
    stale: {
      healthCacheStale,
      healthAvailable,
      healthAgeMs,
      healthTtlMs,
      staleHealthItemCount,
      staleRunCount,
      total: staleHealthItemCount + staleRunCount,
    },
    routeFallback: {
      runs: routeFallbackRuns,
      adapterEvents: adapterFallbackEvents,
      events: routeFallbackRuns + adapterFallbackEvents,
    },
    evidence: {
      terminal: evidenceTerminal,
      complete: evidenceCompleteCount,
      rate: rate(evidenceCompleteCount, evidenceTerminal),
    },
    costUsd: {
      receiptTurns: receiptCount,
      known: costKnown,
      unknown: costUnknown,
      availability: rate(costKnown, receiptCount),
      knownTotalUsd: costKnown ? knownTotalUsd : null,
      knownMeanUsd: costKnown ? knownTotalUsd / costKnown : null,
    },
    promptTransport: {
      failures: transportFailures,
      codes: transportCodes,
    },
  };
}

export function collectOpsMetrics({
  orchestrator,
  approvalBroker,
  healthService,
  now = Date.now(),
} = {}) {
  return synthesizeOpsMetrics({
    runs: typeof orchestrator?.list === "function" ? orchestrator.list() : [],
    approvals: typeof approvalBroker?.list === "function" ? approvalBroker.list() : [],
    healthMeta: typeof healthService?.peekMeta === "function"
      ? healthService.peekMeta()
      : { available: false, stale: true, items: [], ageMs: null, ttlMs: null, profileCount: 0 },
    now,
  });
}
