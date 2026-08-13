import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SCHEMA = "514cc.remote-recoveries/v1";
const KINDS = new Set(["provider", "graph", "sync"]);
const PHASES = new Set(["provisional", "recovery_required"]);
const TRANSACTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ledgerError(code, message, httpStatus = 500) {
  return Object.assign(new Error(message), { code, httpStatus });
}

function recoveryKey({ hostId, kind, transactionId }) {
  return `${hostId}:${kind}:${transactionId}`;
}

function cleanId(value, field) {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(text)) {
    throw ledgerError("REMOTE_RECOVERY_LEDGER_INVALID", `${field} is invalid`, 400);
  }
  return text;
}

function cleanRecord(input) {
  const kind = String(input?.kind ?? "");
  const transactionId = String(input?.transactionId ?? "");
  if (!KINDS.has(kind) || !TRANSACTION_ID.test(transactionId)) {
    throw ledgerError("REMOTE_RECOVERY_LEDGER_INVALID", "recovery kind or transactionId is invalid", 400);
  }
  const hostId = cleanId(input.hostId, "hostId");
  const projectId = input.projectId == null ? null : cleanId(input.projectId, "projectId");
  const hostScoped = kind === "sync";
  const phase = PHASES.has(input.phase) ? input.phase : "recovery_required";
  const recordedAt = typeof input.recordedAt === "string" && !Number.isNaN(Date.parse(input.recordedAt))
    ? input.recordedAt
    : new Date().toISOString();
  const count = (value) => Math.max(0, Math.min(10_000, Number.isSafeInteger(Number(value)) ? Number(value) : 0));
  const causeCode = /^[A-Za-z0-9._-]{1,96}$/.test(String(input.causeCode ?? "")) ? String(input.causeCode) : null;
  return Object.freeze({
    key: recoveryKey({ hostId, kind, transactionId }),
    hostId,
    projectId: hostScoped ? null : projectId,
    targetKey: hostScoped || !projectId ? `host:${hostId}` : `project:${projectId}`,
    scope: hostScoped || !projectId ? "host" : "project",
    kind,
    transactionId,
    phase,
    appliedCount: count(input.appliedCount),
    uncertainCount: count(input.uncertainCount),
    causeCode,
    message: `远端 ${kind} 提交状态需要核对`,
    recordedAt,
  });
}

function parseLedger(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw Object.assign(ledgerError("REMOTE_RECOVERY_LEDGER_INVALID", "remote recovery ledger contains invalid JSON"), { cause: error });
  }
  if (parsed?.schema !== SCHEMA || !Array.isArray(parsed.records)) {
    throw ledgerError("REMOTE_RECOVERY_LEDGER_INVALID", "remote recovery ledger schema is invalid");
  }
  return parsed.records.map(cleanRecord);
}

function recoveryEvidence(value, fallbackKind = null) {
  const input = value?.payload ?? value ?? {};
  const envelope = input?.error && typeof input.error === "object" ? input.error : {};
  const nested = envelope?.recovery && typeof envelope.recovery === "object"
    ? envelope.recovery
    : input?.recovery && typeof input.recovery === "object"
      ? input.recovery
      : {};
  const pick = (field) => nested[field] ?? envelope[field] ?? input[field] ?? value?.[field];
  if (!(pick("recoveryRequired") === true || pick("status") === "recovery_required" || Object.keys(nested).length)) return null;
  const kind = pick("kind") ?? fallbackKind;
  const transactionId = pick("transactionId");
  if (!KINDS.has(kind) || typeof transactionId !== "string" || !TRANSACTION_ID.test(transactionId)) return null;
  const listCount = (field) => Array.isArray(pick(field)) ? pick(field).length : Number(pick(`${field}Count`)) || 0;
  return {
    kind,
    transactionId,
    appliedCount: listCount("applied"),
    uncertainCount: listCount("uncertain"),
    causeCode: pick("causeCode") ?? pick("code") ?? null,
  };
}

