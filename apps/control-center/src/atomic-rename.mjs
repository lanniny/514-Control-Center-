import { renameSync } from "node:fs";
import { rename } from "node:fs/promises";

const TRANSIENT_RENAME_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"]);
const DEFAULT_RETRY_DELAYS_MS = Object.freeze([10, 25, 50, 100]);
const sleepCell = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

function sleepSync(delayMs) {
  Atomics.wait(sleepCell, 0, 0, delayMs);
}

function sleepAsync(delayMs) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, delayMs));
}

function deadlineAfterCommit(deadline) {
  return Object.assign(new Error("rename completed after publication deadline"), {
    code: "RENAME_DEADLINE_EXCEEDED",
    deadline,
    renameCommitted: true,
  });
}

export async function renameWithRetry(source, target, {
  renameFile = rename,
  sleep = sleepAsync,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  deadline = Infinity,
  now = Date.now,
  beforeAttempt = null,
} = {}) {
  let lastError = null;
  for (let attempt = 0; ; attempt += 1) {
    const absoluteDeadline = Number(typeof deadline === "function" ? deadline() : deadline);
    if (Number.isFinite(absoluteDeadline) && now() >= absoluteDeadline) {
      if (lastError) {
        lastError.retryDeadlineExceeded = true;
        throw lastError;
      }
      throw Object.assign(new Error("rename deadline expired before publication"), {
        code: "RENAME_DEADLINE_EXCEEDED",
        deadline: absoluteDeadline,
      });
    }
    try {
      await beforeAttempt?.({ attempt, source, target });
      await renameFile(source, target);
      const completedDeadline = Number(typeof deadline === "function" ? deadline() : deadline);
      if (Number.isFinite(completedDeadline) && now() >= completedDeadline) {
        throw deadlineAfterCommit(completedDeadline);
      }
      return;
    } catch (error) {
      if (error?.renameCommitted) throw error;
      lastError = error;
      if (!TRANSIENT_RENAME_ERRORS.has(error?.code) || attempt >= retryDelaysMs.length) throw error;
      const remainingMs = Number.isFinite(absoluteDeadline) ? absoluteDeadline - now() : Infinity;
      const delayMs = Math.min(retryDelaysMs[attempt], Math.max(0, remainingMs - 1));
      if (delayMs <= 0) {
        error.retryDeadlineExceeded = true;
        throw error;
      }
      await sleep(delayMs);
    }
  }
}

export function renameSyncWithRetry(source, target, {
  renameFile = renameSync,
  sleep = sleepSync,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  deadline = Infinity,
  now = Date.now,
  beforeAttempt = null,
} = {}) {
  let lastError = null;
  for (let attempt = 0; ; attempt += 1) {
    const absoluteDeadline = Number(typeof deadline === "function" ? deadline() : deadline);
    if (Number.isFinite(absoluteDeadline) && now() >= absoluteDeadline) {
      if (lastError) {
        lastError.retryDeadlineExceeded = true;
        throw lastError;
      }
      throw Object.assign(new Error("rename deadline expired before publication"), {
        code: "RENAME_DEADLINE_EXCEEDED",
        deadline: absoluteDeadline,
      });
    }
    try {
      beforeAttempt?.({ attempt, source, target });
      renameFile(source, target);
      const completedDeadline = Number(typeof deadline === "function" ? deadline() : deadline);
      if (Number.isFinite(completedDeadline) && now() >= completedDeadline) {
        throw deadlineAfterCommit(completedDeadline);
      }
      return;
    } catch (error) {
      if (error?.renameCommitted) throw error;
      lastError = error;
      if (!TRANSIENT_RENAME_ERRORS.has(error?.code) || attempt >= retryDelaysMs.length) throw error;
      const remainingMs = Number.isFinite(absoluteDeadline) ? absoluteDeadline - now() : Infinity;
      const delayMs = Math.min(retryDelaysMs[attempt], Math.max(0, remainingMs - 1));
      if (delayMs <= 0) {
        error.retryDeadlineExceeded = true;
        throw error;
      }
      sleep(delayMs);
    }
  }
}
