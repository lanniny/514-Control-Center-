/**
 * ssh/remote-graph.mjs — 远程三面图谱（v41 波五）：供应商实况 / Agent·Skill·MCP 清单 / 运行席位与真源。
 *
 * 只消费 createSshService 公开方法（exec/update/sftpRead/sftpReadRaw），与 remote-ops 同纪律：
 *   - 目录清单+真源 stat 一条 shell 脚本跑完（禁 N 并发 channel——health.mjs 探针风暴教训）
 *   - 配置文件经服务端专用 sftpReadRaw 读取：围栏（assertSftpPath）+ 1MB cap 在 ssh.mjs 层；
 *     原文只用于严格识别 ProviderStore marker 与浅提取，不进入 HTTP 返回
 *   - 供应商字段只取 model/base_url/wire_api/provider/providerId 等非敏感项，
 *     key/token/secret 类键名永不进入提取清单，返回值再过 scrub/findSecretCandidates 兜底
 *   - 真源查看只认 GRAPH_SOURCE_FILES 表内 id（不接任意路径），原文在返回前显式 scrub
 */

import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";
import JSON5 from "json5";
import { parse as parseYaml } from "yaml";
import { findSecretCandidates, scrub } from "../redaction.mjs";
import { sanitizeRemotePath } from "../remote-projects.mjs";
import { reconcileRemoteTransaction } from "./remote-config.mjs";

const GRAPH_TIMEOUT_MS = 30_000;

const MANAGED_PROVIDER_MARKER_BY_CLI = Object.freeze({
  codex: "514-forge-provider",
  gemini: "514-forge-provider",
  kimi: "514-forge-provider",
  grokbuild: "514-forge-grokbuild-provider",
});
const MANAGED_PROVIDER_ID_MAX = 200;

/** 供应商实况提取目标：per-CLI live 配置文件（remote 为 $HOME 相对路径）。 */
const GRAPH_CONFIG_FILES = Object.freeze([
  { id: "claude-settings", cli: "claude", label: "Claude settings.json", remote: ".claude/settings.json", kind: "json" },
  { id: "claude-global", cli: "claude", label: "Claude ~/.claude.json", remote: ".claude.json", kind: "json" },
  { id: "codex-config", cli: "codex", label: "Codex config.toml", remote: ".codex/config.toml", kind: "toml" },
  { id: "gemini-env", cli: "gemini", label: "Gemini .env", remote: ".gemini/.env", kind: "env", contentPolicy: "hidden" },
  { id: "grok-config", cli: "grokbuild", label: "Grok config.toml", remote: ".grok/config.toml", kind: "toml" },
  { id: "kimi-config", cli: "kimi", label: "Kimi config.toml", remote: ".kimi-code/config.toml", kind: "toml" },
  { id: "opencode-config", cli: "opencode", label: "OpenCode opencode.json", remote: ".config/opencode/opencode.json", kind: "json5" },
  { id: "openclaw-config", cli: "openclaw", label: "OpenClaw openclaw.json", remote: ".openclaw/openclaw.json", kind: "json5" },
  { id: "hermes-config", cli: "hermes", label: "Hermes config.yaml", remote: ".hermes/config.yaml", kind: "yaml" },
]);

/** 真源查看清单 = 配置文件 + 指令文档（只认表内 id，不接任意路径）。 */
const GRAPH_SOURCE_FILES = Object.freeze([
  ...GRAPH_CONFIG_FILES.map((entry) => ({ id: entry.id, cli: entry.cli, label: entry.label, remote: entry.remote })),
  { id: "codex-auth", cli: "codex", label: "Codex auth.json", remote: ".codex/auth.json", contentPolicy: "hidden" },
  { id: "gemini-settings", cli: "gemini", label: "Gemini settings.json", remote: ".gemini/settings.json" },
  { id: "codex-agents", cli: "codex", label: "Codex AGENTS.md", remote: ".codex/AGENTS.md", editable: true },
  { id: "claude-memory", cli: "claude", label: "Claude CLAUDE.md", remote: ".claude/CLAUDE.md", editable: true },
]);

/** 项目目标追加的配置覆盖与真源；remote 在实例化时解析为项目目录下绝对路径。 */
const PROJECT_CONFIG_FILES = Object.freeze([
  { id: "project-claude-settings", cli: "claude", label: "项目 Claude settings.json", remote: ".claude/settings.json", kind: "json" },
  { id: "project-claude-local-settings", cli: "claude", label: "项目 Claude settings.local.json", remote: ".claude/settings.local.json", kind: "json" },
  { id: "project-codex-config", cli: "codex", label: "项目 Codex config.toml", remote: ".codex/config.toml", kind: "toml" },
]);

const PROJECT_SOURCE_FILES = Object.freeze([
  ...PROJECT_CONFIG_FILES,
  { id: "project-mcp", cli: "shared", label: "项目 MCP 配置", remote: ".mcp.json", kind: "json", mcpOnly: true },
  { id: "project-agents", cli: "codex", label: "项目 AGENTS.md", remote: "AGENTS.md", editable: true },
  { id: "project-claude", cli: "claude", label: "项目 CLAUDE.md", remote: "CLAUDE.md", editable: true },
  { id: "project-rules", cli: "shared", label: "项目 rules.md", remote: "rules.md", editable: true },
  { id: "project-context", cli: "shared", label: "项目 context.md", remote: ".ai-shared/context.md", editable: true },
  { id: "project-decisions", cli: "shared", label: "项目 decisions.md", remote: ".ai-shared/decisions.md", editable: true },
  { id: "project-module", cli: "shared", label: "项目 module.yaml", remote: "module.yaml" },
]);