export function createRemoteRecoveryLedger({ dataRoot, fileSystem = {} }) {
  if (!dataRoot) throw ledgerError("REMOTE_RECOVERY_LEDGER_INVALID", "dataRoot is required");
  const path = join(dataRoot, "remote-recoveries.json");
  const fs = { mkdir, readFile, rename, unlink, writeFile, ...fileSystem };
  let records = new Map();
  let loaded = false;
  let loadPromise = null;
  let writeChain = Promise.resolve();
  let degradedError = null;
  const activeTransactions = new Set();
  const reconcilingTransactions = new Set();

  async function init() {
    if (degradedError) throw degradedError;
    if (loaded) return api;
    if (!loadPromise) {
      loadPromise = (async () => {
        let next = [];
        try {
          next = parseLedger(await fs.readFile(path, "utf8"));
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        records = new Map(next.map((record) => [record.key, record]));
        loaded = true;
        return api;
      })().catch((error) => {
        degradedError = error?.code === "REMOTE_RECOVERY_LEDGER_INVALID"
          ? error
          : Object.assign(ledgerError(
            "REMOTE_RECOVERY_LEDGER_INVALID",
            "remote recovery ledger could not be loaded",
          ), { cause: error });
        throw degradedError;
      });
    }
    return loadPromise;
  }

  async function persist(next) {
    await fs.mkdir(dataRoot, { recursive: true });
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify({ schema: SCHEMA, records: [...next.values()] }, null, 2), { encoding: "utf8", mode: 0o600 });
      await fs.rename(temp, path);
    } catch (error) {
      try {
        await fs.unlink(temp);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") error.cleanupError = cleanupError;
      }
      degradedError = Object.assign(ledgerError("REMOTE_RECOVERY_LEDGER_WRITE_FAILED", "remote recovery ledger could not be persisted"), { cause: error });
      throw degradedError;
    }
  }

  function enqueue(operation) {
    const result = writeChain.then(async () => {
      await init();
      return operation();
    });
    writeChain = result.catch(() => {});
    return result;
  }

  async function list({ hostId = null, projectId = null } = {}) {
    await init();
    if (degradedError) throw degradedError;
    return [...records.values()].filter((record) => (
      (!hostId || record.hostId === hostId) && (!projectId || record.projectId === projectId)
    ));
  }

  async function record(input) {
    const nextRecord = cleanRecord({ ...input, phase: input?.phase ?? "recovery_required" });
    return enqueue(async () => {
      const prior = records.get(nextRecord.key);
      if (prior && (prior.hostId !== nextRecord.hostId || prior.projectId !== nextRecord.projectId
        || prior.kind !== nextRecord.kind || prior.transactionId !== nextRecord.transactionId)) {
        throw ledgerError("REMOTE_RECOVERY_IDENTITY_MISMATCH", "recovery record identity does not match its registered transaction", 409);
      }
      const merged = cleanRecord({ ...prior, ...nextRecord, phase: "recovery_required", recordedAt: prior?.recordedAt ?? nextRecord.recordedAt });
      const next = new Map(records);
      next.set(merged.key, merged);
      await persist(next);
      records = next;
      return merged;
    });
  }

  async function begin({ hostId, projectId = null, kind }) {
    const transactionId = randomUUID();
    const provisional = cleanRecord({ hostId, projectId, kind, transactionId, phase: "provisional" });
    return enqueue(async () => {
      const pending = [...records.values()].filter((record) => record.hostId === provisional.hostId);
      if (pending.length) {
        throw Object.assign(ledgerError("REMOTE_RECOVERY_BLOCKED", `host ${provisional.hostId} has ${pending.length} unresolved remote transaction(s)`, 409), {
          recoveryRequired: true,
          pending: pending.map(({ kind: pendingKind, transactionId: pendingId, targetKey }) => ({ kind: pendingKind, transactionId: pendingId, targetKey })),
        });
      }
      const next = new Map(records);
      next.set(provisional.key, provisional);
      await persist(next);
      records = next;
      activeTransactions.add(provisional.key);
      return provisional;
    });
  }

  async function get({ hostId, projectId = undefined, kind, transactionId }) {
    await init();
    if (degradedError) throw degradedError;
    const record = records.get(recoveryKey({ hostId: cleanId(hostId, "hostId"), kind, transactionId })) ?? null;
    if (!record) return null;
    const expectedProjectId = kind === "sync" || projectId == null ? null : cleanId(projectId, "projectId");
    if (projectId !== undefined && record.projectId !== expectedProjectId) return null;
    return record;
  }

  async function has(target) {
    return Boolean(await get(target));
  }

  async function resolve({ hostId, kind, transactionId }) {
    const key = recoveryKey({ hostId: cleanId(hostId, "hostId"), kind, transactionId });
    return enqueue(async () => {
      if (!records.has(key)) return false;
      const next = new Map(records);
      next.delete(key);
      await persist(next);
      records = next;
      return true;
    });
  }

  function isActive({ hostId, kind, transactionId }) {
    return activeTransactions.has(recoveryKey({ hostId: cleanId(hostId, "hostId"), kind, transactionId }));
  }

  function finish({ hostId, kind, transactionId }) {
    activeTransactions.delete(recoveryKey({ hostId: cleanId(hostId, "hostId"), kind, transactionId }));
  }

  function claimReconcile(target) {
    const key = recoveryKey({ hostId: cleanId(target.hostId, "hostId"), kind: target.kind, transactionId: target.transactionId });
    if (reconcilingTransactions.has(key)) return false;
    reconcilingTransactions.add(key);
    return true;
  }

  function finishReconcile(target) {
    reconcilingTransactions.delete(recoveryKey({ hostId: cleanId(target.hostId, "hostId"), kind: target.kind, transactionId: target.transactionId }));
  }

  async function assertHostWritable(hostId) {
    const pending = await list({ hostId });
    if (!pending.length) return;
    throw Object.assign(ledgerError("REMOTE_RECOVERY_BLOCKED", `host ${hostId} has ${pending.length} unresolved remote transaction(s)`, 409), {
      recoveryRequired: true,
      pending: pending.map(({ kind, transactionId, targetKey }) => ({ kind, transactionId, targetKey })),
    });
  }

  async function assertProjectRemovable(projectId) {
    const pending = await list({ projectId });
    if (!pending.length) return;
    throw Object.assign(ledgerError("REMOTE_RECOVERY_BLOCKED", `project ${projectId} has ${pending.length} unresolved remote transaction(s)`, 409), {
      recoveryRequired: true,
      pending: pending.map(({ kind, transactionId, targetKey }) => ({ kind, transactionId, targetKey })),
    });
  }

  const api = { init, list, begin, get, has, record, resolve, isActive, finish, claimReconcile, finishReconcile, assertHostWritable, assertProjectRemovable, path };
  return api;
}

