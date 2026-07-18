// 514cc 会话聚合服务（v3.5 桌面版增量，codeg "读各 CLI 本地会话存储"思路）：
// 统一列出四源会话元数据——Claude Code（~/.claude/projects/*/*.jsonl）、
// Codex（~/.codex/sessions 递归 rollout jsonl）、对话桥（.ai-shared/roster.json）、
// Grok Build（~/.grok 会话目录，best-effort 探测）。
// 每源独立 try/catch：拿得到就列，拿不到如实标 unavailable——绝不伪造。
// 只读元数据 + 首条用户消息摘要（截断），不回传完整会话内容（隐私面最小化）。
import { open, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { redactString } from "./redaction.mjs";

const SUMMARY_SCAN_BYTES = 64 * 1024;
const SUMMARY_MAX_CHARS = 140;

// 项目目录名 / 会话 id 白名单（preview 直接拼文件路径，必须拒绝分隔符与 ".." 遍历）
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Windows 设备保留名（CON/NUL/COM1…）打开的是设备不是文件；尾点名 Win32 层会静默去点（烛 R5 建议）
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
const PREVIEW_TAIL_BYTES = 1024 * 1024;
const PREVIEW_MAX_MESSAGES = 60;
const PREVIEW_CHAR_LIMIT = 600;
const HEAD_SCAN_MAX_BYTES = 4 * 1024 * 1024;
const HEAD_SCAN_MAX_LINE = 2 * 1024 * 1024;

function safePathName(value) {
  const name = String(value ?? "");
  return SAFE_NAME.test(name) && !WINDOWS_RESERVED.test(name) && !name.endsWith(".");
}

// 赋值型秘密（烛 R-P2 R8 致命：redactString 只认高熵凭据格式，password=MyCompanySecret1234
// 这类会漏）。补一层 key=value / key: value 赋值脱敏，覆盖 redactString 的盲区。
const ASSIGNMENT_SECRET =
  /\b(api[_-]?key|access[_-]?key|secret|password|passwd|pwd|token|authorization|auth|credential|private[_-]?key|passphrase)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi;

function scrub(text) {
  return redactString(text).replace(ASSIGNMENT_SECRET, (match) => {
    const sep = match.includes("=") ? "=" : ":";
    return `${match.slice(0, match.indexOf(sep) + 1)} [REDACTED]`;
  });
}

// 流式逐行扫头部：对每个完整行调用 visit(line)，返回非空即早停。
// 固定 64KB 窗口的旧实现会被 >64KB 的单行大事件挡住（烛 R5 实测：本机有会话首行 522KB）——
// 这里跳过超过 maxLine 的行继续扫，找到目标即停，避免为长会话整读大块。
async function scanHeadLines(path, visit, { maxBytes = HEAD_SCAN_MAX_BYTES, maxLine = HEAD_SCAN_MAX_LINE } = {}) {
  const handle = await open(path, "r");
  try {
    const chunkSize = SUMMARY_SCAN_BYTES;
    const buffer = Buffer.alloc(chunkSize);
    const decoder = new StringDecoder("utf8"); // chunk 边界的多字节字符不撕裂
    let position = 0;
    let carry = "";
    let skippingOversizedLine = false;
    while (position < maxBytes) {
      const { bytesRead } = await handle.read(buffer, 0, chunkSize, position);
      if (!bytesRead) break;
      position += bytesRead;
      const lines = (carry + decoder.write(buffer.subarray(0, bytesRead))).split(/\r?\n/);
      carry = lines.pop() ?? "";
      for (const line of lines) {
        if (skippingOversizedLine) {
          skippingOversizedLine = false; // 超长行的尾巴，丢弃后恢复正常扫描
          continue;
        }
        const result = visit(line);
        if (result != null) return result;
      }
      if (carry.length > maxLine) {
        carry = "";
        skippingOversizedLine = true;
      }
    }
    if (!skippingOversizedLine && carry) {
      const result = visit(carry + decoder.end());
      if (result != null) return result;
    }
    return null;
  } finally {
    await handle.close();
  }
}

function clip(text) {
  // 先脱敏再截断（烛 R-P2 致命1）：截断不是脱敏。双层——redactString（高熵凭据格式）
  // + scrub 赋值型（password=xxx 这类 redactString 盲区，烛 R8 致命）。
  const flat = scrub(text).replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_MAX_CHARS ? `${flat.slice(0, SUMMARY_MAX_CHARS)}…` : flat;
}

// Claude Code 会话开头常见的系统包装块（本地命令 caveat / 命令回显 / system-reminder）——
// 不剥掉的话会话标题全是 "<local-command-caveat>Caveat: ..." 这类无区分度文本
const SYSTEM_WRAPPER_BLOCKS =
  /<(local-command-caveat|local-command-stdout|command-name|command-message|command-args|system-reminder|task-notification)>[\s\S]*?<\/\1>/g;

/** 剥掉系统包装块后剩余的真实用户文本；全是包装（或包装被扫描窗口截断）则返回 null。 */
function meaningfulUserText(raw) {
  const text = String(raw).replace(SYSTEM_WRAPPER_BLOCKS, " ").trim();
  if (!text) return null;
  if (/^<(?:local-command|command-|system-reminder|task-notification)/.test(text)) return null; // 未闭合的包装块
  return text;
}

/** 单行判定：这一行是否携带真实用户消息文本（Claude/Codex 事件行格式差异都走 best-effort）。 */
function userTextFromLine(line) {
  if (!line.trim().startsWith("{")) return null;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null; // 截断的半行
  }
  if (event.isMeta === true) return null; // 命令回显等元事件不算用户输入
  // 候选形态（烛 R-P2：Codex rollout 行是 payload:{role,content} 直挂）：
  // Claude {message:{role,content}} / Codex {payload:{role,content}} 或 {payload:{message:{...}}} / 裸 {role,content}
  const message = event.message ?? event.payload?.message ?? event.payload ?? event;
  const role = message?.role ?? event.role ?? event.type;
  if (role !== "user") return null;
  const content = message?.content ?? event.content;
  let candidate = null;
  if (typeof content === "string") candidate = content;
  else if (Array.isArray(content)) {
    const parts = content.filter((part) => typeof part?.text === "string" && part.text.trim()).map((part) => part.text);
    if (parts.length) candidate = parts.join("\n");
  }
  if (!candidate?.trim()) return null;
  const meaningful = meaningfulUserText(candidate);
  return meaningful ? clip(meaningful) : null;
}