/** 能力清单扫描目录：kind 归入前端分组；exts 过滤 null=全收（目录即条目）。 */
const CAP_DIRS = Object.freeze([
  { kind: "agent", cli: "claude", dir: ".claude/agents" },
  { kind: "skill", cli: "claude", dir: ".claude/skills" },
  { kind: "command", cli: "claude", dir: ".claude/commands" },
  { kind: "agent", cli: "codex", dir: ".codex/agents" },
  { kind: "skill", cli: "codex", dir: ".codex/skills" },
  { kind: "prompt", cli: "codex", dir: ".codex/prompts" },
  { kind: "skill", cli: "kimi", dir: ".agents/skills" },
]);

const PROJECT_CAP_DIRS = Object.freeze(CAP_DIRS.map((entry) => ({ ...entry, scope: "project" })));

function remoteGraphError(code, message, httpStatus = 400) {
  return Object.assign(new Error(message), { code, httpStatus });
}

/** POSIX 单引号包裹（remote-ops 同款：远端 shell 拼路径唯一合法形态）。 */
function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sha256Shell(path, variable = "actual") {
  return `${variable}=$(if command -v sha256sum >/dev/null 2>&1; then sha256sum ${shQuote(path)} | awk '{print $1}'; elif command -v shasum >/dev/null 2>&1; then shasum -a 256 ${shQuote(path)} | awk '{print $1}'; else exit 75; fi)`;
}

function lockFor(remote, home) {
  const root = joinPosix(home, ".514forge-locks");
  const path = joinPosix(root, createHash("sha256").update(remote).digest("hex"));
  return {
    root,
    path,
    owner: `${path}/owner`,
    target: `${path}/target`,
    base: `${path}/base`,
    published: `${path}/published`,
    backupMetadata: `${path}/backup`,
    tempMetadata: `${path}/temp`,
    kind: `${path}/kind`,
    scope: `${path}/scope`,
    changed: `${path}/changed`,
    status: `${path}/status`,
  };
}

function acquireLockShell(lock, transactionId, transactionState, record) {
  const transactionTrap = `rc=$?; trap - 0; printf '%s:%s\\n' 'acquire' "$rc" > ${shQuote(transactionState)}; exit "$rc"`;
  const metadataEntries = [
    [lock.target, record.remote],
    [lock.base, record.baseDigest],
    [lock.published, record.publishedDigest],
    [lock.backupMetadata, record.backup ?? ""],
    [lock.tempMetadata, record.temp],
    [lock.kind, "graph"],
    [lock.scope, record.scope ?? ""],
    [lock.changed, "yes"],
    [lock.status, "prepared"],
    [lock.owner, transactionId],
  ];
  const metadata = metadataEntries.map(([path, value]) => `printf '%s\\n' ${shQuote(value)} > ${shQuote(path)}`).join(" && ");
  const cleanup = `rm -f -- ${metadataEntries.map(([path]) => shQuote(path)).join(" ")} && rmdir -- ${shQuote(lock.path)}`;
  return [
    "set -u",
    "umask 077",
    `printf '%s\\n' 'acquire:running' > ${shQuote(transactionState)}`,
    `trap ${shQuote(transactionTrap)} 0`,
    `if mkdir -- ${shQuote(lock.path)}; then :; elif test -d ${shQuote(lock.path)}; then exit 72; else exit 79; fi`,
    `if ! { ${metadata}; }; then ${cleanup} 2>/dev/null || exit 82; exit 79; fi`,
  ].join("; ");
}

function releaseLockShell(lock, transactionId, transactionState = null) {
  const metadata = [lock.target, lock.base, lock.published, lock.backupMetadata, lock.tempMetadata, lock.kind, lock.scope, lock.changed, lock.status, lock.owner];
  const cleanupState = transactionState ? ` && rm -f -- ${shQuote(transactionState)}` : "";
  return `set -u; test "$(cat ${shQuote(lock.owner)} 2>/dev/null || true)" = ${shQuote(transactionId)} && rm -f -- ${metadata.map(shQuote).join(" ")} && rmdir -- ${shQuote(lock.path)}${cleanupState} || exit 81`;
}

function statusWrappedShell(command, lock, phase) {
  const trapBody = `rc=$?; trap - 0; printf '%s:%s\\n' ${shQuote(phase)} "$rc" > ${shQuote(lock.status)}; exit "$rc"`;
  return `printf '%s\\n' ${shQuote(`${phase}:running`)} > ${shQuote(lock.status)}; trap ${shQuote(trapBody)} 0; ${command}`;
}

function graphRecoveryError(code, message, transactionId, { remote, lock, applied = [], uncertain = [] }, httpStatus = 409) {
  const backups = new Map();
  for (const entry of [...applied, ...uncertain]) {
    if (entry.backup) backups.set(entry.backup, { remote: entry.remote, backup: entry.backup });
  }
  return Object.assign(remoteGraphError(code, message, httpStatus), {
    recoveryRequired: true,
    retryable: false,
    transactionId,
    recovery: { kind: "graph", transactionId },
    applied,
    uncertain,
    backups: [...backups.values()],
    locks: [lock.path],
  });
}

function joinPosix(base, relative) {
  return base === "/" ? `/${relative}` : `${base}/${relative}`;
}

async function projectPathOf(ssh, hostId, value) {
  if (value == null) return null;
  const normalized = sanitizeRemotePath(value).replace(/\/+$/, "") || "/";
  // inventory 走 shell 而非 SFTP，本地词法围栏后必须先用 SFTP realpath 固化同一 canonical 边界。
  ssh.assertSftpPathPublic?.(hostId, normalized);
  return await ssh.assertSftpResolvedPathPublic?.(hostId, normalized) ?? normalized;
}

