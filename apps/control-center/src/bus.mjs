// v3.6 社会模拟编排 · bus.jsonl 消息总线（proposals/v36-social-simulation-design.md P1）：
// 每 run 一条追加式消息流（dataRoot/bus/<runId>.jsonl），turn 的上下文从这里编织——
// agent 感知彼此不再靠主脑人肉转述。写入即 scrub（与会话扫描同纪律），读取按收件人裁剪。
import { randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, open, readFile, readdir, rename, rm, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
// 脱敏单一信源（烛 v3.6 致命4）：双层 scrub 收敛到 redaction.mjs，不再维护正则副本
import { scrub, sanitizeForPersistence } from "./redaction.mjs";

export { scrub };

// runId 只接受服务端生成的 UUID（烛 v3.6 致命3：`../events` 之类的 runId 直接拼路径
// 可穿越读 dataRoot 外任意 .jsonl——file() 是唯一路径拼装点，白名单在此 fail-closed）
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertRunId(runId) {
  if (!RUN_ID.test(String(runId ?? ""))) {
    throw Object.assign(new Error("invalid run id"), { code: "VALIDATION_FAILED" });
  }
  return String(runId);
}

const DIRECTIVE_LINE = /^\s*\[\[(?:msg:([A-Za-z0-9._-]{1,64})|(memo))\]\]\s*(.*)$/;
const MESSAGE_TEXT_CAP = 20_000; // 单条消息文本上限（防一条失控输出撑爆 bus 文件）
const MESSAGE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const MESSAGE_PARTICIPANT = /^[A-Za-z0-9._-]{1,64}$/;
const MESSAGE_KINDS = new Set(["task", "say", "ask", "answer", "decide", "steer", "system", "memo"]);
const BUS_LOCK_DEFAULTS = Object.freeze({
  timeoutMs: 5_000,
  staleMs: 1_000,
  retryMinMs: 8,
  retryMaxMs: 32,
});
const BUS_LOCK_OWNER_FILE = /^owner-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i;

export const BUS_TAIL_LIMITS = Object.freeze({
  defaultMaxBytes: 256 * 1024,
  defaultMaxMessages: 256,
  maxBytes: 1024 * 1024,
  maxMessages: 2048,
  maxIssues: 16,
});

function positiveBound(value, fallback, maximum, name) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw Object.assign(new Error(`${name} must be a positive safe integer no greater than ${maximum}`), {
      code: "VALIDATION_FAILED",
    });
  }
  return resolved;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason ?? Object.assign(new Error("bus read aborted"), { name: "AbortError", code: "ABORT_ERR" });
}

function safeSystemCode(error) {
  const code = String(error?.code ?? "UNKNOWN").toUpperCase();
  return /^[A-Z0-9_]{1,48}$/.test(code) ? code : "UNKNOWN";
}

function diagnosticIssue(code, message, extra = {}) {
  return { code, message, ...extra };
}

function baseDiagnostics({ status = "ok", fileSizeBytes = null, bytesRead = 0, parsedMessages = 0 } = {}) {
  return {
    status,
    issues: [],
    fileSizeBytes,
    bytesRead,
    parsedMessages,
    malformedLines: 0,
    truncated: { bytes: false, messages: false },
  };
}

function validBusRecord(record, expectedRunId) {
  return Boolean(
    record
    && typeof record === "object"
    && !Array.isArray(record)
    && MESSAGE_ID.test(String(record.id ?? ""))
    && typeof record.ts === "string"
    && Number.isFinite(Date.parse(record.ts))
    && record.runId === expectedRunId
    && MESSAGE_PARTICIPANT.test(String(record.from ?? ""))
    && MESSAGE_PARTICIPANT.test(String(record.to ?? ""))
    && MESSAGE_KINDS.has(record.kind)
    && typeof record.text === "string"
    && record.text.length <= MESSAGE_TEXT_CAP
  );
}

function projectBusRecord(record) {
  const projected = {
    id: record.id,
    ts: record.ts,
    runId: record.runId,
    from: record.from,
    to: record.to,
    kind: record.kind,
    text: scrub(record.text).slice(0, MESSAGE_TEXT_CAP),
  };
  if (Object.hasOwn(record, "refs")) {
    projected.refs = record.refs == null ? null : sanitizeForPersistence(record.refs);
  }
  return projected;
}