/** 从文件头部流式找第一条用户消息摘要。 */
function firstUserTextFromFile(path) {
  return scanHeadLines(path, userTextFromLine);
}

/** 单行判定：cwd 字段。 */
function cwdFromLine(line) {
  if (!line.trim().startsWith("{")) return null;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  return typeof event.cwd === "string" && event.cwd.trim() ? event.cwd.trim() : null;
}

/** 路径末段（跨 win32/posix 分隔符），用作项目显示名。 */
function lastSegment(path) {
  return String(path).split(/[\\/]/).filter(Boolean).pop() ?? String(path);
}

/** 读文件尾部 maxBytes（大会话文件不整读）。 */
async function tailText(path, maxBytes) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    return { text: buffer.toString("utf8"), truncatedHead: start > 0 };
  } finally {
    await handle.close();
  }
}

async function collectJsonl(root, { maxDepth, limit }) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > maxDepth || found.length >= limit * 4) return;
    let names;
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      if (found.length >= limit * 4) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const info = await stat(path);
          found.push({ path, name: entry.name, dir, size: info.size, mtimeMs: info.mtimeMs });
        } catch {
          // 扫描期间消失的文件跳过
        }
      }
    }
  }
  await walk(root, 0);
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, limit);
}

export class SessionAggregator {
  constructor({ aiSharedRoot, home = homedir() } = {}) {
    this.aiSharedRoot = aiSharedRoot;
    this.home = home;
  }