function projectFiles(projectPath) {
  if (!projectPath) return [];
  return PROJECT_SOURCE_FILES.map((file) => ({
    ...file,
    scope: "project",
    projectRelative: file.remote,
    remote: joinPosix(projectPath, file.remote),
  }));
}

function projectConfigs(projectPath) {
  if (!projectPath) return [];
  const byId = new Map(projectFiles(projectPath).map((file) => [file.id, file]));
  return PROJECT_CONFIG_FILES.map((file) => byId.get(file.id));
}

function sourcePath(file, home) {
  return file.scope === "project" ? file.remote : joinPosix(home, file.remote);
}

async function canonicalTargetPath(ssh, hostId, remote) {
  const parent = posix.dirname(remote);
  const canonicalParent = await ssh.assertSftpResolvedPathPublic?.(hostId, parent, { allowMissing: true }) ?? parent;
  return joinPosix(canonicalParent, posix.basename(remote));
}

/**
 * 发布备份路径：客户端只提交备份文件名，路径一律由服务端在真源的 canonical 父目录下拼装。
 * 名字必须严格是「该真源 canonical basename + .514forge-backup-<token>」，token 形状与
 * inventory 的识别口径一致（parseInventory 的 `[\w-]+`），因此 UI 能列出的备份都能读；
 * `[\w-]` 不含分隔符与点，穿越与同名伪造在词法层就不可能。
 */
const BACKUP_TOKEN = /^[\w-]{1,64}$/;

function backupRemotePath(remote, backupName) {
  const name = String(backupName ?? "");
  const prefix = `${posix.basename(remote)}.514forge-backup-`;
  if (!name.startsWith(prefix) || !BACKUP_TOKEN.test(name.slice(prefix.length))) {
    throw remoteGraphError("GRAPH_BACKUP_UNKNOWN", "backup name does not belong to this remote source", 400);
  }
  return joinPosix(posix.dirname(remote), name);
}

function capabilityPath(cap, home, projectPath) {
  return cap.scope === "project" ? joinPosix(projectPath, cap.dir) : joinPosix(home, cap.dir);
}

/** 清单脚本：远端可控文件名先 base64，避免换行/竖线伪造协议行。 */
function inventoryScript(home, { projectPath = null, sourceFiles = GRAPH_SOURCE_FILES } = {}) {
  const capDirs = projectPath ? [...CAP_DIRS, ...PROJECT_CAP_DIRS] : CAP_DIRS;
  const caps = capDirs.map((cap) => {
    const dir = capabilityPath(cap, home, projectPath);
    const prefix = cap.scope === "project" ? "CAP64|project" : "CAP64";
    return `if [ -d ${shQuote(dir)} ]; then for f in ${shQuote(dir)}/*; do [ -e "$f" ] || continue; n=$(printf %s "\${f##*/}" | base64 | tr -d '\\n'); printf '${prefix}|${cap.kind}|${cap.cli}|%s\\n' "$n"; done; fi`;
  });
  const stats = sourceFiles.map((file) => `p=${shQuote(sourcePath(file, home))}; if [ -f "$p" ]; then s=$(wc -c <"$p" 2>/dev/null | tr -d ' '); m=$(stat -c %Y "$p" 2>/dev/null || stat -f %m "$p" 2>/dev/null); echo "SRC|${file.id}|yes|$s|$m"; else echo "SRC|${file.id}|no||"; fi; for b in "$p".514forge-backup-*; do [ -f "$b" ] || continue; s=$(wc -c <"$b" 2>/dev/null | tr -d ' '); m=$(stat -c %Y "$b" 2>/dev/null || stat -f %m "$b" 2>/dev/null); n=$(printf %s "\${b##*/}" | base64 | tr -d '\\n'); printf 'BAK64|${file.id}|%s|%s|%s\\n' "$n" "$s" "$m"; done`);
  return [
    "command -v base64 >/dev/null 2>&1 || { printf 'base64 is required for remote inventory\\n' >&2; exit 79; }",
    ...caps,
    ...stats,
  ].join("; ");
}

function decodeInventoryName(value) {
  const encoded = String(value ?? "");
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64") !== encoded) return null;
  return decoded.toString("utf8");
}

/** 解析清单输出（行协议；未知 kind/id 忽略，与前波 parseProbeOutput 同纪律）。 */
export function parseInventory(stdout, sourceFiles = GRAPH_SOURCE_FILES) {
  const capabilities = [];
  const sources = [];
  const backups = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (line.startsWith("CAP64|")) {
      const parts = line.split("|");
      const projectScoped = parts[1] === "project";
      const [, kind, cli, encodedName] = projectScoped ? parts.slice(1) : parts;
      const name = decodeInventoryName(encodedName);
      if (!kind || !cli || !name) continue;
      if (!CAP_DIRS.some((cap) => cap.kind === kind && cap.cli === cli)) continue;
      capabilities.push({ kind, cli, name, ...(projectScoped ? { scope: "project" } : {}) });
    } else if (line.startsWith("SRC|")) {
      const [, id, yes, size, mtime] = line.split("|");
      const file = sourceFiles.find((entry) => entry.id === id);
      if (!file) continue;
      sources.push({
        id: file.id,
        cli: file.cli,
        label: file.label,
        remote: file.remote,
        ...(file.scope === "project" ? { scope: "project", projectRelative: file.projectRelative } : {}),
        editable: file.editable === true,
        exists: yes === "yes",
        size: yes === "yes" ? Number(size) || 0 : 0,
        mtime: yes === "yes" && Number(mtime) ? new Date(Number(mtime) * 1000).toISOString() : null,
      });
    } else if (line.startsWith("BAK64|")) {
      const [, sourceId, encodedName, size, mtime] = line.split("|");
      const name = decodeInventoryName(encodedName);
      if (!sourceFiles.some((entry) => entry.id === sourceId) || !/^.+\.514forge-backup-[\w-]+$/.test(name ?? "")) continue;
      backups.push({ sourceId, name, size: Number(size) || 0, mtime: Number(mtime) ? new Date(Number(mtime) * 1000).toISOString() : null });
    }
  }
  return { capabilities, sources, backups };
}

