/**
 * ssh/known-hosts.mjs — 系统 known_hosts 信任继承（2026-08-11「为什么还需要确认指纹」波）。
 *
 * 契约：
 *   - 只读 ~/.ssh/known_hosts，把「这台机器上已经信任过的主机键」折算成台账指纹（SHA256 base64 无填充）
 *   - OpenSSH 语义：逗号模式列表、! 否定、* ? glob、|1|salt|hash 哈希模式（HMAC-SHA1）、
 *     非标准端口只匹配 [host]:port 括号形式；@cert-authority/@revoked 标记不授予特殊语义（本面只取 key）
 *   - 多 key 命中按 keyType 偏好取一（ed25519 > ecdsa > rsa）；台账单指纹模型，其余 key 轮换走再确认
 */

import { createHash, createHmac } from "node:crypto";

const KEY_TYPE_PREFERENCE = [
  "ssh-ed25519",
  "sk-ssh-ed25519@openssh.com",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ecdsa-sha2-nistp256@openssh.com",
  "rsa-sha2-512",
  "rsa-sha2-256",
  "ssh-rsa",
];

/** key blob → 台账指纹格式（与 ssh2 hostHash sha256 对齐：SHA256:base64 去 = 填充）。 */
export function fingerprintOfKeyBlob(keyB64) {
  try {
    const blob = Buffer.from(String(keyB64), "base64");
    if (!blob.length) return null;
    return `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;
  } catch {
    return null;
  }
}

export function parseKnownHosts(text) {
  const entries = [];
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const tokens = line.split(/\s+/);
    if (tokens[0]?.startsWith("@")) tokens.shift();
    if (tokens.length < 3) continue;
    const [patternsField, keyType, keyB64] = tokens;
    const fingerprint = fingerprintOfKeyBlob(keyB64);
    if (!fingerprint) continue;
    entries.push({ patterns: patternsField.split(","), keyType, fingerprint });
  }
  return entries;
}

function globToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function hashedPatternMatches(pattern, candidate) {
  const parts = pattern.split("|"); // ["", "1", saltB64, hashB64]
  if (parts.length !== 4 || parts[1] !== "1") return false;
  try {
    return createHmac("sha1", Buffer.from(parts[2], "base64")).update(candidate).digest("base64") === parts[3];
  } catch {
    return false;
  }
}

function patternListMatches(patterns, candidate) {
  let matched = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    const body = negated ? pattern.slice(1) : pattern;
    if (!body) continue;
    const hit = body.startsWith("|1|") ? hashedPatternMatches(body, candidate) : globToRegExp(body).test(candidate);
    if (hit && negated) return false;
    if (hit) matched = true;
  }
  return matched;
}

function keyTypeRank(keyType) {
  const index = KEY_TYPE_PREFERENCE.indexOf(keyType);
  return index === -1 ? KEY_TYPE_PREFERENCE.length : index;
}

/** 命中返回指纹，未命中返回 null。端口非 22 时只匹配 [host]:port（OpenSSH 语义）。 */
export function matchKnownHost(entries, host, port = 22) {
  if (!host) return null;
  const candidate = Number(port) === 22 ? String(host) : `[${host}]:${Number(port) || 22}`;
  const matches = entries.filter((entry) => patternListMatches(entry.patterns, candidate));
  if (!matches.length) return null;
  matches.sort((a, b) => keyTypeRank(a.keyType) - keyTypeRank(b.keyType));
  return matches[0].fingerprint;
}