  // includeSummaries 默认关闭（烛 R-P2 R8：脱敏是尽力而为，纵深防御=默认不展示会话原文摘要，
  // 前端需要时显式 opt-in ?summaries=1；即便开启也过双层 scrub）。元数据（id/时间/大小）永远安全。
  async list({ limitPerSource = 25, includeSummaries = false } = {}) {
    const [claude, codex, bridge, grok] = await Promise.all([
      this.#claudeSessions(limitPerSource, includeSummaries),
      this.#codexSessions(limitPerSource, includeSummaries),
      this.#bridgeThreads(),
      this.#grokSessions(limitPerSource),
    ]);
    return { includeSummaries, sources: [claude, codex, bridge, grok] };
  }

  // 协作台左栏「项目树」数据：Claude Code 会话按项目分组，项目下挂历史对话。
  // 项目真实路径从最新会话 jsonl 的 cwd 字段还原（无损）；summary 与 list() 同纪律——opt-in + 双层 scrub。
  async projects({ perProjectLimit = 10, includeSummaries = false } = {}) {
    const root = join(this.home, ".claude", "projects");
    const result = { source: "claude", available: false, includeSummaries, projects: [] };
    let dirs;
    try {
      dirs = await readdir(root, { withFileTypes: true });
    } catch (error) {
      result.error = error.code || error.message;
      return result;
    }
    result.available = true;
    // 列表入口与 preview 共用同一条隐私不变量（烛 R6 致命1）：逃逸 projects 根的 symlink
    // 不只 preview 要拒，扫描阶段（cwd 提取/opt-in 摘要都会读文件）就不能读、不能列
    let realRoot;
    try {
      realRoot = await realpath(root);
    } catch (error) {
      result.available = false;
      result.error = error.code || error.message;
      return result;
    }
    const projects = [];
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      if (!safePathName(dir.name)) continue; // 前端可点但后端必拒的条目不列出（烛 R6 建议）
      const projectDir = join(root, dir.name);
      let names;
      try {
        names = await readdir(projectDir);
      } catch {
        continue;
      }
      const files = [];
      for (const name of names) {
        if (!name.endsWith(".jsonl")) continue;
        if (!safePathName(name.replace(/\.jsonl$/, ""))) continue;
        try {
          const filePath = join(projectDir, name);
          const [info, real] = await Promise.all([stat(filePath), realpath(filePath)]);
          if (!info.isFile() || !real.startsWith(realRoot + sep)) continue;
          files.push({ name, path: real, size: info.size, mtimeMs: info.mtimeMs });
        } catch {
          // 扫描期间消失的文件跳过
        }
      }
      if (!files.length) continue;
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
      let realPath = null;
      try {
        realPath = await scanHeadLines(files[0].path, cwdFromLine);
      } catch {
        // cwd 提取 best-effort，失败回退目录名
      }
      if (realPath) realPath = scrub(realPath); // 纵深防御：会话文件内容一律过脱敏，路径正常时无副作用
      const sessions = [];
      for (const file of files.slice(0, perProjectLimit)) {
        let summary = null;
        if (includeSummaries) {
          try {
            summary = await firstUserTextFromFile(file.path);
          } catch {
            // 摘要失败不影响列出
          }
        }
        sessions.push({
          id: file.name.replace(/\.jsonl$/, ""),
          summary,
          size: file.size,
          modifiedAt: new Date(file.mtimeMs).toISOString(),
        });
      }
      projects.push({
        id: dir.name,
        label: realPath ? lastSegment(realPath) : dir.name,
        path: realPath,
        sessionCount: files.length,
        latestMs: files[0].mtimeMs,
        sessions,
      });
    }
    projects.sort((a, b) => b.latestMs - a.latestMs);
    result.projects = projects.map(({ latestMs, ...rest }) => rest);
    return result;
  }

  // 会话 jsonl 的安全路径解析（与 preview 同纪律：白名单 + realpath 限根 + isFile）——
  // 供"在资源管理器中定位会话文件"等只读定位用途
  async resolveFilePath({ project, id } = {}) {
    if (!safePathName(project) || !safePathName(id)) {
      throw Object.assign(new Error("invalid project or session id"), { code: "VALIDATION_FAILED" });
    }
    const projectsRoot = join(this.home, ".claude", "projects");
    const path = join(projectsRoot, project, `${id}.jsonl`);
    let real;
    let realRoot;
    try {
      [real, realRoot] = await Promise.all([realpath(path), realpath(projectsRoot)]);
    } catch {
      throw Object.assign(new Error("session not found"), { code: "SOURCE_NOT_FOUND" });
    }
    if (!real.startsWith(realRoot + sep)) {
      throw Object.assign(new Error("session path escapes the projects root"), { code: "VALIDATION_FAILED" });
    }
    const info = await stat(real).catch(() => null);
    if (!info?.isFile()) {
      throw Object.assign(new Error("session not found"), { code: "SOURCE_NOT_FOUND" });
    }
    return real;
  }

  // 历史对话只读预览：只回 user/assistant 文本骨架（不回 tool 结果/侧链——密钥最常藏在工具输出里），
  // 每条过双层 scrub + 截断。project/id 白名单校验防路径遍历。
  async preview({ project, id, maxMessages = PREVIEW_MAX_MESSAGES } = {}) {
    if (!safePathName(project) || !safePathName(id)) {
      throw Object.assign(new Error("invalid project or session id"), { code: "VALIDATION_FAILED" });
    }
    const projectsRoot = join(this.home, ".claude", "projects");
    const path = join(projectsRoot, project, `${id}.jsonl`);
    // realpath 限根（烛 R5 建议）：白名单挡不住目录 junction / 会话文件 symlink 指向根外。
    // 校验后统一用 resolved 路径 stat/读取，收窄校验-打开之间的 TOCTOU 窗口（烛 R6 建议）
    let real;
    let realRoot;
    try {
      [real, realRoot] = await Promise.all([realpath(path), realpath(projectsRoot)]);
    } catch {
      throw Object.assign(new Error("session not found"), { code: "SOURCE_NOT_FOUND" });
    }
    if (!real.startsWith(realRoot + sep)) {
      throw Object.assign(new Error("session path escapes the projects root"), { code: "VALIDATION_FAILED" });
    }
    let info;
    try {
      info = await stat(real);
    } catch {
      throw Object.assign(new Error("session not found"), { code: "SOURCE_NOT_FOUND" });
    }
    if (!info.isFile()) {
      throw Object.assign(new Error("session path escapes the projects root"), { code: "VALIDATION_FAILED" });
    }
    const { text, truncatedHead } = await tailText(real, PREVIEW_TAIL_BYTES);
    const lines = text.split(/\r?\n/);
    if (truncatedHead) lines.shift(); // 尾读窗口的首行可能是半行
    const messages = [];
    for (const line of lines) {
      if (!line.trim().startsWith("{")) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.isSidechain === true) continue; // 子代理侧链不进主对话预览
      if (event.isMeta === true) continue; // 命令回显等元事件不进预览
      const message = event.message ?? null;
      const role = message?.role;
      if (role !== "user" && role !== "assistant") continue;
      let body = null;
      if (typeof message.content === "string" && message.content.trim()) {
        body = message.content;
      } else if (Array.isArray(message.content)) {
        const parts = message.content
          .filter((part) => part?.type === "text" && typeof part.text === "string" && part.text.trim())
          .map((part) => part.text);
        if (parts.length) body = parts.join("\n");
      }
      if (body && role === "user") body = meaningfulUserText(body); // 剥系统包装，纯包装行跳过
      if (!body) continue; // 纯工具调用/工具结果行不进预览
      const flat = scrub(body).trim();
      messages.push({
        role,
        text: flat.length > PREVIEW_CHAR_LIMIT ? `${flat.slice(0, PREVIEW_CHAR_LIMIT)}…` : flat,
        timestamp: typeof event.timestamp === "string" ? event.timestamp : null,
      });
    }
    const clipped = messages.slice(-maxMessages);
    return {
      source: "claude",
      project,
      id,
      totalBytes: info.size,
      modifiedAt: new Date(info.mtimeMs).toISOString(),
      truncated: truncatedHead || clipped.length < messages.length,
      messages: clipped,
    };
  }

  async #claudeSessions(limit, includeSummaries) {
    const source = { source: "claude", label: "Claude Code", available: false, sessions: [] };
    const projectsRoot = join(this.home, ".claude", "projects");
    try {
      const projects = await readdir(projectsRoot, { withFileTypes: true });
      const realRoot = await realpath(projectsRoot);
      source.available = true;
      const files = [];
      for (const project of projects) {
        if (!project.isDirectory()) continue;
        const projectDir = join(projectsRoot, project.name);
        let names;
        try {
          names = await readdir(projectDir);
        } catch {
          continue;
        }
        for (const name of names) {
          if (!name.endsWith(".jsonl")) continue;
          try {
            const filePath = join(projectDir, name);
            // 与 projects()/preview() 同一条限根不变量：逃逸 symlink 不列出、不读取（烛 R6 致命1）
            const [info, real] = await Promise.all([stat(filePath), realpath(filePath)]);
            if (!info.isFile() || !real.startsWith(realRoot + sep)) continue;
            files.push({ project: project.name, name, path: real, size: info.size, mtimeMs: info.mtimeMs });
          } catch {
            // 跳过瞬时消失文件
          }
        }
      }
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const file of files.slice(0, limit)) {
        let summary = null;
        if (includeSummaries) {
          try {
            summary = await firstUserTextFromFile(file.path);
          } catch {
            // 摘要失败不影响列出
          }
        }
        source.sessions.push({
          id: file.name.replace(/\.jsonl$/, ""),
          scope: file.project,
          summary,
          size: file.size,
          modifiedAt: new Date(file.mtimeMs).toISOString(),
        });
      }
    } catch (error) {
      source.error = error.code || error.message;
    }
    return source;
  }

  async #codexSessions(limit, includeSummaries) {
    const source = { source: "codex", label: "Codex CLI", available: false, sessions: [] };
    const root = join(this.home, ".codex", "sessions");
    try {
      await stat(root);
      source.available = true;
      const files = await collectJsonl(root, { maxDepth: 4, limit });
      for (const file of files) {
        let summary = null;
        if (includeSummaries) {
          try {
            summary = await firstUserTextFromFile(file.path);
          } catch {
            // 摘要 best-effort
          }
        }
        source.sessions.push({
          id: file.name.replace(/\.jsonl$/, ""),
          scope: file.dir.slice(root.length + 1) || ".",
          summary,
          size: file.size,
          modifiedAt: new Date(file.mtimeMs).toISOString(),
        });
      }
    } catch (error) {
      source.error = error.code || error.message;
    }
    return source;
  }

  async #bridgeThreads() {
    const source = { source: "bridge", label: "对话桥（roster）", available: false, sessions: [] };
    try {
      const roster = JSON.parse(await readFile(join(this.aiSharedRoot, "roster.json"), "utf8"));
      source.available = true;
      for (const [code, agent] of Object.entries(roster.agents || {})) {
        source.sessions.push({
          id: agent.lastThreadId || "(无活跃线程)",
          scope: `${agent.name || code} · ${agent.transport || "?"}`,
          // lastTopic 约定只写治理描述，但仍过 scrub（烛 R-P3 建议：不依赖写入契约，纵深防御）
          summary: agent.lastTopic ? scrub(agent.lastTopic) : null,
          size: null,
          modifiedAt: agent.lastRunAt || null,
        });
      }
    } catch (error) {
      source.error = error.code || error.message;
    }
    return source;
  }

  async #grokSessions(limit) {
    const source = { source: "grok", label: "Grok Build", available: false, sessions: [] };
    // Grok Build 会话目录未在本机实证过固定结构——按常见候选探测，全部落空则如实 unavailable
    for (const candidate of ["sessions", "threads", "history"]) {
      const root = join(this.home, ".grok", candidate);
      try {
        await stat(root);
        source.available = true;
        const files = await collectJsonl(root, { maxDepth: 3, limit });
        for (const file of files) {
          source.sessions.push({
            id: file.name.replace(/\.jsonl$/, ""),
            scope: file.dir.slice(root.length + 1) || candidate,
            summary: null,
            size: file.size,
            modifiedAt: new Date(file.mtimeMs).toISOString(),
          });
        }
        return source;
      } catch {
        // 尝试下一个候选目录
      }
    }
    source.error = "no known session directory";
    return source;
  }
}