/** toml 顶层键浅提取：只认 section 外的 model/base_url/wire_api/model_provider；[mcp_servers.x] 段名另出。 */
export function extractTomlProvider(content) {
  const fields = { model: null, baseUrl: null, wireApi: null, provider: null };
  const mcpNames = [];
  let section = "";
  for (const rawLine of String(content ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]/);
    if (sectionMatch) {
      section = sectionMatch[1];
      const mcpMatch = section.match(/^mcp_servers\.(.+)$/);
      if (mcpMatch) mcpNames.push(mcpMatch[1].replace(/^"|"$/g, ""));
      continue;
    }
    const kv = line.match(/^(model|default_model|base_url|wire_api|model_provider|provider)\s*=\s*"?([^"#]+?)"?\s*(?:#.*)?$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (!section) {
      if (key === "model" || key === "default_model") fields.model = value;
      else if (key === "base_url") fields.baseUrl = value;
      else if (key === "wire_api") fields.wireApi = value;
      else if (key === "model_provider" || key === "provider") fields.provider = value;
    } else if (/^(?:model_providers|model|providers)\./.test(section)) {
      if (key === "model") fields.model = fields.model ?? value;
      else if (key === "base_url") fields.baseUrl = fields.baseUrl ?? value;
      else if (key === "wire_api") fields.wireApi = fields.wireApi ?? value;
      else if (key === "provider") fields.provider = fields.provider ?? value;
    } else if (/^models\./.test(section)) {
      if (key === "model") fields.model = fields.model ?? value;
      else if (key === "provider") fields.provider = fields.provider ?? value;
    }
  }
  return { fields, mcpNames };
}

/** json 一层键浅提取：model / env.*_BASE_URL；mcpServers 键名另出。key/token 类永不提取。 */
export function extractJsonProvider(content) {
  const fields = { model: null, baseUrl: null, wireApi: null, provider: null };
  const mcpNames = [];
  let parsed = null;
  try {
    parsed = JSON5.parse(String(content ?? ""));
  } catch {
    return { fields, mcpNames }; // 坏 json 如实全空（浅提取不猜）
  }
  if (!parsed || typeof parsed !== "object") return { fields, mcpNames };
  if (typeof parsed.model === "string") fields.model = parsed.model;
  const env = parsed.env && typeof parsed.env === "object" ? parsed.env : {};
  for (const [key, value] of Object.entries(env)) {
    if (/(_BASE_URL|_API_URL|_ENDPOINT)$/i.test(key) && typeof value === "string") fields.baseUrl = fields.baseUrl ?? value;
  }
  if (parsed.mcpServers && typeof parsed.mcpServers === "object") mcpNames.push(...Object.keys(parsed.mcpServers));
  if (parsed.provider && typeof parsed.provider === "object") {
    const providerKey = typeof parsed.model === "string" ? parsed.model.split("/")[0] : Object.keys(parsed.provider)[0];
    const settings = parsed.provider[providerKey] ?? Object.values(parsed.provider)[0];
    if (settings && typeof settings === "object") {
      fields.provider = providerKey ?? null;
      fields.baseUrl = settings.options?.baseURL ?? settings.options?.baseUrl ?? settings.baseUrl ?? fields.baseUrl;
    }
  }
  if (parsed.models?.providers && typeof parsed.models.providers === "object") {
    const [providerKey, settings] = Object.entries(parsed.models.providers).at(-1) ?? [];
    if (settings && typeof settings === "object") {
      fields.provider = providerKey ?? fields.provider;
      fields.baseUrl = settings.baseUrl ?? settings.baseURL ?? fields.baseUrl;
    }
  }
  return { fields, mcpNames };
}