export function ensureRemoteRecoveryLedger(state) {
  if (!state.remoteRecoveryLedger) {
    state.remoteRecoveryLedger = createRemoteRecoveryLedger({ dataRoot: state.dataRoot });
    const initPromise = state.remoteRecoveryLedger.init();
    state.remoteRecoveryLedger._initPromise = initPromise;
    void initPromise.catch((error) => {
      state.remoteRecoveryLedger._initError = error;
    });
  }
  return state.remoteRecoveryLedger;
}

export async function trackRemoteRecovery(ledger, value, { hostId, projectId = null, fallbackKind = null } = {}) {
  const evidence = recoveryEvidence(value, fallbackKind);
  if (!evidence) return value;
  const target = evidence.kind === "sync" ? { hostId, projectId: null } : { hostId, projectId };
  try {
    await ledger.record({ ...target, ...evidence });
    try { value.recoveryRegistryPersisted = true; } catch {}
  } catch (error) {
    try {
      value.recoveryRegistryPersisted = false;
      value.recoveryRegistryError = error.code ?? "REMOTE_RECOVERY_LEDGER_WRITE_FAILED";
    } catch {}
  }
  return value;
}

function registeredEvidence(value, { kind, transactionId }) {
  const input = value?.payload ?? value ?? {};
  const envelope = input?.error && typeof input.error === "object" ? input.error : {};
  const nested = envelope?.recovery && typeof envelope.recovery === "object"
    ? envelope.recovery
    : input?.recovery && typeof input.recovery === "object"
      ? input.recovery
      : {};
  const receivedKind = nested.kind ?? envelope.kind ?? input.kind ?? value?.kind ?? null;
  const receivedTransactionId = nested.transactionId ?? envelope.transactionId ?? input.transactionId ?? value?.transactionId ?? null;
  const evidence = recoveryEvidence(value, kind);
  if ((receivedKind && receivedKind !== kind)
    || (receivedTransactionId && receivedTransactionId !== transactionId)
    || (evidence && (evidence.kind !== kind || evidence.transactionId !== transactionId))) {
    throw Object.assign(ledgerError(
      "REMOTE_RECOVERY_IDENTITY_MISMATCH",
      "remote recovery evidence does not match the registered transaction",
      502,
    ), {
      recoveryRequired: true,
      retryable: false,
      kind,
      transactionId,
      recovery: { kind, transactionId },
      receivedRecovery: { kind: receivedKind ?? evidence?.kind ?? null, transactionId: receivedTransactionId ?? evidence?.transactionId ?? null },
    });
  }
  return evidence;
}