function sameBusMessage(left, right) {
  return left.runId === right.runId
    && left.from === right.from
    && left.to === right.to
    && left.kind === right.kind
    && left.text === right.text
    && JSON.stringify(left.refs ?? null) === JSON.stringify(right.refs ?? null);
}

function positiveLockBound(value, fallback, name) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw Object.assign(new Error(`${name} must be a positive safe integer`), { code: "VALIDATION_FAILED" });
  }
  return resolved;
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is owned by another principal. Unknown probe
    // failures must remain fail-closed; only ESRCH proves that the owner is gone.
    return error?.code !== "ESRCH";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockOwnerFile(nonce) {
  return `owner-${nonce}.json`;
}

function ownerWriteIsStale(owner, stats, staleMs) {
  const acquiredAtMs = Date.parse(owner?.acquiredAt ?? "");
  const freshestOwnerWrite = Math.max(
    Number.isFinite(acquiredAtMs) ? acquiredAtMs : 0,
    ...stats.map((entry) => Number.isFinite(entry?.mtimeMs) ? entry.mtimeMs : 0),
  );
  return Date.now() - freshestOwnerWrite >= staleMs;
}

async function observeBusLock(path, staleMs) {
  let directoryStats;
  try {
    directoryStats = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return { state: "missing" };
    return { state: "held" };
  }

  if (directoryStats.isFile()) {
    let owner;
    try {
      owner = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return { state: "missing" };
      return { state: "held" };
    }
    const nonce = String(owner?.nonce ?? "");
    if (!RUN_ID.test(nonce) || !ownerWriteIsStale(owner, [directoryStats], staleMs)) return { state: "held" };
    if (processIsAlive(Number(owner?.pid))) return { state: "held" };
    return { state: "stale", reclaim: { kind: "legacy-file", nonce } };
  }
  // Current locks are atomically published non-empty directories. Symlinks and
  // other unexpected node types stay fail-closed.
  if (!directoryStats.isDirectory()) return { state: "held" };

  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { state: "missing" };
    return { state: "held" };
  }

  if (entries.length === 0) {
    return ownerWriteIsStale(null, [directoryStats], staleMs)
      ? { state: "stale", reclaim: { kind: "empty-directory" } }
      : { state: "held" };
  }
  if (entries.length !== 1 || !entries[0].isFile()) return { state: "held" };

  const match = BUS_LOCK_OWNER_FILE.exec(entries[0].name);
  if (!match) return { state: "held" };
  const markerName = entries[0].name;
  const markerPath = join(path, markerName);
  let markerStats;
  let owner = null;
  try {
    markerStats = await lstat(markerPath);
    if (!markerStats.isFile()) return { state: "held" };
    const parsed = JSON.parse(await readFile(markerPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) owner = parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return { state: "changed" };
    if (!(error instanceof SyntaxError)) return { state: "held" };
    // Published markers were fsynced before the directory became visible. An old
    // malformed marker can therefore be reclaimed by its nonce-scoped filename.
  }

  if (!ownerWriteIsStale(owner, [directoryStats, markerStats], staleMs)) return { state: "held" };

  const pid = Number(owner?.pid);
  if (processIsAlive(pid)) return { state: "held" };
  const nonce = match[1];
  if (owner && owner.nonce !== nonce) return { state: "held" };
  return { state: "stale", reclaim: { kind: "owner-marker", markerName } };
}

function sameReclaimTarget(left, right) {
  return left?.kind === right?.kind
    && left?.markerName === right?.markerName
    && left?.nonce === right?.nonce;
}

