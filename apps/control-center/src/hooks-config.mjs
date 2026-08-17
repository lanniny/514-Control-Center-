/**
 * hooks-config.mjs — 本机钩子真源：Claude settings / Cursor hooks.json / Codex hooks.json /
 * Gemini settings / Kimi config.toml。Grok / OpenCode / Pi 没有独立 hooks 文件，不造假真源。
 * 只改 hooks 键；写前留 .514cc-backup；mtime 对不上就拒写。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const CLAUDE_EVENTS = Object.freeze([
  "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse",
  "PostToolUseFailure", "Stop", "StopFailure", "Notification", "PermissionRequest",
  "SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "Elicitation",
]);

export const PRIMARY_HOOK_EVENTS = Object.freeze([
  "SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest",
  "PostToolUse", "PostToolUseFailure", "Stop",
]);

export const GEMINI_EVENTS = Object.freeze([
  "SessionStart", "SessionEnd", "BeforeAgent", "AfterAgent",
  "BeforeTool", "AfterTool", "Notification", "PreCompress",
]);

export const DEFAULT_HOOK_TIMEOUT = 60;

const CURSOR_EVENT_TO_CANON = Object.freeze({
  sessionStart: "SessionStart",
  beforeSubmitPrompt: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  stop: "Stop",
  sessionEnd: "SessionEnd",
  postToolUse: "PostToolUse",
  postToolUseFailure: "PostToolUseFailure",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
  preCompact: "PreCompact",
  afterAgentThought: "AfterAgentThought",
});
const CANON_TO_CURSOR = Object.freeze({
  SessionStart: "sessionStart",
  UserPromptSubmit: "beforeSubmitPrompt",
  PreToolUse: "preToolUse",
  Stop: "stop",
  SessionEnd: "sessionEnd",
  PostToolUse: "postToolUse",
  PostToolUseFailure: "postToolUseFailure",
  SubagentStart: "subagentStart",
  SubagentStop: "subagentStop",
  PreCompact: "preCompact",
  AfterAgentThought: "afterAgentThought",
});

const KNOWN_HOOK_KEYS = new Set(["type", "command", "url", "timeout", "async", "shell", "statusMessage", "prompt", "name"]);
const PROTECTED_RE = /(?:^|[\\/])(?:route-gate(?:-codex)?|stop-gate(?:-codex)?|mirror-gate(?:-codex)?)\.py\b/i;
const MUTATION_CHAINS = new Map();

export function resolveHooksHomeDir(env = process.env) {
  return env.CONTROL_CENTER_RUNTIME_HOME || env.USERPROFILE || env.HOME || homedir();
}

export function resolveHookStoreId({ store, scope = "user", layer = "shared", runtime = "claude" } = {}) {
  if (store) return String(store);
  const rt = String(runtime || "claude");
  if (rt === "cursor") return scope === "user" ? "cursor-user" : "cursor-project";
  if (rt === "codex") return scope === "user" ? "codex-user" : "codex-project";
  if (rt === "gemini") return "gemini-user";
  if (rt === "kimi") return "kimi-user";
  if (scope === "project") return layer === "local" ? "claude-project-local" : "claude-project";
  return layer === "local" ? "claude-user-local" : "claude-user";
}

export function eventsForStore(store) {
  const runtime = typeof store === "string" ? store : store?.runtime;
  const format = typeof store === "object" ? store.format : "";
  if (runtime === "cursor" || String(store?.id || store || "").startsWith("cursor-")) {
    return Object.values(CURSOR_EVENT_TO_CANON);
  }
  if (runtime === "gemini" || format === "gemini" || String(store?.id || store || "").startsWith("gemini-")) {
    return [...GEMINI_EVENTS];
  }
  return [...CLAUDE_EVENTS];
}

function serializeMutation(key, operation) {
  const previous = MUTATION_CHAINS.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.catch(() => {});
  MUTATION_CHAINS.set(key, tail);
  void tail.then(() => {
    if (MUTATION_CHAINS.get(key) === tail) MUTATION_CHAINS.delete(key);
  });
  return result;
}

function hooksError(code, message, httpStatus = 400) {
  return Object.assign(new Error(message), { code, httpStatus });
}

function inferCwd(command) {
  const text = String(command ?? "");
  const match = text.match(/(?:[A-Za-z]:[\\/][^\s"'`]+|[\\/][^\s"'`]+)/);
  if (!match) return "";
  const file = match[0].replace(/[\\/]+$/, "");
  const cut = Math.max(file.lastIndexOf("\\"), file.lastIndexOf("/"));
  return cut > 0 ? file.slice(0, cut) : "";
}

function isProtectedCommand(command) {
  return PROTECTED_RE.test(String(command ?? ""));
}

function hookFingerprint(item) {
  return [
    item.event,
    item.matcher ?? "",
    item.type ?? "command",
    item.command ?? "",
    item.url ?? "",
  ].join("\u0001");
}

function hookId(storeId, fingerprint) {
  const digest = createHash("sha1").update(`${storeId}\n${fingerprint}`).digest("hex").slice(0, 16);
  return `${storeId}:${digest}`;
}

function hookCustom(hook) {
  const custom = {};
  for (const [key, value] of Object.entries(hook || {})) {
    if (!KNOWN_HOOK_KEYS.has(key)) custom[key] = value;
  }
  return custom;
}

function parseCustom(input) {
  if (input?.custom && typeof input.custom === "object" && !Array.isArray(input.custom)) {
    return { ...input.custom };
  }
  const raw = String(input?.customJson ?? "").trim();
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw hooksError("VALIDATION_FAILED", "自定义字段 JSON 无法解析");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw hooksError("VALIDATION_FAILED", "自定义字段必须是 JSON 对象");
  }
  return parsed;
}

function sanitizeCustom(custom) {
  const next = { ...custom };
  for (const key of KNOWN_HOOK_KEYS) delete next[key];
  return next;
}

function hookType(hook) {
  if (hook?.type === "http") return "http";
  if (hook?.type === "prompt") return "prompt";
  return "command";
}

function normalizeClaudeGroups(event, groups, storeMeta) {
  const items = [];
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    const matcher = String(group?.matcher ?? "");
    const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
    hooks.forEach((hook) => {
      if (!hook || typeof hook !== "object") return;
      const type = hookType(hook);
      const command = type === "http" ? "" : String(hook.command ?? hook.prompt ?? "");
      const url = type === "http" ? String(hook.url ?? "") : "";
      if (!command && !url) return;
      items.push({
        id: hookId(storeMeta.id, hookFingerprint({ event, matcher, type, command, url })),
        store: storeMeta.id,
        runtime: storeMeta.runtime,
        scope: storeMeta.scope,
        layer: storeMeta.layer,
        event,
        matcher,
        type,
        command,
        url,
        name: hook.name ? String(hook.name) : "",
        timeout: Number.isFinite(Number(hook.timeout)) ? Number(hook.timeout) : null,
        async: hook.async === true,
        shell: hook.shell ? String(hook.shell) : "",
        statusMessage: hook.statusMessage ? String(hook.statusMessage) : "",
        custom: hookCustom(hook),
        cwd: inferCwd(command),
        protected: isProtectedCommand(command),
        fingerprint: hookFingerprint({ event, matcher, type, command, url }),
      });
    });
  });
  return items;
}

function normalizeCursorHooks(eventKey, entries, storeMeta) {
  const event = CURSOR_EVENT_TO_CANON[eventKey] ?? eventKey;
  return (Array.isArray(entries) ? entries : []).flatMap((hook) => {
    const command = String(hook?.command ?? "");
    if (!command) return [];
    const matcher = String(hook?.matcher ?? "");
    return [{
      id: hookId(storeMeta.id, hookFingerprint({ event, matcher, type: "command", command, url: "" })),
      store: storeMeta.id,
      runtime: storeMeta.runtime,
      scope: storeMeta.scope,
      layer: storeMeta.layer,
      event,
      matcher,
      type: "command",
      command,
      url: "",
      name: "",
      timeout: Number.isFinite(Number(hook.timeout)) ? Number(hook.timeout) : null,
      async: false,
      shell: "",
      statusMessage: "",
      custom: hookCustom(hook),
      cwd: inferCwd(command),
      protected: isProtectedCommand(command),
      fingerprint: hookFingerprint({ event, matcher, type: "command", command, url: "" }),
    }];
  });
}

function unquoteToml(value) {
  return String(value ?? "").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}

export function parseKimiHookBlocks(text, storeMeta) {
  return String(text ?? "").split(/\[\[hooks\]\]/).slice(1).flatMap((block) => {
    const event = unquoteToml((block.match(/^\s*event\s*=\s*"((?:\\.|[^"\\])*)"/m) || [])[1] || "");
    const matcher = unquoteToml((block.match(/^\s*matcher\s*=\s*"((?:\\.|[^"\\])*)"/m) || [])[1] || "");
    const command = unquoteToml((block.match(/^\s*command\s*=\s*"((?:\\.|[^"\\])*)"/m) || [])[1] || "");
    const timeout = Number((block.match(/^\s*timeout\s*=\s*(\d+)/m) || [])[1]);
    if (!event || !command) return [];
    return [{
      id: hookId(storeMeta.id, hookFingerprint({ event, matcher, type: "command", command, url: "" })),
      store: storeMeta.id,
      runtime: storeMeta.runtime,
      scope: storeMeta.scope,
      layer: storeMeta.layer,
      event,
      matcher,
      type: "command",
      command,
      url: "",
      name: "",
      timeout: Number.isFinite(timeout) ? timeout : null,
      async: false,
      shell: "",
      statusMessage: "",
      custom: {},
      cwd: inferCwd(command),
      protected: isProtectedCommand(command),
      fingerprint: hookFingerprint({ event, matcher, type: "command", command, url: "" }),
    }];
  });
}

export function splitCommandArgs(command, argv) {
  const base = String(command ?? "").trim();
  const extras = (Array.isArray(argv) ? argv : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  if (!extras.length) return base;
  return [base, ...extras].join(" ");
}

export function createHooksConfig({
  repoRoot,
  homeDir = resolveHooksHomeDir(),
  io = { readFile, writeFile, mkdir, rename, rm, stat },
} = {}) {
  if (!repoRoot) throw new Error("hooks-config requires repoRoot");

  const stores = Object.freeze([
    {
      id: "claude-user",
      runtime: "claude",
      scope: "user",
      layer: "shared",
      format: "claude",
      label: "用户 · Claude Code",
      path: join(homeDir, ".claude", "settings.json"),
    },
    {
      id: "claude-user-local",
      runtime: "claude",
      scope: "user",
      layer: "local",
      format: "claude",
      label: "用户本地 · Claude Code",
      path: join(homeDir, ".claude", "settings.local.json"),
    },
    {
      id: "cursor-user",
      runtime: "cursor",
      scope: "user",
      layer: "shared",
      format: "cursor",
      label: "用户 · Cursor",
      path: join(homeDir, ".cursor", "hooks.json"),
    },
    {
      id: "codex-user",
      runtime: "codex",
      scope: "user",
      layer: "shared",
      format: "claude",
      label: "用户 · Codex",
      path: join(homeDir, ".codex", "hooks.json"),
    },
    {
      id: "gemini-user",
      runtime: "gemini",
      scope: "user",
      layer: "shared",
      format: "claude",
      label: "用户 · Gemini CLI",
      path: join(homeDir, ".gemini", "settings.json"),
    },
    {
      id: "kimi-user",
      runtime: "kimi",
      scope: "user",
      layer: "shared",
      format: "kimi",
      readonly: true,
      label: "用户 · Kimi Code（只读）",
      path: join(homeDir, ".kimi-code", "config.toml"),
    },
    {
      id: "claude-project",
      runtime: "claude",
      scope: "project",
      layer: "shared",
      format: "claude",
      label: "项目 · Claude Code",
      path: join(repoRoot, ".claude", "settings.json"),
    },
    {
      id: "claude-project-local",
      runtime: "claude",
      scope: "project",
      layer: "local",
      format: "claude",
      label: "项目本地 · Claude Code",
      path: join(repoRoot, ".claude", "settings.local.json"),
    },
    {
      id: "cursor-project",
      runtime: "cursor",
      scope: "project",
      layer: "shared",
      format: "cursor",
      label: "项目 · Cursor",
      path: join(repoRoot, ".cursor", "hooks.json"),
    },
    {
      id: "codex-project",
      runtime: "codex",
      scope: "project",
      layer: "shared",
      format: "claude",
      label: "项目 · Codex",
      path: join(repoRoot, ".codex", "hooks.json"),
    },
  ]);

  function storeById(id) {
    const store = stores.find((item) => item.id === id);
    if (!store) throw hooksError("HOOK_STORE_UNKNOWN", `未知钩子真源：${id}`, 404);
    return store;
  }

  async function readStore(store) {
    try {
      const [text, info] = await Promise.all([io.readFile(store.path, "utf8"), io.stat(store.path)]);
      if (store.format === "kimi") {
        return { ok: true, text, data: { raw: text }, mtimeMs: info.mtimeMs, missing: false };
      }
      const data = JSON.parse(text);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw hooksError("HOOK_STORE_INVALID", `${store.label} 不是对象 JSON`);
      }
      return { ok: true, text, data, mtimeMs: info.mtimeMs, missing: false };
    } catch (error) {
      if (error?.code === "ENOENT") return { ok: true, text: "", data: {}, mtimeMs: 0, missing: true };
      if (error?.code === "HOOK_STORE_INVALID") throw error;
      return { ok: false, error: error.message, missing: false, data: {}, text: "", mtimeMs: 0 };
    }
  }

  function itemsFromStore(store, snapshot) {
    if (store.format === "kimi") return parseKimiHookBlocks(snapshot.text || snapshot.data?.raw || "", store);
    const hooks = snapshot.data?.hooks;
    if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return [];
    if (store.format === "cursor") {
      return Object.entries(hooks).flatMap(([event, entries]) => normalizeCursorHooks(event, entries, store));
    }
    return Object.entries(hooks).flatMap(([event, groups]) => normalizeClaudeGroups(event, groups, store));
  }

  async function list() {
    const snapshots = await Promise.all(stores.map(async (store) => {
      const snapshot = await readStore(store);
      return {
        id: store.id,
        runtime: store.runtime,
        scope: store.scope,
        layer: store.layer,
        label: store.label,
        path: store.path,
        readonly: store.readonly === true,
        readable: snapshot.ok,
        missing: snapshot.missing,
        error: snapshot.ok ? null : snapshot.error,
        mtimeMs: snapshot.mtimeMs,
        items: snapshot.ok ? itemsFromStore(store, snapshot) : [],
      };
    }));
    return {
      events: [...new Set([...CLAUDE_EVENTS, ...GEMINI_EVENTS, ...Object.values(CURSOR_EVENT_TO_CANON)])],
      primaryEvents: [...PRIMARY_HOOK_EVENTS],
      stores: snapshots.map(({ items, ...rest }) => ({ ...rest, count: items.length })),
      items: snapshots.flatMap((entry) => entry.items),
    };
  }

  async function writeStore(store, mutate, { knownMtimeMs = null } = {}) {
    if (store.readonly) throw hooksError("HOOK_STORE_READONLY", `${store.label} 目前只读，不能从这里改 TOML`);
    return serializeMutation(store.path, async () => {
      const snapshot = await readStore(store);
      if (!snapshot.ok) throw hooksError("HOOK_STORE_UNREADABLE", snapshot.error || `${store.label} 无法读取`);
      const known = Number(knownMtimeMs);
      if (knownMtimeMs != null && knownMtimeMs !== "" && Number.isFinite(known) && !snapshot.missing && Math.abs(snapshot.mtimeMs - known) > 1) {
        throw hooksError("STALE_BASE", `${store.label} 已被外部改写，请刷新后重试`);
      }
      const next = snapshot.missing ? {} : { ...snapshot.data };
      const hooks = next.hooks && typeof next.hooks === "object" && !Array.isArray(next.hooks)
        ? { ...next.hooks }
        : {};
      next.hooks = mutate(hooks, snapshot);
      if (store.format === "cursor" && next.version == null) next.version = 1;
      const text = `${JSON.stringify(next, null, 2)}\n`;
      await io.mkdir(dirname(store.path), { recursive: true });
      if (!snapshot.missing && snapshot.text) {
        await io.writeFile(`${store.path}.514cc-backup`, snapshot.text, "utf8");
      }
      const temp = join(dirname(store.path), `.${basename(store.path)}.${process.pid}.${randomUUID()}.tmp`);
      try {
        await io.writeFile(temp, text, "utf8");
        await io.rename(temp, store.path);
      } catch (error) {
        await io.rm(temp, { force: true }).catch(() => {});
        throw error;
      }
      return list();
    });
  }

  function parseId(id) {
    const raw = String(id ?? "");
    const cut = raw.indexOf(":");
    if (cut <= 0) throw hooksError("HOOK_ID_INVALID", "钩子 id 不完整");
    return { storeId: raw.slice(0, cut), digest: raw.slice(cut + 1) };
  }

  function findItem(items, id) {
    const item = items.find((entry) => entry.id === id);
    if (!item) throw hooksError("HOOK_NOT_FOUND", "钩子不存在或已被外部改写", 404);
    return item;
  }

  function addClaudeHook(hooks, { event, matcher, hook }) {
    const groups = Array.isArray(hooks[event]) ? [...hooks[event]] : [];
    const match = String(matcher ?? "");
    const existing = groups.findIndex((group) => String(group?.matcher ?? "") === match);
    if (existing >= 0) {
      const group = { ...groups[existing], hooks: [...(groups[existing].hooks ?? []), hook] };
      groups[existing] = group;
    } else {
      groups.push({ matcher: match, hooks: [hook] });
    }
    hooks[event] = groups;
    return hooks;
  }

  function removeClaudeHook(hooks, item) {
    const groups = Array.isArray(hooks[item.event]) ? hooks[item.event] : [];
    const nextGroups = [];
    let removed = false;
    for (const group of groups) {
      const matcher = String(group?.matcher ?? "");
      const nextHooks = (Array.isArray(group?.hooks) ? group.hooks : []).filter((hook) => {
        const type = hookType(hook);
        const command = type === "http" ? "" : String(hook.command ?? hook.prompt ?? "");
        const url = type === "http" ? String(hook.url ?? "") : "";
        const same = hookFingerprint({ event: item.event, matcher, type, command, url }) === item.fingerprint;
        if (same) removed = true;
        return !same;
      });
      if (nextHooks.length) nextGroups.push({ ...group, hooks: nextHooks });
    }
    if (!removed) throw hooksError("HOOK_NOT_FOUND", "钩子不存在或已被外部改写", 404);
    if (nextGroups.length) hooks[item.event] = nextGroups;
    else delete hooks[item.event];
    return hooks;
  }

  function addCursorHook(hooks, { event, matcher, hook }) {
    const key = CANON_TO_CURSOR[event];
    if (!key) throw hooksError("HOOK_EVENT_UNSUPPORTED", `Cursor 不支持事件 ${event}`);
    const entry = { command: hook.command, timeout: hook.timeout };
    if (matcher) entry.matcher = String(matcher);
    hooks[key] = [...(Array.isArray(hooks[key]) ? hooks[key] : []), entry];
    return hooks;
  }

  function removeCursorHook(hooks, item) {
    const key = CANON_TO_CURSOR[item.event];
    if (!key) return hooks;
    const current = Array.isArray(hooks[key]) ? hooks[key] : [];
    const next = current.filter((hook) => String(hook?.command ?? "") !== item.command);
    if (next.length === current.length) throw hooksError("HOOK_NOT_FOUND", "钩子不存在或已被外部改写", 404);
    if (next.length) hooks[key] = next;
    else delete hooks[key];
    return hooks;
  }

  function buildHookPayload(input) {
    const type = input.type === "http" || input.runMode === "http" ? "http" : "command";
    const timeoutRaw = Number(input.timeout);
    const timeout = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_HOOK_TIMEOUT;
    const custom = sanitizeCustom(parseCustom(input));
    if (type === "http") {
      const url = String(input.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) throw hooksError("VALIDATION_FAILED", "HTTP 钩子需要 http(s) URL");
      return { ...custom, type: "http", url, timeout };
    }
    const command = splitCommandArgs(input.command, input.argv);
    if (!command) throw hooksError("VALIDATION_FAILED", "进程钩子需要命令");
    const hook = { ...custom, type: "command", command, timeout };
    if (input.async === true) hook.async = true;
    const shell = input.runMode === "shell" ? String(input.shell || "powershell") : String(input.shell || "");
    if (shell) hook.shell = shell;
    if (input.statusMessage) hook.statusMessage = String(input.statusMessage);
    return hook;
  }

  async function create(input = {}) {
    const store = storeById(input.store || resolveHookStoreId(input));
    const event = String(input.event ?? "").trim();
    if (!eventsForStore(store).includes(event)) throw hooksError("VALIDATION_FAILED", `未知钩子事件：${event}`);
    const hook = buildHookPayload(input);
    const matcher = String(input.matcher ?? "");
    return writeStore(store, (hooks) => {
      if (store.format === "cursor") return addCursorHook(hooks, { event, matcher, hook });
      return addClaudeHook(hooks, { event, matcher, hook });
    }, { knownMtimeMs: input.knownMtimeMs });
  }

  async function update(id, input = {}) {
    const listed = await list();
    const current = findItem(listed.items, id);
    if (current.protected && input.confirmProtected !== true && (input.command || input.argv || input.url)) {
      throw hooksError("HOOK_PROTECTED", "治理钩子改命令需要 confirmProtected", 409);
    }
    const store = storeById(current.store);
    const next = {
      ...current,
      event: input.event ?? current.event,
      matcher: input.matcher ?? current.matcher,
      type: input.type ?? current.type,
      runMode: input.runMode,
      command: input.command ?? current.command,
      argv: input.argv,
      url: input.url ?? current.url,
      timeout: input.timeout ?? current.timeout,
      async: input.async ?? current.async,
      shell: input.shell ?? current.shell,
      statusMessage: input.statusMessage ?? current.statusMessage,
      custom: input.custom ?? current.custom,
      customJson: input.customJson,
    };
    const hook = buildHookPayload(next);
    return writeStore(store, (hooks) => {
      if (store.format === "cursor") {
        removeCursorHook(hooks, current);
        return addCursorHook(hooks, { event: next.event, matcher: next.matcher, hook });
      }
      removeClaudeHook(hooks, current);
      return addClaudeHook(hooks, { event: next.event, matcher: next.matcher, hook });
    }, { knownMtimeMs: input.knownMtimeMs });
  }

  async function remove(id, { confirmProtected = false, knownMtimeMs = null } = {}) {
    const listed = await list();
    const current = findItem(listed.items, id);
    if (current.protected && confirmProtected !== true) {
      throw hooksError("HOOK_PROTECTED", "删除治理钩子（route/stop/mirror-gate）需要确认", 409);
    }
    const store = storeById(current.store);
    return writeStore(store, (hooks) => (
      store.format === "cursor" ? removeCursorHook(hooks, current) : removeClaudeHook(hooks, current)
    ), { knownMtimeMs });
  }

  return { list, create, update, remove, stores, parseId };
}
