import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const INBOX_LIFECYCLE_SCHEMA = "514cc.inbox-lifecycle/v1";
export const INBOX_LIFECYCLE_STATES = Object.freeze([
  "ask",
  "delivered",
  "answered",
  "acknowledged",
  "failed",
  "expired",
]);

const TRANSITIONS = Object.freeze({
  ask: ["delivered", "answered", "failed", "expired"],
  delivered: ["answered", "failed", "expired"],
  answered: ["acknowledged", "failed"],
  acknowledged: [],
  failed: [],
  expired: [],
});

const HIGH_IMPACT_ACTIONS = new Set([
  "approve",
  "build",
  "execute",
  "switch-provider",
  "grant",
  "reload",
  "danger-full-access",
]);

export function inboxRecordKey(runId, messageId) {
  const normalizedRunId = String(runId ?? "").trim();
  const normalizedMessageId = String(messageId ?? "").trim();
  return normalizedRunId && normalizedMessageId ? `${normalizedRunId}\u0000${normalizedMessageId}` : null;
}

export function inferInboxLifecycle(message, answeredAskIds = new Set()) {
  const kind = String(message?.kind ?? "").toLowerCase();
  if (kind === "answer") return "answered";
  if (kind !== "ask") return null;
  const key = inboxRecordKey(message.runId, message.id);
  if (key && answeredAskIds.has(key)) return "answered";
  return "delivered";
}

function fail(message, code, extras = {}) {
  throw Object.assign(new Error(message), { code, ...extras });
}

export function applyInboxTransition(record, { action, actor = "lo", text = "", idempotencyKey = null, expectedRevision = null } = {}) {
  if (HIGH_IMPACT_ACTIONS.has(String(action || "").toLowerCase())) {
    fail("inbox cannot execute high-impact actions; use the existing approval endpoint", "INBOX_HIGH_IMPACT_FORBIDDEN");
  }
  const now = new Date().toISOString();
  const current = record || {
    schema: INBOX_LIFECYCLE_SCHEMA,
    state: "delivered",
    revision: 0,
    lastIdempotencyKey: null,
    ackMeansProviderSuccess: false,
  };
  if (idempotencyKey && current.lastIdempotencyKey === idempotencyKey) {
    return { ...current, replayed: true };
  }
  if (expectedRevision != null && current.revision !== expectedRevision) {
    fail("inbox record revision conflict", "INBOX_CAS_CONFLICT", {
      expectedRevision,
      actualRevision: current.revision,
    });
  }
  const target = action === "answer"
    ? "answered"
    : action === "acknowledge"
      ? "acknowledged"
      : action === "fail"
        ? "failed"
        : action === "expire"
          ? "expired"
          : action === "deliver"
            ? "delivered"
            : null;
  if (!target) fail(`unknown inbox action: ${action}`, "VALIDATION_FAILED");
  const allowed = TRANSITIONS[current.state] || [];
  if (current.state === target) {
    return { ...current, replayed: true };
  }
  if (!allowed.includes(target)) {
    fail(`inbox cannot move ${current.state} → ${target}`, "INBOX_TRANSITION_REJECTED", {
      from: current.state,
      to: target,
    });
  }
  if (target === "answered" && !String(text || "").trim()) {
    fail("inbox answer text is required", "VALIDATION_FAILED");
  }
  if (target === "acknowledged" && current.state !== "answered") {
    fail("ACK is only valid after an answer", "INBOX_TRANSITION_REJECTED");
  }
  return {
    ...current,
    schema: INBOX_LIFECYCLE_SCHEMA,
    state: target,
    revision: current.revision + 1,
    lastIdempotencyKey: idempotencyKey || current.lastIdempotencyKey,
    actor,
    text: String(text || current.text || "").slice(0, 320),
    updatedAt: now,
    ackMeansProviderSuccess: false,
    replayed: false,
  };
}

export function createInboxLifecycleStore({ dataRoot }) {
  const path = join(dataRoot, "inbox-lifecycle.json");
  let cache = null;
  let chain = Promise.resolve();

  async function load() {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      cache = {
        schema: INBOX_LIFECYCLE_SCHEMA,
        revision: Number.isSafeInteger(parsed.revision) ? parsed.revision : 0,
        items: parsed.items && typeof parsed.items === "object" ? parsed.items : {},
      };
    } catch {
      cache = { schema: INBOX_LIFECYCLE_SCHEMA, revision: 0, items: {} };
    }
    return cache;
  }

  async function persist(next) {
    await mkdir(dataRoot, { recursive: true });
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(next)}\n`, "utf8");
    await rename(tmp, path);
    cache = next;
  }

  function serialize(operation) {
    const next = chain.then(operation, operation);
    chain = next.then(() => undefined, () => undefined);
    return next;
  }

  return {
    async snapshot() {
      const state = await load();
      return { ...state.items };
    },
    async apply({
      runId,
      messageId,
      conversationId = null,
      action,
      actor = "lo",
      text = "",
      idempotencyKey = null,
      expectedRevision = null,
    }) {
      const key = inboxRecordKey(runId, messageId);
      if (!key) fail("runId and messageId are required", "VALIDATION_FAILED");
      return serialize(async () => {
        const state = await load();
        const previous = state.items[key] || {
          schema: INBOX_LIFECYCLE_SCHEMA,
          runId,
          messageId,
          conversationId,
          state: "delivered",
          revision: 0,
          lastIdempotencyKey: null,
          ackMeansProviderSuccess: false,
        };
        const nextRecord = applyInboxTransition(previous, {
          action,
          actor,
          text,
          idempotencyKey,
          expectedRevision,
        });
        const next = {
          schema: INBOX_LIFECYCLE_SCHEMA,
          revision: state.revision + (nextRecord.replayed ? 0 : 1),
          items: { ...state.items, [key]: { ...nextRecord, runId, messageId, conversationId } },
        };
        if (!nextRecord.replayed) await persist(next);
        else cache = next;
        return next.items[key];
      });
    },
  };
}