async function reclaimBusLock(path, observed, staleMs) {
  const confirmed = await observeBusLock(path, staleMs);
  if (confirmed.state !== "stale" || !sameReclaimTarget(observed.reclaim, confirmed.reclaim)) return false;

  if (confirmed.reclaim.kind === "legacy-file") {
    try {
      // Migration-only epoch CAS: current writers publish directories, so a late
      // legacy reaper's unlink cannot remove a replacement current lock.
      await unlink(path);
      return true;
    } catch (error) {
      if (["ENOENT", "EISDIR", "EPERM", "EACCES"].includes(error?.code)) return false;
      throw error;
    }
  }

  if (confirmed.reclaim.kind === "empty-directory") {
    try {
      await rmdir(path);
      return true;
    } catch (error) {
      if (["ENOENT", "ENOTEMPTY", "EEXIST", "EPERM", "EACCES"].includes(error?.code)) return false;
      throw error;
    }
  }

  try {
    // The marker name is the ownership CAS token. Only one reaper can unlink this
    // nonce, and a replacement lock is atomically published with a different one.
    await unlink(join(path, confirmed.reclaim.markerName));
  } catch (error) {
    if (["ENOENT", "EISDIR", "EPERM"].includes(error?.code)) return false;
    throw error;
  }
  try {
    await rmdir(path);
  } catch (error) {
    // Another entry means ownership changed or the directory was corrupted. Both
    // cases stay fail-closed; rmdir cannot remove a newly published non-empty lock.
    if (!["ENOENT", "ENOTEMPTY", "EEXIST", "EPERM", "EACCES"].includes(error?.code)) throw error;
  }
  return true;
}

function parseJsonLines(raw, {
  maxMessages = null,
  leadingPartial = false,
  expectedRunId,
  fileSizeBytes = Buffer.byteLength(raw, "utf8"),
  bytesRead = Buffer.byteLength(raw, "utf8"),
} = {}) {
  let text = String(raw ?? "");
  let tailRecordUnobservable = false;
  if (leadingPartial) {
    const boundary = text.indexOf("\n");
    text = boundary < 0 ? "" : text.slice(boundary + 1);
    tailRecordUnobservable = !text.trim();
  }

  const lines = text.split(/\r?\n/);
  const unterminated = text.length > 0 && !/[\r\n]$/.test(text);
  const issues = tailRecordUnobservable
    ? [diagnosticIssue(
        "BUS_TAIL_NO_COMPLETE_RECORD",
        "bus tail byte budget contains no complete JSONL record",
      )]
    : [];
  const keepIssue = (issue) => {
    if (issues.length < BUS_TAIL_LIMITS.maxIssues) issues.push(issue);
  };
  const bounded = Number.isSafeInteger(maxMessages);
  const retained = bounded ? new Array(maxMessages) : [];
  let parsedMessages = 0;
  let malformedLines = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (!validBusRecord(record, expectedRunId)) {
        malformedLines += 1;
        keepIssue(diagnosticIssue(
          "BUS_JSONL_INVALID_RECORD",
          "bus JSONL record does not match the current run message schema",
          { tailLine: index + 1 },
        ));
        continue;
      }
      const projected = projectBusRecord(record);
      if (bounded) retained[parsedMessages % maxMessages] = projected;
      else retained.push(projected);
      parsedMessages += 1;
      if (unterminated && index === lines.length - 1) {
        malformedLines += 1;
        keepIssue(diagnosticIssue(
          "BUS_JSONL_UNTERMINATED_LINE",
          "bus JSONL ends without a record delimiter",
          { tailLine: index + 1 },
        ));
      }
    } catch {
      malformedLines += 1;
      keepIssue(diagnosticIssue(
        unterminated && index === lines.length - 1 ? "BUS_JSONL_TRUNCATED_LINE" : "BUS_JSONL_MALFORMED_LINE",
        unterminated && index === lines.length - 1
          ? "bus JSONL ends with a truncated record"
          : "bus JSONL contains malformed JSON",
        { tailLine: index + 1 },
      ));
    }
  }

  let messages;
  if (!bounded || parsedMessages <= maxMessages) {
    messages = retained.slice(0, parsedMessages);
  } else {
    messages = [];
    const first = parsedMessages % maxMessages;
    for (let index = 0; index < maxMessages; index += 1) {
      messages.push(retained[(first + index) % maxMessages]);
    }
  }

  return {
    messages,
    diagnostics: {
      status: issues.length ? "degraded" : "ok",
      issues,
      fileSizeBytes,
      bytesRead,
      parsedMessages,
      malformedLines,
      truncated: {
        bytes: leadingPartial,
        messages: bounded && parsedMessages > maxMessages,
      },
    },
  };
}

