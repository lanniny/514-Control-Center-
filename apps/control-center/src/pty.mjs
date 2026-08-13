/**
 * pty.mjs — Wave G 本机 PTY 终端核心（node-pty ConPTY）。
 *
 * 契约（v40 设计 §3.4）：
 *   - cwd 沙箱：默认 repoRoot；显式 cwd 必须在 repoRoot 内或 allowlist 根内
 *   - 输出：256KB 环形缓冲 + SSE 推流，redaction 过滤敏感模式
 *   - 输入：单飞有序写队列（promise chain）
 *   - 生命周期：spawn 登记 child-registry，exit/kill 注销；审计 pty.spawn/exit/kill
 */

import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { isWithin } from "./paths.mjs";
import { childRegistry } from "./child-registry.mjs";
import { scrub } from "./redaction.mjs";

const require = createRequire(import.meta.url);
const pty = require("node-pty");

const BUFFER_CAP = 256 * 1024;
const SESSION_CAP = 16;
const ARGS_CAP = 32;
const ARGS_CHARS_CAP = 4096;
const TITLE_CAP = 120;

/** spawn 参数白名单清洗：必须数组、逐元素 String 化、拒 NUL；超帽如实 400，不静默截断。 */
function sanitizeArgs(args) {
  if (args == null) return [];
  if (!Array.isArray(args)) {
    throw Object.assign(new Error("pty args must be an array of strings"), { code: "PTY_BAD_ARGS", httpStatus: 400 });
  }
  if (args.length > ARGS_CAP) {
    throw Object.assign(new Error(`pty args cap reached (${ARGS_CAP})`), { code: "PTY_BAD_ARGS", httpStatus: 400 });
  }
  const out = args.map((item) => String(item));
  if (out.some((item) => item.includes("\0")) || out.join("").length > ARGS_CHARS_CAP) {
    throw Object.assign(new Error("pty args contain NUL or exceed size cap"), { code: "PTY_BAD_ARGS", httpStatus: 400 });
  }
  return out;
}

/** 页签标题（如「lanniny-45 · /srv/data」）：去 NUL/trim，超长截断，空则 null 走 shell 名。 */
function sanitizeTitle(title) {
  if (title == null) return null;
  const clean = String(title).replace(/\0/g, "").trim().slice(0, TITLE_CAP);
  return clean || null;
}

/**
 * 默认 shell（LO 2026-08-08：终端要和自己的 PowerShell 一致，而不是 cmd）。
 * Windows 依次探测 PowerShell 7 → Windows PowerShell → COMSPEC/cmd.exe：
 * 命中哪个都会加载用户自己的 profile，提示符与配色自然与本机一致。
 * 只认 PATH 中真实存在的可执行文件，探测失败一律回落 cmd.exe，不猜路径。
 */
export function defaultShell(platform = process.platform, env = process.env, exists = existsSync) {
  if (platform !== "win32") return env.SHELL || "sh";
  const dirs = String(env.PATH || env.Path || "").split(";").map((item) => item.trim()).filter(Boolean);
  for (const candidate of ["pwsh.exe", "powershell.exe"]) {
    for (const dir of dirs) {
      const full = join(dir, candidate);
      try {
        if (exists(full)) return full;
      } catch { /* 不可读目录不算命中 */ }
    }
  }
  return env.COMSPEC || "cmd.exe";
}