function recoveryPendingError(error, message, { kind, transactionId, originalError = null }) {
  return Object.assign(ledgerError("REMOTE_RECOVERY_LEDGER_PENDING", message, 503), {
    cause: error,
    originalError,
    recoveryRequired: true,
    retryable: false,
    kind,
    transactionId,
    recovery: { kind, transactionId },
    applied: [],
    uncertain: [],
    recoveryRegistryPersisted: true,
  });
}

export async function runTrackedRemoteWrite(ledger, target, fallbackKind, operation) {
  try {
    return await trackRemoteRecovery(ledger, await operation(), { ...target, fallbackKind });
  } catch (error) {
    await trackRemoteRecovery(ledger, error, { ...target, fallbackKind });
    throw error;
  }
}

export async function runRegisteredRemoteWrite(ledger, target, kind, operation) {
  const provisional = await ledger.begin({ ...target, kind });
  const cleanupFailure = (error, message, originalError = null) => recoveryPendingError(error, message, {
    kind,
    transactionId: provisional.transactionId,
    originalError,
  });
  const bindEvidence = async (value) => {
    try {
      return registeredEvidence(value, { kind, transactionId: provisional.transactionId });
    } catch (error) {
      await ledger.record({
        ...target,
        kind,
        transactionId: provisional.transactionId,
        phase: "recovery_required",
        causeCode: error.code,
      });
      error.recoveryRegistryPersisted = true;
      throw error;
    }
  };
  try {
    let result;
    try {
      result = await operation(provisional.transactionId);
    } catch (error) {
      const evidence = await bindEvidence(error);
      if (evidence) {
        await trackRemoteRecovery(ledger, error, { ...target, fallbackKind: kind });
      } else {
        try {
          await ledger.resolve({ hostId: target.hostId, kind, transactionId: provisional.transactionId });
        } catch (cleanupError) {
          throw cleanupFailure(cleanupError, "the remote operation ended, but its local recovery registration could not be released", error);
        }
      }
      throw error;
    }
    const evidence = await bindEvidence(result);
    if (evidence) {
      await trackRemoteRecovery(ledger, result, { ...target, fallbackKind: kind });
      return result;
    }
    try {
      await ledger.resolve({ hostId: target.hostId, kind, transactionId: provisional.transactionId });
    } catch (error) {
      throw cleanupFailure(error, "the remote operation completed, but its local recovery registration could not be released");
    }
    return result;
  } finally {
    ledger.finish({ hostId: target.hostId, kind, transactionId: provisional.transactionId });
  }
}