function ioDiagnostic(error) {
  const systemCode = safeSystemCode(error);
  return {
    messages: [],
    diagnostics: {
      ...baseDiagnostics({ status: systemCode === "ENOENT" ? "missing" : "degraded" }),
      issues: systemCode === "ENOENT"
        ? []
        : [diagnosticIssue("BUS_READ_FAILED", "bus JSONL could not be read", { systemCode })],
    },
  };
}

function diagnosticError(diagnostics) {
  const corrupt = diagnostics.issues.some((item) => item.code.startsWith("BUS_JSONL_"));
  return Object.assign(new Error(corrupt ? "bus JSONL is corrupt" : "bus JSONL could not be read"), {
    code: corrupt ? "BUS_JSONL_CORRUPT" : "BUS_READ_FAILED",
    diagnostics,
  });
}

async function collectStream(stream, signal) {
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal);
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      bytes += buffer.length;
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    throw error;
  }
  throwIfAborted(signal);
  return Buffer.concat(chunks, bytes);
}

/** 解析 agent 输出里的路由指令行：[[msg:目标]] / [[memo]] 起新行、后续行并入该指令正文，直到下一条指令或文末。
   返回 { cleaned（指令以外的正文，发给 team）, directives: [{to, text}] }（to:"memo"=全员黑板）。 */
export function parseDirectives(text) {
  const directives = [];
  const kept = [];
  let current = null;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = DIRECTIVE_LINE.exec(line);
    if (match) {
      if (current) directives.push(current);
      current = { to: match[2] ? "memo" : match[1], text: match[3] };
    } else if (current) {
      current.text += `\n${line}`;
    } else {
      kept.push(line);
    }
  }
  if (current) directives.push(current);
  return {
    cleaned: kept.join("\n").trim(),
    directives: directives
      .map((directive) => ({ to: directive.to, text: directive.text.trim() }))
      .filter((directive) => directive.text),
  };
}

export class BusStore {
  constructor({
    dataRoot,
    openFile = open,
    readWholeFile = readFile,
    lockTimeoutMs = BUS_LOCK_DEFAULTS.timeoutMs,
    lockStaleMs = BUS_LOCK_DEFAULTS.staleMs,
    lockRetryMinMs = BUS_LOCK_DEFAULTS.retryMinMs,
    lockRetryMaxMs = BUS_LOCK_DEFAULTS.retryMaxMs,
  } = {}) {
    this.dir = join(dataRoot, "bus");
    this.chains = new Map(); // per-run 追加串行链（并发写不乱序）
    this.openFile = openFile;
    this.readWholeFile = readWholeFile;
    this.lockOptions = {
      timeoutMs: positiveLockBound(lockTimeoutMs, BUS_LOCK_DEFAULTS.timeoutMs, "lockTimeoutMs"),
      staleMs: positiveLockBound(lockStaleMs, BUS_LOCK_DEFAULTS.staleMs, "lockStaleMs"),
      retryMinMs: positiveLockBound(lockRetryMinMs, BUS_LOCK_DEFAULTS.retryMinMs, "lockRetryMinMs"),
      retryMaxMs: positiveLockBound(lockRetryMaxMs, BUS_LOCK_DEFAULTS.retryMaxMs, "lockRetryMaxMs"),
    };
    if (this.lockOptions.retryMinMs > this.lockOptions.retryMaxMs) {
      throw Object.assign(new Error("lockRetryMinMs must not exceed lockRetryMaxMs"), {
        code: "VALIDATION_FAILED",
      });
    }
  }

  file(runId) {
    return join(this.dir, `${assertRunId(runId)}.jsonl`);
  }

  lockFile(runId) {
    return `${this.file(runId)}.lock`;
  }

