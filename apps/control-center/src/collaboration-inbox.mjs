import { scrub } from "./redaction.mjs";

export const INBOX_SCHEMA = "514cc.collaboration-inbox/v1";
export const INBOX_MESSAGE_KINDS = Object.freeze(["ask", "answer", "decide", "steer", "system"]);
const MESSAGE_KIND_SET = new Set(INBOX_MESSAGE_KINDS);

export const INBOX_LIMITS = Object.freeze({
  maxRuns: 32,
  maxMessages: 128,
  maxText: 320,
  maxIssues: 16,
  maxConcurrentReads: 4,
});

const ACTIVE_RUN_STATES = new Set([
  "queued", "planning", "running", "waiting_agent", "executing", "integrating", "verifying", "active",
]);
const ATTENTION_RUN_STATES = new Set([
  "waiting_approval", "approval_required", "recovery_required", "failed", "ambiguous", "blocked",
]);

function shortText(value, limit = INBOX_LIMITS.maxText) {
  const clean = scrub(String(value ?? ""))
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function positiveLimit(value, fallback, maximum) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw Object.assign(new Error(`inbox limit must be a positive integer no greater than ${maximum}`), {
      code: "VALIDATION_FAILED",
    });
  }
  return parsed;
}

function projectRun(run, teamId) {
  const id = String(run?.id ?? "").trim();
  if (!id) return null;
  const status = shortText(run?.status, 48) || "unknown";
  return {
    id,
    teamId,
    status,
    title: shortText(run?.title || run?.prompt || id, 180) || id,
    updatedAt: timestamp(run?.updatedAt ?? run?.createdAt),
    attention: ATTENTION_RUN_STATES.has(status) || Boolean(run?.recoveryRequired),
    active: ACTIVE_RUN_STATES.has(status),
  };
}

function projectDiagnostics(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rawStatus = String(source.status ?? "ok").toLowerCase();
  const status = ["ok", "missing", "degraded"].includes(rawStatus) ? rawStatus : "degraded";
  const issues = Array.isArray(source.issues)
    ? source.issues.slice(0, INBOX_LIMITS.maxIssues).map((issue) => ({
        code: shortText(issue?.code, 64) || "INBOX_SOURCE_DEGRADED",
        message: shortText(issue?.message, 180) || "消息源不可用",
        systemCode: issue?.systemCode ? shortText(issue.systemCode, 48) : null,
      }))
    : [];
  return {
    status,
    issues,
    truncated: {
      bytes: source.truncated?.bytes === true,
      messages: source.truncated?.messages === true,
    },
    parsedMessages: Number.isSafeInteger(source.parsedMessages) ? source.parsedMessages : 0,
  };
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason ?? Object.assign(new Error("inbox read aborted"), { name: "AbortError" });
}

async function mapBounded(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runWorker = async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, runWorker));
  return results;
}

function runBelongsToTeam(run, teamId) {
  return (run?.teamId || "team-514cc") === teamId;
}

function askReferenceKey(runId, askId) {
  const normalizedRunId = String(runId ?? "").trim();
  const normalizedAskId = String(askId ?? "").trim();
  return normalizedRunId && normalizedAskId ? `${normalizedRunId}\u0000${normalizedAskId}` : null;
}