export function createPtyService({
  repoRoot,
  eventStore = null,
  spawnImpl = pty.spawn.bind(pty),
  registry = null,
  extraCwdRoots = [],
} = {}) {
  const sessions = new Map(); // id → session
  const root = resolve(repoRoot);
  const allowedRoots = [root, ...extraCwdRoots.map((entry) => resolve(entry))];

  function audit(type, detail) {
    void eventStore?.emit?.(type, detail, { sensitivity: "internal", agentId: "control-plane" })?.catch?.(() => {});
  }

  function assertCwd(candidate) {
    if (candidate == null || candidate === "") return root;
    const resolved = resolve(String(candidate));
    if (allowedRoots.some((allowed) => isWithin(allowed, resolved))) return resolved;
    throw Object.assign(new Error("pty cwd escapes its allowed roots"), {
      code: "PTY_CWD_BOUNDARY",
      httpStatus: 403,
    });
  }

  function pushOutput(session, chunk) {
    const clean = scrub(String(chunk));
    if (!clean) return;
    session.buffer = (session.buffer + clean).slice(-BUFFER_CAP);
    session.bytes += clean.length;
    for (const listener of session.listeners) {
      try {
        listener(clean);
      } catch { /* 单个订阅者异常不阻断广播 */ }
    }
  }

  function create({ shell, cwd, cols = 80, rows = 24, args = null, title = null } = {}) {
    if (sessions.size >= SESSION_CAP) {
      throw Object.assign(new Error(`pty session cap reached (${SESSION_CAP})`), { code: "PTY_CAP", httpStatus: 429 });
    }
    const safeCwd = assertCwd(cwd);
    const safeCols = Math.min(500, Math.max(1, Number(cols) || 80));
    const safeRows = Math.min(500, Math.max(1, Number(rows) || 24));
    const safeArgs = sanitizeArgs(args);
    const safeTitle = sanitizeTitle(title);
    const command = typeof shell === "string" && shell.trim() ? shell.trim() : defaultShell();
    const proc = spawnImpl(command, safeArgs, {
      name: "xterm-color",
      cwd: safeCwd,
      cols: safeCols,
      rows: safeRows,
      env: process.env,
    });
    const id = randomUUID().slice(0, 8);
    const session = {
      id,
      shell: command,
      title: safeTitle,
      cwd: safeCwd,
      pid: proc.pid,
      cols: safeCols,
      rows: safeRows,
      buffer: "",
      bytes: 0,
      exited: false,
      exitCode: null,
      createdAt: new Date().toISOString(),
      listeners: new Set(),
      writeChain: Promise.resolve(),
      proc,
    };
    sessions.set(id, session);
    try {
      (registry ?? childRegistry())?.register(proc.pid, command);
    } catch { /* 台账未初始化不阻断会话（测试场景） */ }
    proc.onData((chunk) => pushOutput(session, chunk));
    proc.onExit(({ exitCode }) => {
      session.exited = true;
      session.exitCode = exitCode;
      try {
        (registry ?? childRegistry())?.unregister(proc.pid);
      } catch { /* 同上 */ }
      for (const listener of session.listeners) {
        try {
          listener(null, { exited: true, exitCode });
        } catch { /* 忽略 */ }
      }
      audit("pty.exit", { id, pid: proc.pid, exitCode });
    });
    audit("pty.spawn", { id, pid: proc.pid, shell: command, cwd: safeCwd });
    return { id, shell: command, title: safeTitle, cwd: safeCwd, pid: proc.pid, cols: safeCols, rows: safeRows, createdAt: session.createdAt };
  }

  function get(id) {
    return sessions.get(String(id)) ?? null;
  }

  function list() {
    return [...sessions.values()].map((session) => ({
      id: session.id,
      shell: session.shell,
      title: session.title ?? null,
      cwd: session.cwd,
      pid: session.pid,
      cols: session.cols,
      rows: session.rows,
      exited: session.exited,
      exitCode: session.exitCode,
      createdAt: session.createdAt,
      bytes: session.bytes,
    }));
  }

  /** 订阅输出。listener(chunk) 数据块；listener(null, { exited, exitCode }) 终态。返回退订函数。 */
  function subscribe(id, listener, { replay = true } = {}) {
    const session = get(id);
    if (!session) return null;
    if (replay && session.buffer) listener(session.buffer);
    session.listeners.add(listener);
    if (session.exited) listener(null, { exited: true, exitCode: session.exitCode });
    return () => session.listeners.delete(listener);
  }

  function write(id, data) {
    const session = get(id);
    if (!session) {
      throw Object.assign(new Error(`pty session not found: ${id}`), { code: "PTY_NOT_FOUND", httpStatus: 404 });
    }
    if (session.exited) {
      throw Object.assign(new Error("pty session already exited"), { code: "PTY_EXITED", httpStatus: 409 });
    }
    const payload = String(data ?? "");
    session.writeChain = session.writeChain.then(() => {
      if (!session.exited) session.proc.write(payload);
    });
    return session.writeChain;
  }

  function resize(id, cols, rows) {
    const session = get(id);
    if (!session) {
      throw Object.assign(new Error(`pty session not found: ${id}`), { code: "PTY_NOT_FOUND", httpStatus: 404 });
    }
    const safeCols = Math.min(500, Math.max(1, Number(cols) || session.cols));
    const safeRows = Math.min(500, Math.max(1, Number(rows) || session.rows));
    session.cols = safeCols;
    session.rows = safeRows;
    if (!session.exited) session.proc.resize(safeCols, safeRows);
    return { cols: safeCols, rows: safeRows };
  }

  function kill(id) {
    const session = get(id);
    if (!session) return false;
    sessions.delete(session.id);
    if (!session.exited) {
      session.exited = true;
      try {
        session.proc.kill();
      } catch { /* 已死 */ }
      try {
        (registry ?? childRegistry())?.unregister(session.pid);
      } catch { /* 同上 */ }
      audit("pty.kill", { id: session.id, pid: session.pid });
    }
    for (const listener of session.listeners) {
      try {
        listener(null, { exited: true, exitCode: session.exitCode, killed: true });
      } catch { /* 忽略 */ }
    }
    session.listeners.clear();
    return true;
  }

  async function closeAll() {
    for (const session of [...sessions.values()]) kill(session.id);
  }

  return { create, get, list, subscribe, write, resize, kill, closeAll, assertCwd };
}
