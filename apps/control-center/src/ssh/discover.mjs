/**
 * ssh/discover.mjs — 本机 SSH 连接自动发现（~/.ssh/config 解析）。
 *
 * 契约（2026-08-11 Codex「连接」对齐波）：
 *   - 只读本机 ssh config，绝不读取/搬运 IdentityFile 等凭据（secrets 纪律不变）
 *   - Host 通配块（* ? !）与 Match 块跳过；关键字大小写不敏感；同块内同名关键字先出现者生效（OpenSSH 语义）
 *   - HostName 缺失时回退 alias 本身；User 缺失返回 null（调用方以本机用户名兜底，与 ssh 默认行为一致）
 *   - Include 指令不递归（首版纪律：只解析主 config 文件，避免跨文件读凭据目录）
 */

import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { matchKnownHost, parseKnownHosts } from "./known-hosts.mjs";

const CAPTURED_KEYWORDS = new Set(["hostname", "user", "port", "identityfile"]);

function unquote(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^"(.*)"$/);
  return match ? match[1] : text;
}

/**
 * 解析 ssh config 文本 → [{ alias, aliases, host, user, port }]。
 * alias = Host 行首个非通配模式；aliases 保留全部非通配模式供展示。
 */
export function parseSshConfig(text) {
  const blocks = [];
  let current = null;
  let inMatch = false;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const pair = line.match(/^(\S+?)(?:\s*=\s*|\s+)(.*)$/);
    const keyword = (pair ? pair[1] : line).toLowerCase();
    const value = pair ? pair[2].trim() : "";
    if (keyword === "match") {
      current = null;
      inMatch = true;
      continue;
    }
    if (keyword === "host") {
      inMatch = false;
      const aliases = value.split(/\s+/).map(unquote).filter((alias) => alias && !/[*?!]/.test(alias));
      current = aliases.length ? { aliases, attrs: new Map() } : null;
      if (current) blocks.push(current);
      continue;
    }
    if (inMatch || !current || !CAPTURED_KEYWORDS.has(keyword)) continue;
    // OpenSSH：每个参数先取得者生效
    if (!current.attrs.has(keyword)) current.attrs.set(keyword, unquote(value));
  }
  return blocks.map(({ aliases, attrs }) => {
    const alias = aliases[0];
    const rawPort = Number(attrs.get("port"));
    const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 22;
    return {
      alias,
      aliases,
      host: attrs.get("hostname") || alias,
      user: attrs.get("user") || null,
      port,
      // 私钥只记路径（非密文），连接时按需读入内存，绝不落 secrets 台账
      identityFile: attrs.get("identityfile") || null,
    };
  });
}

/**
 * IdentityFile 路径展开（OpenSSH 语义子集）：~ 展开为本机 home；
 * %d=home %h=host %p=port %r=远端用户 %%=%，其余 token 原样保留。
 */
export function expandIdentityPath(rawPath, { host = "", port = 22, user = "" } = {}) {
  let value = String(rawPath ?? "").trim();
  if (!value) return null;
  const home = homedir();
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) value = join(home, value.slice(2));
  const tokens = { "%%": "%", "%d": home, "%h": String(host), "%p": String(port), "%r": String(user) };
  return value.replace(/%[%dhpr]/g, (token) => tokens[token] ?? token);
}

function localUsername() {
  try {
    return userInfo().username || null;
  } catch {
    return null;
  }
}

/**
 * 台账记录 → ssh config 条目匹配（同步用）：先按名称==alias 精确匹配，
 * 再按 host+port 端点匹配；都不中返回 null（如实 404，不瞎猜）。
 */
export function matchConfigEntry(hosts, { name = "", host = "", port = 22 } = {}) {
  const list = Array.isArray(hosts) ? hosts : [];
  return list.find((entry) => entry.alias === name)
    ?? list.find((entry) => entry.host === host && Number(entry.port) === Number(port))
    ?? null;
}

/**
 * 读取并解析 ssh config。文件不存在属正常态（hosts: [], source: null）；
 * 其他读取失败抛 SSH_DISCOVER_FAILED（500），交给 guarded 包装器统一格式化。
 * 同时尽力匹配 known_hosts：每个条目附 knownFingerprint（无命中为 null），
 * 供登记时一键继承系统已信任的主机键；known_hosts 缺失/不可读静默降级为无继承。
 */
export async function discoverSshHosts({ configPath = null, knownHostsPath = null } = {}) {
  const path = configPath ?? join(homedir(), ".ssh", "config");
  const defaultUser = localUsername();
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { hosts: [], source: null, defaultUser };
    throw Object.assign(new Error(`read ssh config failed: ${error.message}`), {
      code: "SSH_DISCOVER_FAILED",
      httpStatus: 500,
    });
  }
  let knownEntries = [];
  try {
    knownEntries = parseKnownHosts(await readFile(knownHostsPath ?? join(homedir(), ".ssh", "known_hosts"), "utf8"));
  } catch { /* 无 known_hosts 或不可读：不继承，不报错 */ }
  const hosts = parseSshConfig(text).map((entry) => ({
    ...entry,
    knownFingerprint: matchKnownHost(knownEntries, entry.host, entry.port),
  }));
  return { hosts, source: path, defaultUser };
}