export function extractEnvProvider(content) {
  const fields = { model: null, baseUrl: null, wireApi: null, provider: null };
  for (const rawLine of String(content ?? "").split(/\r?\n/)) {
    const match = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].replace(/^['"]|['"]$/g, "");
    if (/(_BASE_URL|_API_URL|_ENDPOINT)$/i.test(key)) fields.baseUrl = fields.baseUrl ?? value;
    else if (/(?:^|_)MODEL$/i.test(key)) fields.model = fields.model ?? value;
  }
  return { fields, mcpNames: [] };
}

export function extractYamlProvider(content) {
  const fields = { model: null, baseUrl: null, wireApi: null, provider: null };
  let parsed;
  try {
    parsed = parseYaml(String(content ?? ""));
  } catch {
    return { fields, mcpNames: [] };
  }
  if (!parsed || typeof parsed !== "object") return { fields, mcpNames: [] };
  const providerName = parsed.model?.provider;
  const providers = Array.isArray(parsed.custom_providers) ? parsed.custom_providers : [];
  const selected = providers.find((entry) => entry?.name === providerName) ?? providers.at(-1);
  if (selected && typeof selected === "object") {
    fields.provider = selected.name ?? providerName ?? null;
    fields.baseUrl = selected.base_url ?? selected.baseUrl ?? null;
    fields.model = parsed.model?.default ?? selected.model ?? selected.models?.[0]?.id ?? null;
  }
  return { fields, mcpNames: [] };
}

/**
 * ProviderStore 的稳定身份只来自它写入的、完整且唯一的成对 marker。
 * endpoint/provider/model 等普通配置字段均不具备档案身份语义，不能在这里兜底认亲。
 */
export function extractManagedProviderId(content, cli) {
  const marker = MANAGED_PROVIDER_MARKER_BY_CLI[String(cli ?? "")];
  if (!marker) return null;
  const beginPrefix = `# >>> ${marker} (`;
  const beginSuffix = ") >>>";
  const end = `# <<< ${marker} <<<`;
  let openId = null;
  let resolvedId = null;

  for (const line of String(content ?? "").split(/\r?\n/)) {
    if (line.startsWith(beginPrefix) && line.endsWith(beginSuffix)) {
      const providerId = line.slice(beginPrefix.length, -beginSuffix.length);
      const safeId = providerId
        && providerId === providerId.trim()
        && providerId.length <= MANAGED_PROVIDER_ID_MAX
        && !/[\u0000-\u001f\u007f()]/.test(providerId)
        && scrub(providerId) === providerId
        && findSecretCandidates(providerId).length === 0;
      if (!safeId || openId !== null || resolvedId !== null) return null;
      openId = providerId;
      continue;
    }
    if (line === end) {
      if (openId === null || resolvedId !== null) return null;
      resolvedId = openId;
      openId = null;
      continue;
    }
    // 看起来像同类 marker 却不符合 ProviderStore 的精确行格式：整份身份判为不可信。
    if (line.startsWith(`# >>> ${marker}`) || line.startsWith(`# <<< ${marker}`)) return null;
  }
  return openId === null ? resolvedId : null;
}

function extractProvider(file, content) {
  if (file.kind === "toml") return extractTomlProvider(content);
  if (file.kind === "env") return extractEnvProvider(content);
  if (file.kind === "yaml") return extractYamlProvider(content);
  return extractJsonProvider(content);
}

/** 提取值防御脱敏：含疑似秘密字面量一律打码（model/base_url 不该有，有就不可信）。 */
function safeField(value) {
  if (value == null) return null;
  const text = String(value);
  const redacted = scrub(text);
  if (redacted !== text) return redacted.slice(0, 200);
  if (findSecretCandidates(text).length) return "[REDACTED]";
  return text.slice(0, 200);
}

export function createRemoteGraph(ssh) {
  async function resolveHome(hostId) {
    const result = await ssh.exec(hostId, { command: 'printf %s "$HOME"', timeoutMs: 10_000 });
    const home = String(result.stdout ?? "").trim();
    if (!home.startsWith("/")) throw remoteGraphError("GRAPH_HOME_UNKNOWN", "cannot resolve remote $HOME", 502);
    await ssh.update(hostId, { home }).catch(() => {}); // 回写台账，SFTP 围栏认这个家
    return await ssh.assertSftpResolvedPathPublic?.(hostId, home) ?? home;
  }

  async function graph(hostId, { projectPath: requestedProjectPath = null } = {}) {
    const home = await resolveHome(hostId);
    const projectPath = await projectPathOf(ssh, hostId, requestedProjectPath);
    const sourceFiles = [...GRAPH_SOURCE_FILES, ...projectFiles(projectPath)];
    const configFiles = [...GRAPH_CONFIG_FILES, ...projectConfigs(projectPath)];
    const inventory = await ssh.exec(hostId, { command: inventoryScript(home, { projectPath, sourceFiles }), timeoutMs: GRAPH_TIMEOUT_MS });
    if (inventory.code !== 0) {
      throw remoteGraphError("REMOTE_GRAPH_FAILED", `inventory exited ${inventory.code}: ${(inventory.stderr || "").slice(0, 200)}`, 502);
    }
    const { capabilities, sources, backups: inventoryBackups } = parseInventory(inventory.stdout, sourceFiles);
    const providers = [];
    const mcp = [];
    for (const file of configFiles) {
      const stat = sources.find((entry) => entry.id === file.id);
      const row = {
        sourceId: file.id,
        cli: file.cli,
        label: file.label,
        file: file.scope === "project" ? file.projectRelative : file.remote,
        scope: file.scope ?? "host",
        exists: stat?.exists === true,
        model: null,
        baseUrl: null,
        wireApi: null,
        provider: null,
        providerId: null,
      };
      if (row.exists) {
        try {
          const rawReader = typeof ssh.sftpReadRaw === "function" ? ssh.sftpReadRaw.bind(ssh) : null;
          const { content } = rawReader
            ? await rawReader(hostId, sourcePath(file, home))
            : await ssh.sftpRead(hostId, sourcePath(file, home));
          const parsed = extractProvider(file, content);
          row.model = safeField(parsed.fields.model);
          row.baseUrl = safeField(parsed.fields.baseUrl);
          row.wireApi = safeField(parsed.fields.wireApi);
          row.provider = safeField(parsed.fields.provider);
          // scrubbed fallback 可维持旧图谱字段，但不能据此声明稳定档案身份。
          row.providerId = rawReader ? extractManagedProviderId(content, file.cli) : null;
          for (const name of parsed.mcpNames) mcp.push({
            cli: file.cli,
            name: safeField(name) ?? String(name),
            source: file.scope === "project" ? file.projectRelative : file.remote,
            scope: file.scope ?? "host",
          });
        } catch { /* 读失败如实留 exists:true 但字段全空——不猜不编 */ }
      }
      providers.push(row);
    }
    if (projectPath) {
      const projectMcp = sourceFiles.find((file) => file.id === "project-mcp");
      const stat = projectMcp ? sources.find((entry) => entry.id === projectMcp.id) : null;
      if (stat?.exists) {
        try {
          const { content } = await ssh.sftpRead(hostId, projectMcp.remote);
          for (const name of extractJsonProvider(content).mcpNames) {
            mcp.push({ cli: "shared", name: safeField(name) ?? String(name), source: projectMcp.projectRelative, scope: "project" });
          }
        } catch { /* 项目 MCP 文件读失败时不猜测。 */ }
      }
    }
    const backups = inventoryBackups.map((entry) => {
      const source = sourceFiles.find((file) => file.id === entry.sourceId);
      const sourceRemote = sourcePath(source, home);
      return { ...entry, remote: joinPosix(posix.dirname(sourceRemote), entry.name), scope: source.scope ?? "host" };
    });
    return { home, project: projectPath ? { path: projectPath } : null, providers, capabilities, mcp, sources, backups };
  }

  /** 真源查看：只读 raw 一次；同一字节串派生 digest/sensitive/scrub，避免跨版本组合。 */
  async function readSource(hostId, fileId, { projectPath: requestedProjectPath = null } = {}) {
    const home = await resolveHome(hostId);
    const projectPath = await projectPathOf(ssh, hostId, requestedProjectPath);
    const file = [...GRAPH_SOURCE_FILES, ...projectFiles(projectPath)].find((entry) => entry.id === String(fileId ?? ""));
    if (!file) throw remoteGraphError("GRAPH_SOURCE_UNKNOWN", `unknown graph source: ${fileId}`, 400);
    const requestedRemote = sourcePath(file, home);
    const remote = await canonicalTargetPath(ssh, hostId, requestedRemote);
    try {
      if (!ssh.sftpReadRaw) throw remoteGraphError("GRAPH_SOURCE_RAW_UNAVAILABLE", "raw SFTP reader is unavailable", 503);
      const raw = await ssh.sftpReadRaw(hostId, remote);
      const contentHidden = file.contentPolicy === "hidden";
      const sensitive = contentHidden || findSecretCandidates(raw.content).length > 0;
      const content = contentHidden ? "" : scrub(raw.content);
      // 编辑器只在「返回内容 === 远端原文」时开放（差异预览的基线同样依赖这一条）：
      // scrub 的赋值脱敏没有 findSecretCandidates 的 12 字符门槛（redaction.mjs:166 vs :230），
      // 短值秘密会被改写却不判敏——照旧放开编辑，保存就把 [REDACTED] 写回真源。
      const redacted = !contentHidden && content !== raw.content;
      return {
        id: file.id,
        cli: file.cli,
        label: file.label,
        remote,
        exists: true,
        content,
        contentHidden,
        truncated: raw.truncated === true,
        digest: contentHidden ? null : createHash("sha256").update(raw.content).digest("hex"),
        editable: file.editable === true && !sensitive && !redacted && raw.truncated !== true,
        sensitive,
        redacted,
      };
    } catch (error) {
      if (error?.code === "SFTP_FAILED") {
        return { id: file.id, cli: file.cli, label: file.label, remote, exists: false, content: "", truncated: false, digest: "missing", editable: file.editable === true, sensitive: false, redacted: false };
      }
      throw error;
    }
  }

  async function writeSource(hostId, fileId, content, expectedDigest, options = {}) {
    const requestedProjectPath = options.projectPath ?? null;
    const home = await resolveHome(hostId);
    const projectPath = await projectPathOf(ssh, hostId, requestedProjectPath);
    const file = [...GRAPH_SOURCE_FILES, ...projectFiles(projectPath)].find((entry) => entry.id === String(fileId ?? ""));
    if (!file) throw remoteGraphError("GRAPH_SOURCE_UNKNOWN", `unknown graph source: ${fileId}`, 400);
    if (file.editable !== true) throw remoteGraphError("GRAPH_SOURCE_READ_ONLY", `remote source is read-only: ${file.id}`, 403);
    if (typeof content !== "string" || Buffer.byteLength(content) > 1024 * 1024 || content.includes("\0")) {
      throw remoteGraphError("GRAPH_SOURCE_INVALID", "remote source content must be UTF-8 text up to 1MB", 400);
    }
    if (findSecretCandidates(content).length) {
      throw remoteGraphError("GRAPH_SOURCE_SENSITIVE", "credential material cannot be written through the remote source editor", 403);
    }
    const requestedRemote = sourcePath(file, home);
    ssh.assertSftpPathPublic?.(hostId, requestedRemote);
    const remote = await canonicalTargetPath(ssh, hostId, requestedRemote);
    let current = null;
    try {
      current = await ssh.sftpReadRaw(hostId, remote);
    } catch (error) {
      if (error?.code !== "SFTP_FAILED") throw error;
    }
    const currentDigest = current ? createHash("sha256").update(current.content).digest("hex") : "missing";
    if (String(expectedDigest ?? "") !== currentDigest) {
      throw remoteGraphError("GRAPH_SOURCE_CONFLICT", "remote source changed since it was opened", 409);
    }
    if (current && findSecretCandidates(current.content).length) {
      throw remoteGraphError("GRAPH_SOURCE_SENSITIVE", "remote source contains credential material and is read-only", 403);
    }
    const transactionId = options.transactionId ?? randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(transactionId)) {
      throw remoteGraphError("REMOTE_RECOVERY_TRANSACTION_INVALID", "a valid transactionId is required", 400);
    }
    const publishedDigest = createHash("sha256").update(content).digest("hex");
    const parent = posix.dirname(remote);
    const temp = `${remote}.514forge-${transactionId}.tmp`;
    const backup = current ? `${remote}.514forge-backup-${transactionId}` : null;
    const lock = lockFor(remote, home);
    const transactionState = joinPosix(lock.root, `transaction-${transactionId}.status`);
    const recoveryRecord = {
      remote,
      baseDigest: currentDigest,
      publishedDigest,
      backup,
      temp,
      scope: projectPath ?? "",
    };
    const lockRootResult = await ssh.exec(hostId, { command: `mkdir -p -- ${shQuote(lock.root)} && chmod 700 ${shQuote(lock.root)}`, timeoutMs: 10_000 });
    if (lockRootResult.code !== 0) throw remoteGraphError("GRAPH_SOURCE_LOCK_FAILED", `cannot create remote source lock root: ${lockRootResult.stderr || lockRootResult.code}`, 502);
    let acquired;
    try {
      acquired = await ssh.exec(hostId, {
        command: acquireLockShell(lock, transactionId, transactionState, recoveryRecord),
        timeoutMs: 10_000,
      });
    } catch (error) {
      if (error?.code !== "SSH_EXEC_TIMEOUT") throw error;
      throw graphRecoveryError(
        "GRAPH_SOURCE_LOCK_UNKNOWN",
        "remote source lock acquisition timed out; lock ownership is unknown and automated retry is blocked",
        transactionId,
        { remote, backup, lock },
        503,
      );
    }
    if (acquired.code === 72) {
      await ssh.exec(hostId, { command: `rm -f -- ${shQuote(transactionState)}`, timeoutMs: 10_000 }).catch(() => {});
      throw remoteGraphError("REMOTE_CONFLICT", "another remote transaction already owns this source", 409);
    }
    if (acquired.code === 82) {
      throw graphRecoveryError(
        "GRAPH_SOURCE_LOCK_RELEASE_INCOMPLETE",
        "remote source lock cleanup was incomplete; manual recovery is required and automated retry is blocked",
        transactionId,
        { remote, backup, lock },
      );
    }
    if (acquired.code === 79) {
      await ssh.exec(hostId, { command: `rm -f -- ${shQuote(transactionState)}`, timeoutMs: 10_000 }).catch(() => {});
      throw remoteGraphError("GRAPH_SOURCE_LOCK_FAILED", "cannot persist remote source lock ownership", 502);
    }
    if (acquired.code !== 0) throw remoteGraphError("GRAPH_SOURCE_LOCK_FAILED", `cannot acquire remote source lock: ${acquired.stderr || acquired.code}`, 502);

    let failure = null;
    let retainLock = false;
    let publish = null;
    try {
      const mkdirResult = await ssh.exec(hostId, { command: `mkdir -p -- ${shQuote(parent)}`, timeoutMs: 10_000 });
      if (mkdirResult.code !== 0) throw remoteGraphError("GRAPH_SOURCE_MKDIR_FAILED", `cannot create ${parent}: ${mkdirResult.stderr || mkdirResult.code}`, 502);
      await ssh.sftpWrite(hostId, temp, content, { mode: 0o600, flags: "wx" });
      const cas = current
        ? `test ! -L ${shQuote(remote)} || exit 74; ${sha256Shell(remote)}; test "$actual" = ${shQuote(currentDigest)} || exit 73; test ! -e ${shQuote(backup)} || exit 77; cp -p -- ${shQuote(remote)} ${shQuote(backup)}`
        : `test ! -L ${shQuote(remote)} || exit 74; test ! -e ${shQuote(remote)} || exit 73`;
      try {
        publish = await ssh.exec(hostId, {
          command: statusWrappedShell(
            `set -eu; ${cas}; ${sha256Shell(temp, "staged")}; test "$staged" = ${shQuote(publishedDigest)} || exit 76; chmod 600 ${shQuote(temp)}; mv -f -- ${shQuote(temp)} ${shQuote(remote)}`,
            lock,
            "publish",
          ),
          timeoutMs: 20_000,
        });
      } catch (error) {
        if (error?.code !== "SSH_EXEC_TIMEOUT") throw error;
        retainLock = true;
        throw graphRecoveryError(
          "GRAPH_SOURCE_COMMIT_UNKNOWN",
          "remote source publish timed out; commit state is unknown, manual recovery is required, and automated retry is blocked",
          transactionId,
          {
            remote,
            backup,
            lock,
            uncertain: [{ remote, bytes: Buffer.byteLength(content), backup }],
          },
          503,
        );
      }
      if (publish.code !== 0) {
        await ssh.exec(hostId, { command: `rm -f -- ${shQuote(temp)}`, timeoutMs: 10_000 }).catch(() => {});
        if (publish.code === 73) throw remoteGraphError("GRAPH_SOURCE_CONFLICT", "remote source changed during publish", 409);
        if (publish.code === 74) throw remoteGraphError("GRAPH_SOURCE_SYMLINK", "refusing to replace a symlinked remote source", 409);
        if (publish.code === 75) throw remoteGraphError("GRAPH_SOURCE_HASH_UNAVAILABLE", "remote host has no SHA-256 utility", 502);
        if (publish.code === 76) throw remoteGraphError("GRAPH_SOURCE_STAGING_MISMATCH", "uploaded remote source digest mismatch", 502);
        if (publish.code === 77) throw remoteGraphError("GRAPH_SOURCE_BACKUP_CONFLICT", "remote source backup path already exists", 409);
        throw remoteGraphError("GRAPH_SOURCE_PUBLISH_FAILED", `cannot publish ${remote}: ${publish.stderr || publish.code}`, 502);
      }
    } catch (error) {
      failure = error;
    }

    if (!retainLock) {
      let released;
      try {
        released = await ssh.exec(hostId, { command: releaseLockShell(lock, transactionId, transactionState), timeoutMs: 10_000 });
      } catch (error) {
        released = { code: -1, stderr: error.message };
      }
      if (released.code !== 0) {
        const releaseFailure = graphRecoveryError(
          "GRAPH_SOURCE_LOCK_RELEASE_INCOMPLETE",
          `remote source lock release was incomplete (${released.stderr || released.code}); manual recovery is required and automated retry is blocked`,
          transactionId,
          {
            remote,
            backup,
            lock,
            applied: publish?.code === 0 ? [{ remote, bytes: Buffer.byteLength(content), backup }] : [],
          },
        );
        if (failure) releaseFailure.causeCode = failure.code;
        failure = releaseFailure;
      }
    }
    if (failure) throw failure;
    return {
      id: file.id,
      remote,
      bytes: Buffer.byteLength(content),
      digest: publishedDigest,
      backup,
      created: current == null,
      transactionId,
    };
  }

  /**
   * 备份原文只在服务端流转：恢复复用这里的原文，HTTP 面只拿 readBackup 的脱敏投影。
   * symlink 单独拒绝——备份被换成指向别处的链接时，读会外泄、恢复会把他人内容写进真源。
   */
  async function readBackupRaw(hostId, sourceId, backupName, { projectPath: requestedProjectPath = null } = {}) {
    const home = await resolveHome(hostId);
    const projectPath = await projectPathOf(ssh, hostId, requestedProjectPath);
    const file = [...GRAPH_SOURCE_FILES, ...projectFiles(projectPath)].find((entry) => entry.id === String(sourceId ?? ""));
    if (!file) throw remoteGraphError("GRAPH_SOURCE_UNKNOWN", `unknown graph source: ${sourceId}`, 400);
    if (file.contentPolicy === "hidden") throw remoteGraphError("GRAPH_BACKUP_HIDDEN", "credential container backups never leave the remote host", 403);
    if (!ssh.sftpReadRaw) throw remoteGraphError("GRAPH_SOURCE_RAW_UNAVAILABLE", "raw SFTP reader is unavailable", 503);
    const remote = await canonicalTargetPath(ssh, hostId, sourcePath(file, home));
    const backupRemote = backupRemotePath(remote, backupName);
    ssh.assertSftpPathPublic?.(hostId, backupRemote);
    const probe = await ssh.exec(hostId, {
      command: `test -f ${shQuote(backupRemote)} || exit 71; test ! -L ${shQuote(backupRemote)} || exit 74`,
      timeoutMs: 10_000,
    });
    if (probe.code === 71) throw remoteGraphError("GRAPH_BACKUP_MISSING", "remote backup no longer exists", 404);
    if (probe.code === 74) throw remoteGraphError("GRAPH_BACKUP_SYMLINK", "refusing to read a symlinked remote backup", 409);
    if (probe.code !== 0) throw remoteGraphError("GRAPH_BACKUP_STAT_FAILED", `cannot stat remote backup: ${probe.stderr || probe.code}`, 502);
    const raw = await ssh.sftpReadRaw(hostId, backupRemote);
    return { file, remote: backupRemote, source: remote, content: raw.content, truncated: raw.truncated === true };
  }

  async function readBackup(hostId, sourceId, backupName, options = {}) {
    const raw = await readBackupRaw(hostId, sourceId, backupName, options);
    const content = scrub(raw.content);
    const sensitive = findSecretCandidates(raw.content).length > 0;
    return {
      id: raw.file.id,
      cli: raw.file.cli,
      label: raw.file.label,
      name: String(backupName),
      remote: raw.remote,
      source: raw.source,
      content,
      truncated: raw.truncated,
      digest: createHash("sha256").update(raw.content).digest("hex"),
      redacted: content !== raw.content,
      sensitive,
      // 截断或含凭据的备份恢复回去就是内容损坏；这里先如实标注，restoreBackup 再硬拒。
      restorable: !raw.truncated && !sensitive,
    };
  }

  /**
   * 恢复 = 用备份原文再跑一次 writeSource：CAS、锁、原子发布与恢复台账全部继承，
   * 且这次发布同样为「恢复前的内容」留下新备份，所以恢复本身仍可回滚。
   * 原文不经浏览器往返——前端只提交备份名与当前真源 digest。
   */
  async function restoreBackup(hostId, sourceId, backupName, expectedDigest, options = {}) {
    const raw = await readBackupRaw(hostId, sourceId, backupName, { projectPath: options.projectPath ?? null });
    if (raw.truncated) {
      throw remoteGraphError("GRAPH_BACKUP_TRUNCATED", "backup exceeds the 1MB read cap; restoring it would truncate the source", 409);
    }
    if (findSecretCandidates(raw.content).length) {
      throw remoteGraphError("GRAPH_BACKUP_SENSITIVE", "backup contains credential material and cannot be restored through the editor", 403);
    }
    const result = await writeSource(hostId, sourceId, raw.content, expectedDigest, options);
    return { ...result, restoredFrom: String(backupName), restoredBytes: Buffer.byteLength(raw.content) };
  }

  async function reconcileSource(hostId, transactionId, { projectPath = null } = {}) {
    return reconcileRemoteTransaction(ssh, hostId, transactionId, { kind: "graph", projectPath });
  }

  return { graph, readSource, writeSource, readBackup, restoreBackup, reconcileSource };
}