  async acquireRunLock(runId) {
    const path = this.lockFile(runId);
    const deadline = Date.now() + this.lockOptions.timeoutMs;

    while (true) {
      const nonce = randomUUID();
      const candidatePath = `${path}.candidate-${nonce}`;
      const markerName = lockOwnerFile(nonce);
      let candidateCreated = false;
      let publishAttempted = false;
      try {
        await mkdir(candidatePath, { mode: 0o700 });
        candidateCreated = true;
        const owner = {
          pid: process.pid,
          nonce,
          acquiredAt: new Date().toISOString(),
        };
        let handle;
        try {
          handle = await open(join(candidatePath, markerName), "wx", 0o600);
          await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
          await handle.sync();
        } finally {
          if (handle) await handle.close().catch(() => {});
        }
        publishAttempted = true;
        await rename(candidatePath, path);
        candidateCreated = false;

        let released = false;
        return async () => {
          if (released) return;
          released = true;
          try {
            await unlink(join(path, markerName));
          } catch (error) {
            if (error?.code === "ENOENT") return;
            throw error;
          }
          try {
            await rmdir(path);
          } catch (error) {
            if (!["ENOENT", "ENOTEMPTY", "EEXIST", "EPERM", "EACCES"].includes(error?.code)) throw error;
          }
        };
      } catch (error) {
        if (candidateCreated) await rm(candidatePath, { recursive: true, force: true }).catch(() => {});
        if (!publishAttempted) throw error;
        const observedAfterFailure = await observeBusLock(path, this.lockOptions.staleMs);
        if (observedAfterFailure.state === "missing") {
          if (["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(error?.code)) continue;
          throw error;
        }
      }

      const observed = await observeBusLock(path, this.lockOptions.staleMs);
      if (observed.state === "missing") continue;
      if (observed.state === "stale") {
        if (await reclaimBusLock(path, observed, this.lockOptions.staleMs)) continue;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw Object.assign(new Error("timed out waiting for the run bus lock"), {
          code: "BUS_LOCK_TIMEOUT",
          runId: assertRunId(runId),
          timeoutMs: this.lockOptions.timeoutMs,
        });
      }
      const jitter = this.lockOptions.retryMinMs
        + Math.floor(Math.random() * (this.lockOptions.retryMaxMs - this.lockOptions.retryMinMs + 1));
      await sleep(Math.min(jitter, remainingMs));
    }
  }

  /** 追加一条消息。from/to ∈ agentId | "lo" | "team"；kind ∈ task|say|ask|answer|decide|steer|system|memo。 */
  async append(runId, { id = null, from, to = "team", kind = "say", text, refs = null }) {
    const normalizedRunId = assertRunId(runId);
    const message = {
      id: id == null ? randomUUID() : String(id),
      ts: new Date().toISOString(),
      runId: normalizedRunId,
      from: String(from),
      to: String(to),
      kind,
      text: scrub(String(text ?? "")).slice(0, MESSAGE_TEXT_CAP),
      refs: refs == null ? null : sanitizeForPersistence(refs), // refs 同样入盘，不能是脱敏空窗（烛致命4）
    };
    if (!validBusRecord(message, normalizedRunId)) {
      throw Object.assign(new Error("bus message does not match the run message schema"), { code: "VALIDATION_FAILED" });
    }
    const previous = this.chains.get(normalizedRunId) || Promise.resolve();
    const chain = previous.then(async () => {
      await mkdir(this.dir, { recursive: true });
      const release = await this.acquireRunLock(normalizedRunId);
      try {
        if (id != null) {
          const existing = (await this.read(normalizedRunId)).find((item) => item.id === message.id);
          if (existing) {
            if (!sameBusMessage(existing, message)) {
              throw Object.assign(new Error(`bus message id ${message.id} already owns a different payload`), {
                code: "BUS_MESSAGE_CONFLICT",
                messageId: message.id,
              });
            }
            return existing;
          }
        }
        await appendFile(this.file(normalizedRunId), `${JSON.stringify(message)}\n`, "utf8");
        return message;
      } finally {
        await release();
      }
    });
    this.chains.set(normalizedRunId, chain.catch(() => {})); // 链不断：单条失败不堵后续
    return chain;
  }

  /** run 清除时的辅助资产回收（烛 v3.6 致命10）：bus 文件与写链一并清。 */
  async remove(runId) {
    const file = this.file(runId); // 先做 runId 白名单校验再动盘
    const chain = this.chains.get(runId);
    if (chain) await chain.catch(() => {});
    this.chains.delete(runId);
    await rm(file, { force: true });
  }

  async read(runId, { signal } = {}) {
    const file = this.file(runId); // runId 白名单校验必须在 catch 外——遍历攻击要显式拒绝，不是静默空表
    let raw;
    try {
      throwIfAborted(signal);
      raw = await this.readWholeFile(file, { encoding: "utf8", signal });
      throwIfAborted(signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      const result = ioDiagnostic(error);
      if (result.diagnostics.status === "missing") return [];
      throw diagnosticError(result.diagnostics);
    }
    const result = parseJsonLines(raw, { expectedRunId: assertRunId(runId) });
    if (result.diagnostics.status === "degraded") {
      throw diagnosticError(result.diagnostics);
    }
    return result.messages;
  }

  /** Mission/audit surfaces use this bounded tail instead of loading an unbounded run file. */
  async readTail(runId, {
    maxBytes = BUS_TAIL_LIMITS.defaultMaxBytes,
    maxMessages = BUS_TAIL_LIMITS.defaultMaxMessages,
    signal,
  } = {}) {
    const file = this.file(runId);
    const byteLimit = positiveBound(maxBytes, BUS_TAIL_LIMITS.defaultMaxBytes, BUS_TAIL_LIMITS.maxBytes, "maxBytes");
    const messageLimit = positiveBound(
      maxMessages,
      BUS_TAIL_LIMITS.defaultMaxMessages,
      BUS_TAIL_LIMITS.maxMessages,
      "maxMessages",
    );
    let handle;
    try {
      throwIfAborted(signal);
      handle = await this.openFile(file, "r");
      throwIfAborted(signal);
      const stats = await handle.stat();
      throwIfAborted(signal);
      const fileSizeBytes = Number(stats.size);
      if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes < 0) {
        throw Object.assign(new Error("bus JSONL has an invalid size"), { code: "EOVERFLOW" });
      }
      let result;
      if (fileSizeBytes === 0) {
        result = { messages: [], diagnostics: baseDiagnostics({ fileSizeBytes }) };
      } else {
        const start = Math.max(0, fileSizeBytes - byteLimit);
        const input = handle.createReadStream({
          start,
          end: fileSizeBytes - 1,
          autoClose: false,
          signal,
        });
        const buffer = await collectStream(input, signal);
        result = parseJsonLines(buffer.toString("utf8"), {
          maxMessages: messageLimit,
          leadingPartial: start > 0,
          expectedRunId: assertRunId(runId),
          fileSizeBytes,
          bytesRead: buffer.length,
        });
        const expectedBytes = fileSizeBytes - start;
        if (buffer.length !== expectedBytes) {
          result.diagnostics.status = "degraded";
          result.diagnostics.issues.unshift(diagnosticIssue(
            "BUS_READ_SHORT",
            "bus JSONL changed while its tail was being read",
          ));
          result.diagnostics.issues = result.diagnostics.issues.slice(0, BUS_TAIL_LIMITS.maxIssues);
        }
      }
      await handle.close();
      handle = null;
      throwIfAborted(signal);
      return result;
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      return ioDiagnostic(error);
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  /** 给收件 agent 的有界快照：发给它的 + 它自己发过的（线程参与者可见）+ 广播 + 治理类（task/steer/system/decide），
   按消息粒度从旧到新裁进 maxChars（grok/kimi 24k 命令行上限是源头约束）。 */
  snapshot(messages, { forAgent, maxChars = 12_000 } = {}) {
    const relevant = messages.filter(
      (message) =>
        message.to === forAgent
        || message.from === forAgent
        || message.to === "team"
        || ["task", "steer", "system", "decide", "memo"].includes(message.kind),
    );
    const rendered = relevant.map((message) => `[${message.from} → ${message.to}] ${message.text}`);
    const out = [];
    let size = 0;
    for (let index = rendered.length - 1; index >= 0; index -= 1) {
      size += rendered[index].length + 1;
      if (size > maxChars) break;
      out.unshift(rendered[index]);
    }
    return out.join("\n");
  }
}