export function scopedInboxRuns(teamId, runs, { maxRuns = INBOX_LIMITS.maxRuns } = {}) {
  const limit = positiveLimit(maxRuns, INBOX_LIMITS.maxRuns, INBOX_LIMITS.maxRuns);
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => runBelongsToTeam(run, teamId))
    .map((run) => projectRun(run, teamId))
    .filter(Boolean)
    .sort((left, right) => (Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0)) || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export async function collectTeamInbox({
  teamId,
  team,
  runs = [],
  readTail,
  maxRuns = INBOX_LIMITS.maxRuns,
  maxMessages = INBOX_LIMITS.maxMessages,
  maxConcurrentReads = INBOX_LIMITS.maxConcurrentReads,
  signal,
} = {}) {
  const normalizedTeamId = String(teamId ?? "").trim();
  if (!normalizedTeamId || !team || String(team.id ?? "") !== normalizedTeamId) {
    throw Object.assign(new Error("team is required for inbox projection"), { code: "VALIDATION_FAILED" });
  }
  if (typeof readTail !== "function") {
    throw Object.assign(new Error("readTail is required for inbox projection"), { code: "VALIDATION_FAILED" });
  }
  const messageLimit = positiveLimit(maxMessages, INBOX_LIMITS.maxMessages, INBOX_LIMITS.maxMessages);
  const readConcurrency = positiveLimit(maxConcurrentReads, INBOX_LIMITS.maxConcurrentReads, INBOX_LIMITS.maxConcurrentReads);
  const runRows = scopedInboxRuns(normalizedTeamId, runs, { maxRuns });
  const sources = await mapBounded(runRows, readConcurrency, async (run) => {
    abortIfNeeded(signal);
    try {
      const result = await readTail(run.id, { signal });
      abortIfNeeded(signal);
      const diagnostics = projectDiagnostics(result?.diagnostics);
      const messages = (Array.isArray(result?.messages) ? result.messages : [])
        .filter((message) => MESSAGE_KIND_SET.has(message?.kind))
        .map((message) => {
          const to = shortText(message?.to, 64);
          const kind = message.kind;
          return {
            id: shortText(message?.id, 160),
            runId: run.id,
            from: shortText(message?.from, 64),
            to,
            kind,
            text: shortText(message?.text),
            ts: timestamp(message?.ts),
            needsOperator: kind === "ask" && ["lo", "team", "all"].includes(to.toLowerCase()),
            answerToAskId: kind === "answer" ? shortText(message?.refs?.answerToAskId, 160) || null : null,
          };
        })
        .filter((message) => message.id && message.ts && message.text);
      return { run, status: diagnostics.status === "ok" ? "ok" : "partial", diagnostics, messages };
    } catch (error) {
      abortIfNeeded(signal);
      return {
        run,
        status: "partial",
        diagnostics: {
          status: "degraded",
          issues: [{ code: shortText(error?.code, 64) || "INBOX_SOURCE_READ_FAILED", message: shortText(error?.message, 180) || "消息源读取失败", systemCode: null }],
          truncated: { bytes: false, messages: false },
          parsedMessages: 0,
        },
        messages: [],
      };
    }
  });

  const allMessages = sources
    .flatMap((source) => source.messages.map((message) => ({ ...message, run: source.run })))
    .sort((left, right) => (Date.parse(right.ts) - Date.parse(left.ts)) || left.id.localeCompare(right.id));
  const answeredAskIds = new Set(allMessages
    .map((message) => askReferenceKey(message.runId, message.answerToAskId))
    .filter(Boolean));
  const messages = allMessages.slice(0, messageLimit).map(({ run, ...message }) => ({
    ...message,
    runStatus: run.status,
    runTitle: run.title,
    runAttention: run.attention,
  }));
  const pendingAsks = messages.filter((message) => {
    const askKey = askReferenceKey(message.runId, message.id);
    return message.needsOperator && (!askKey || !answeredAskIds.has(askKey));
  });
  const recentAnswers = messages.filter((message) => message.kind === "answer").slice(0, 16);
  const blockedRuns = runRows.filter((run) => run.attention).slice(0, 16);
  const teamRunCount = (Array.isArray(runs) ? runs : []).filter((run) => runBelongsToTeam(run, normalizedTeamId)).length;
  const runsTruncated = sources.length < teamRunCount;
  const partial = runsTruncated || sources.some((source) => source.status !== "ok");
  const diagnostics = {
    status: partial ? "partial" : runRows.length ? "ok" : "empty",
    runsTotal: teamRunCount,
    runsRead: sources.length,
    runsTruncated,
    messageCount: messages.length,
    pendingAskCount: pendingAsks.length,
    issues: sources.flatMap((source) => source.diagnostics.issues).slice(0, INBOX_LIMITS.maxIssues),
  };
  return {
    schema: INBOX_SCHEMA,
    team: { id: normalizedTeamId, name: shortText(team.name, 120) || normalizedTeamId },
    generatedAt: new Date().toISOString(),
    messages,
    pendingAsks,
    recentAnswers,
    blockedRuns,
    sources: sources.map((source) => ({ runId: source.run.id, status: source.status, diagnostics: source.diagnostics })),
    diagnostics,
  };
}