export async function reconcileRegisteredRemoteRecovery(ledger, target, recovery, operation) {
  const identity = { hostId: target.hostId, projectId: target.projectId ?? null, kind: recovery.kind, transactionId: recovery.transactionId };
  const registered = await ledger.get(identity);
  if (!registered) {
    const byHost = await ledger.get({ hostId: target.hostId, kind: recovery.kind, transactionId: recovery.transactionId });
    throw ledgerError(
      byHost ? "REMOTE_RECOVERY_SCOPE_MISMATCH" : "REMOTE_RECOVERY_NOT_FOUND",
      byHost ? "the remote recovery transaction belongs to a different target scope" : "the remote recovery transaction is not registered locally",
      byHost ? 409 : 404,
    );
  }
  if (ledger.isActive(identity)) {
    throw Object.assign(ledgerError(
      "REMOTE_RECOVERY_PENDING",
      "the remote transaction is still running; recovery remains blocked",
      409,
    ), {
      recoveryRequired: true,
      retryable: false,
      kind: recovery.kind,
      transactionId: recovery.transactionId,
      recovery: { kind: recovery.kind, transactionId: recovery.transactionId },
    });
  }
  if (!ledger.claimReconcile(identity)) {
    throw Object.assign(ledgerError(
      "REMOTE_RECOVERY_RECONCILE_IN_PROGRESS",
      "the remote recovery transaction is already being reconciled",
      409,
    ), {
      recoveryRequired: true,
      retryable: false,
      kind: recovery.kind,
      transactionId: recovery.transactionId,
      recovery: { kind: recovery.kind, transactionId: recovery.transactionId },
    });
  }
  try {
    const result = await operation();
    const evidence = registeredEvidence(result, { kind: recovery.kind, transactionId: recovery.transactionId });
    if (result?.recoveryRequired === false) {
      try {
        await ledger.resolve({ hostId: target.hostId, kind: recovery.kind, transactionId: recovery.transactionId });
      } catch (cleanupError) {
        throw recoveryPendingError(cleanupError, "the absent remote transaction could not be released from the local recovery ledger", {
          kind: recovery.kind,
          transactionId: recovery.transactionId,
          originalError: error,
        });
      }
    } else if (evidence) {
      await trackRemoteRecovery(ledger, result, { ...target, fallbackKind: recovery.kind });
    }
    return result;
  } catch (error) {
    if (error?.code === "REMOTE_RECOVERY_NOT_FOUND") {
      const current = await ledger.get(identity);
      if (!current) throw error;
      if (current.phase !== "provisional") {
        throw Object.assign(error, {
          recoveryRequired: true,
          retryable: false,
          kind: recovery.kind,
          transactionId: recovery.transactionId,
          recovery: { kind: recovery.kind, transactionId: recovery.transactionId },
        });
      }
      await ledger.resolve({ hostId: target.hostId, kind: recovery.kind, transactionId: recovery.transactionId });
      return {
        kind: recovery.kind,
        transactionId: recovery.transactionId,
        recoveryRequired: false,
        released: [],
        message: "No remote lock exists for the pre-registered transaction; the local recovery block was released.",
      };
    }
    const current = await ledger.get(identity);
    if (current) {
      const evidence = registeredEvidence(error, { kind: recovery.kind, transactionId: recovery.transactionId });
      if (evidence) await trackRemoteRecovery(ledger, error, { ...target, fallbackKind: recovery.kind });
    }
    throw error;
  } finally {
    ledger.finishReconcile(identity);
  }
}
