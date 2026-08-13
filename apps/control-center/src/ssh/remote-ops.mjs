/**
 * ssh/remote-ops.mjs — 远程环境治理（v41 波一）：聚合探测 / CLI 安装 / 一键同步本机配置。
 *
 * 只消费 createSshService 的公开方法（exec/update/sftpWrite），不摸内部态；
 * 全操作走既有 ssh/sftp 门闸与 TOFU 指纹纪律，安装/同步失败如实回显（不伪造成功）。
 *
 * 设计锚点（proposals/v41-remote-agent-design.md §4）：
 *   - 探测一条 shell 脚本跑完（health.mjs 探针风暴教训：禁 N 并发 channel）
 *   - CLI 清单/安装命令复用 cli-env.mjs 的 CLI_TOOLS + installSpec（与本地环境面同源）
 *   - 同步推「本机运行时实况文件」，凭据文件（auth.json/.env）永远不进清单；
 *     含高熵秘密的文件标 containsSecrets，前端红字警示、显式勾选才推
 */

import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, posix } from "node:path";
import { CLI_TOOLS, installSpec } from "../cli-env.mjs";
import { findSecretCandidates, redactString } from "../redaction.mjs";
import { reconcileRemoteTransaction } from "./remote-config.mjs";

const PROBE_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 120_000; // exec 内部硬顶
const VERSION_RE = /(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?)/;

/** 同步候选：本机运行时实况文件 → 远端 $HOME 相对路径。凭据文件（auth.json/.env/secrets）永不进清单。 */
const SYNC_CANDIDATES = Object.freeze([
  { id: "codex-config", label: "Codex config.toml", local: ".codex/config.toml", remote: ".codex/config.toml" },
  { id: "codex-agents", label: "Codex AGENTS.md", local: ".codex/AGENTS.md", remote: ".codex/AGENTS.md" },
  { id: "kimi-config", label: "Kimi config.toml", local: ".kimi-code/config.toml", remote: ".kimi-code/config.toml" },
  { id: "claude-settings", label: "Claude settings.json", local: ".claude/settings.json", remote: ".claude/settings.json" },
]);

function remoteOpsError(code, message, httpStatus = 400) {
  return Object.assign(new Error(message), { code, httpStatus });
}

/** POSIX 单引号包裹（'\'' 转义）——远端 shell 命令拼路径唯一合法形态（pty/routes.mjs 先例）。 */
function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sha256Shell(path, variable = "actual") {
  return `${variable}=$(if command -v sha256sum >/dev/null 2>&1; then sha256sum ${shQuote(path)} | awk '{print $1}'; elif command -v shasum >/dev/null 2>&1; then shasum -a 256 ${shQuote(path)} | awk '{print $1}'; else exit 75; fi)`;
}

function joinPosix(base, relative) {
  const cleanBase = String(base).replace(/\/+$/, "") || "/";
  return cleanBase === "/" ? `/${relative}` : `${cleanBase}/${relative}`;
}

async function canonicalTargetPath(ssh, hostId, remote) {
  const parent = posix.dirname(remote);
  const canonicalParent = await ssh.assertSftpResolvedPathPublic?.(hostId, parent, { allowMissing: true }) ?? parent;
  return joinPosix(canonicalParent, posix.basename(remote));
}

function syncLockFor(remote, home) {
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

function releaseSyncLockShell(lock, transactionId) {
  const metadata = [lock.target, lock.base, lock.published, lock.backupMetadata, lock.tempMetadata, lock.kind, lock.scope, lock.changed, lock.status, lock.owner];
  return `test "$(cat ${shQuote(lock.owner)} 2>/dev/null || true)" = ${shQuote(transactionId)} && rm -f -- ${metadata.map(shQuote).join(" ")} && rmdir -- ${shQuote(lock.path)}`;
}

function syncStatusShell(command, lock, phase) {
  const trapBody = `rc=$?; trap - 0; printf '%s:%s\\n' ${shQuote(phase)} "$rc" > ${shQuote(lock.status)}; exit "$rc"`;
  return `printf '%s\\n' ${shQuote(`${phase}:running`)} > ${shQuote(lock.status)}; trap ${shQuote(trapBody)} 0; ${command}`;
}

function acquireSyncLocksShell(files, transactionId, transactionState) {
  const transactionTrap = `rc=$?; trap - 0; printf '%s:%s\\n' 'acquire' "$rc" > ${shQuote(transactionState)}; exit "$rc"`;
  const commands = [
    "set -u",
    "umask 077",
    `printf '%s\\n' 'acquire:running' > ${shQuote(transactionState)}`,
    `trap ${shQuote(transactionTrap)} 0`,
  ];
  const acquired = [];
  for (const file of files) {
    const cleanup = acquired.slice().reverse().map((entry) => releaseSyncLockShell(entry.lock, transactionId)).join(" && ") || ":";
    commands.push(`if mkdir -- ${shQuote(file.lock.path)}; then :; elif test -d ${shQuote(file.lock.path)}; then ${cleanup} || exit 82; exit 72; else ${cleanup} || exit 82; exit 79; fi`);
    const metadataEntries = [
      [file.lock.target, file.remote],
      [file.lock.base, file.baseDigest],
      [file.lock.published, file.publishedDigest],
      [file.lock.backupMetadata, file.backup ?? ""],
      [file.lock.tempMetadata, file.temp],
      [file.lock.kind, "sync"],
      [file.lock.scope, ""],
      [file.lock.changed, "yes"],
      [file.lock.status, "prepared"],
      [file.lock.owner, transactionId],
    ];
    const metadata = metadataEntries.map(([path, value]) => `printf '%s\\n' ${shQuote(value)} > ${shQuote(path)}`).join(" && ");
    const cleanupCurrent = `rm -f -- ${metadataEntries.map(([path]) => shQuote(path)).join(" ")} && rmdir -- ${shQuote(file.lock.path)}`;
    commands.push(`if ! { ${metadata}; }; then ${cleanupCurrent} 2>/dev/null || exit 82; ${cleanup} || exit 82; exit 79; fi`);
    acquired.push(file);
  }
  return commands.join("; ");
}

function releaseSyncLocksShell(files, transactionId) {
  return [
    "set -u",
    ...files.slice().reverse().map((file) => `${releaseSyncLockShell(file.lock, transactionId)} || exit 81`),
  ].join("; ");
}

function verifySyncSnapshotShell(files) {
  const commands = ["set -eu"];
  files.forEach((file, index) => {
    commands.push(`test ! -L ${shQuote(file.remote)} || exit 74`);
    if (file.exists) {
      commands.push(sha256Shell(file.remote, `actual_${index}`));
      commands.push(`test "$actual_${index}" = ${shQuote(file.baseDigest)} || exit 73`);
    } else {
      commands.push(`test ! -e ${shQuote(file.remote)} || exit 73`);
    }
  });
  return commands.join("; ");
}

function verifySyncPublishedShell(files) {
  const commands = ["set -eu"];
  files.forEach((file, index) => {
    commands.push(`test ! -L ${shQuote(file.remote)} || exit 74`);
    commands.push(sha256Shell(file.remote, `published_${index}`));
    commands.push(`test "$published_${index}" = ${shQuote(file.publishedDigest)} || exit 73`);
  });
  return commands.join("; ");
}

function publicSyncFile(file) {
  return { id: file.id, label: file.label, remote: file.remote, bytes: file.bytes, backup: file.backup };
}

function syncRecoveryDetails(files, applied, uncertain) {
  const uniqueUncertain = [...new Map(uncertain.map((file) => [file.remote, file])).values()];
  const affected = [...applied, ...uniqueUncertain];
  const backups = new Map();
  for (const file of affected) {
    if (file.backup) backups.set(file.backup, { remote: file.remote, backup: file.backup });
  }
  return {
    applied: applied.map(publicSyncFile),
    uncertain: uniqueUncertain.map(publicSyncFile),
    backups: [...backups.values()],
    locks: files.map((file) => file.lock.path),
  };
}

function syncResults(files, failure, { recoveryRequired = false, rolledBack = new Set() } = {}) {
  return files.map((file) => ({
    id: file.id,
    label: file.label,
    remote: file.remote,
    ok: false,
    ...(rolledBack.has(file.remote) ? { rolledBack: true } : {}),
    error: failure.message,
    ...(recoveryRequired ? { recoveryRequired: true } : {}),
  }));
}

function recoverySyncResult(home, files, transactionId, failure, applied, uncertain, extras = {}) {
  return {
    home,
    complete: false,
    status: "recovery_required",
    recoveryRequired: true,
    retryable: false,
    kind: "sync",
    transactionId,
    recovery: { kind: "sync", transactionId },
    code: failure.code ?? "REMOTE_SYNC_RECOVERY_REQUIRED",
    message: failure.message,
    ...syncRecoveryDetails(files, applied, uncertain),
    ...extras,
    results: syncResults(files, failure, { recoveryRequired: true }),
  };
}

async function readOptionalRemote(ssh, hostId, remote) {
  try {
    const result = await ssh.sftpReadRaw(hostId, remote);
    return { exists: true, content: result.content };
  } catch (error) {
    if (error?.code !== "SFTP_FAILED") throw error;
    const stat = await ssh.exec(hostId, {
      command: `if [ -f ${shQuote(remote)} ]; then printf yes; else printf no; fi`,
      timeoutMs: 10_000,
    });
    if (String(stat.stdout ?? "").trim() === "yes") throw error;
    return { exists: false, content: "" };
  }
}

/** 聚合探测脚本：一条命令出全部；逐 CLI `command -v` + `--version`（</dev/null 防空读 stdin）。 */
function probeScript() {
  const cliProbes = CLI_TOOLS.map((tool) =>
    `if command -v ${tool.command} >/dev/null 2>&1; then v=$(${tool.command} --version </dev/null 2>&1 | head -c 200 | tr '\\n|' '  '); echo "CLI|${tool.id}|yes|$v"; else echo "CLI|${tool.id}|no||"; fi`
  ).join("; ");
  return [
    'echo "OS|$(uname -srm 2>/dev/null)"',
    'echo "HOST|$(hostname 2>/dev/null)"',
    'echo "SHELL|$SHELL"',
    'echo "HOME|$HOME"',
    'echo "DISK|$(df -h / 2>/dev/null | awk \'NR==2{print $2" total "$4" free"}\')"',
    'echo "MEM|$(free -h 2>/dev/null | awk \'/^Mem:/{print $3" / "$2}\')"',
    "if [ -r /proc/stat ]; then set -- $(head -n 1 /proc/stat); shift; u1=$1; n1=$2; s1=$3; i1=$4; w1=$5; x1=$6; y1=$7; z1=$8; t1=$((u1+n1+s1+i1+w1+x1+y1+z1)); d1=$((i1+w1)); sleep 0.2; set -- $(head -n 1 /proc/stat); shift; u2=$1; n2=$2; s2=$3; i2=$4; w2=$5; x2=$6; y2=$7; z2=$8; t2=$((u2+n2+s2+i2+w2+x2+y2+z2)); d2=$((i2+w2)); dt=$((t2-t1)); di=$((d2-d1)); cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf 0); if [ \"$dt\" -gt 0 ]; then cpu=$(awk -v t=\"$dt\" -v i=\"$di\" 'BEGIN{printf \"%.1f\", 100*(t-i)/t}'); else cpu=; fi; printf 'CPU|%s|%s\\n' \"$cores\" \"$cpu\"; fi",
    "if [ -r /proc/meminfo ]; then awk '/^MemTotal:/{t=$2}/^MemAvailable:/{a=$2}END{if(t>0){u=t-a; printf \"MEMSTAT|%.0f|%.0f|%.1f\\n\",t*1024,u*1024,100*u/t}}' /proc/meminfo; fi",
    "df -Pk / 2>/dev/null | awk 'NR==2{gsub(/%/,\"\",$5); printf \"DISKSTAT|%.0f|%.0f|%s\\n\",$2*1024,$3*1024,$5}'",
    "if [ -r /proc/loadavg ]; then awk '{split($4,p,\"/\"); printf \"LOAD|%s|%s|%s\\nPROCS|%s\\n\",$1,$2,$3,p[2]}' /proc/loadavg; fi",
    "if [ -r /proc/uptime ]; then awk '{printf \"UPTIME|%.0f\\n\",$1}' /proc/uptime; fi",
    "if [ -r /proc/net/dev ]; then awk -F'[: ]+' 'NR>2 && $1 != \"lo\" {rx+=$2; tx+=$10} END{printf \"NET|%.0f|%.0f\\n\",rx,tx}' /proc/net/dev; fi",
    cliProbes,
  ].join("; ");
}

function proxyProbeScript() {
  const env = ["http_proxy", "https_proxy", "all_proxy", "no_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"]
    .map((name) => `v=$(printenv ${name} 2>/dev/null || true); [ -n "$v" ] && printf 'ENV|${name}|%s\\n' "$v"`);
  return [
    ...env,
    "if command -v ss >/dev/null 2>&1; then ss -lntpH 2>/dev/null | awk '$4 ~ /:(1080|3128|7890|7891|7897|8080|10808)$/ {print \"LISTEN|\" $0}' | head -n 20; elif command -v netstat >/dev/null 2>&1; then netstat -lntp 2>/dev/null | awk '$4 ~ /:(1080|3128|7890|7891|7897|8080|10808)$/ {print \"LISTEN|\" $0}' | head -n 20; fi",
    "if command -v curl >/dev/null 2>&1; then for u in https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com; do r=$(curl -L -sS -o /dev/null --max-time 8 -w '%{http_code}|%{time_total}' \"$u\" 2>/dev/null); c=$?; printf 'OUT|%s|%s|%s\\n' \"$u\" \"$r\" \"$c\"; done; else echo 'CURL|missing'; fi",
  ].join("; ");
}

function finiteMetric(value, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return integer ? Math.round(parsed) : parsed;
}

/** 解析探测输出：文本摘要向后兼容；metrics 只接收有限、非负的真实采样值。 */
export function parseProbeOutput(stdout) {
  const probe = {
    os: null,
    hostname: null,
    shell: null,
    home: null,
    disk: null,
    memory: null,
    metrics: {
      cpu: { cores: null, usagePercent: null },
      memory: { totalBytes: null, usedBytes: null, usagePercent: null },
      disk: { totalBytes: null, usedBytes: null, usagePercent: null },
      load: { one: null, five: null, fifteen: null },
      uptimeSeconds: null,
      processes: null,
      network: { rxBytes: null, txBytes: null },
    },
    clis: [],
  };
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (line.startsWith("OS|")) probe.os = line.slice(3).trim() || null;
    else if (line.startsWith("HOST|")) probe.hostname = line.slice(5).trim() || null;
    else if (line.startsWith("SHELL|")) probe.shell = line.slice(6).trim() || null;
    else if (line.startsWith("HOME|")) probe.home = line.slice(5).trim() || null;
    else if (line.startsWith("DISK|")) probe.disk = line.slice(5).trim() || null;
    else if (line.startsWith("MEM|")) probe.memory = line.slice(4).trim() || null;
    else if (line.startsWith("CPU|")) {
      const [, cores, percent] = line.split("|");
      probe.metrics.cpu = {
        cores: finiteMetric(cores, { min: 1, max: 4096, integer: true }),
        usagePercent: finiteMetric(percent, { max: 100 }),
      };
    } else if (line.startsWith("MEMSTAT|")) {
      const [, total, used, percent] = line.split("|");
      probe.metrics.memory = {
        totalBytes: finiteMetric(total, { integer: true }),
        usedBytes: finiteMetric(used, { integer: true }),
        usagePercent: finiteMetric(percent, { max: 100 }),
      };
    } else if (line.startsWith("DISKSTAT|")) {
      const [, total, used, percent] = line.split("|");
      probe.metrics.disk = {
        totalBytes: finiteMetric(total, { integer: true }),
        usedBytes: finiteMetric(used, { integer: true }),
        usagePercent: finiteMetric(percent, { max: 100 }),
      };
    } else if (line.startsWith("LOAD|")) {
      const [, one, five, fifteen] = line.split("|");
      probe.metrics.load = {
        one: finiteMetric(one, { max: 1_000_000 }),
        five: finiteMetric(five, { max: 1_000_000 }),
        fifteen: finiteMetric(fifteen, { max: 1_000_000 }),
      };
    } else if (line.startsWith("UPTIME|")) {
      probe.metrics.uptimeSeconds = finiteMetric(line.slice(7), { integer: true });
    } else if (line.startsWith("PROCS|")) {
      probe.metrics.processes = finiteMetric(line.slice(6), { max: 10_000_000, integer: true });
    } else if (line.startsWith("NET|")) {
      const [, rx, tx] = line.split("|");
      probe.metrics.network = {
        rxBytes: finiteMetric(rx, { integer: true }),
        txBytes: finiteMetric(tx, { integer: true }),
      };
    }
    else if (line.startsWith("CLI|")) {
      const [, id, yes, ...rest] = line.split("|");
      const tool = CLI_TOOLS.find((entry) => entry.id === id);
      if (!tool) continue;
      const raw = rest.join("|").trim();
      probe.clis.push({
        id: tool.id,
        label: tool.label,
        command: tool.command,
        installed: yes === "yes",
        version: yes === "yes" ? (raw.match(VERSION_RE)?.[1] ?? null) : null,
        rawVersion: yes === "yes" ? raw || null : null,
      });
    }
  }
  return probe;
}

function safeProxyValue(value) {
  const text = String(value ?? "");
  try {
    const parsed = new URL(text);
    if (parsed.username) parsed.username = "redacted";
    if (parsed.password) parsed.password = "redacted";
    return redactString(parsed.toString()).slice(0, 500);
  } catch {
    return redactString(text).slice(0, 500);
  }
}

export function parseProxyProbeOutput(stdout) {
  const result = { environment: [], listeners: [], outbound: [], curlAvailable: true };
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (line.startsWith("ENV|")) {
      const [, name, ...rest] = line.split("|");
      if (/^(?:https?|all|no)_proxy$/i.test(name)) result.environment.push({ name, value: safeProxyValue(rest.join("|")) });
    } else if (line.startsWith("LISTEN|")) {
      result.listeners.push(redactString(line.slice(7, 507)));
    } else if (line.startsWith("OUT|")) {
      const [, url, status, seconds, exitCode] = line.split("|");
      result.outbound.push({
        url,
        status: /^\d{3}$/.test(status) ? Number(status) : null,
        timeMs: Number.isFinite(Number(seconds)) ? Math.round(Number(seconds) * 1000) : null,
        ok: Number(exitCode) === 0 && /^\d{3}$/.test(status) && Number(status) > 0,
        exitCode: Number(exitCode),
      });
    } else if (line === "CURL|missing") {
      result.curlAvailable = false;
    }
  }
  return result;
}

export function createRemoteOps(ssh, { localHome = homedir() } = {}) {
  async function probe(hostId) {
    const result = await ssh.exec(hostId, { command: probeScript(), timeoutMs: PROBE_TIMEOUT_MS });
    if (result.code !== 0) {
      throw remoteOpsError("REMOTE_PROBE_FAILED", `probe exited ${result.code}: ${(result.stderr || "").slice(0, 200)}`, 502);
    }
    const parsed = parseProbeOutput(result.stdout);
    // 实测 home 回写台账：SFTP 围栏根用准确值（root=/root 等非 /home/<user> 形态不再被误拒）
    if (parsed.home?.startsWith("/")) {
      await ssh.update(hostId, { home: parsed.home }).catch(() => {});
    }
    return parsed;
  }

  async function diagnoseProxy(hostId) {
    const result = await ssh.exec(hostId, { command: proxyProbeScript(), timeoutMs: 35_000 });
    if (result.code !== 0) {
      throw remoteOpsError("REMOTE_PROXY_DIAGNOSE_FAILED", `proxy diagnosis exited ${result.code}: ${(result.stderr || "").slice(0, 200)}`, 502);
    }
    return parseProxyProbeOutput(result.stdout);
  }

  async function installCli(hostId, toolId, { platform = "linux" } = {}) {
    const tool = CLI_TOOLS.find((entry) => entry.id === String(toolId ?? ""));
    if (!tool) throw remoteOpsError("REMOTE_TOOL_UNKNOWN", `unknown cli tool: ${toolId}`, 404);
    const spec = installSpec(tool, platform === "darwin" ? "darwin" : "linux"); // 远端非 win32 语义；macOS 按 darwin 通道
    if (!spec) throw remoteOpsError("REMOTE_INSTALL_UNSUPPORTED", `${tool.label} 无 ${platform} 安装通道`, 422);
    // spec.command/args 全部来自 CLI_TOOLS 常量清单（非用户输入），拼接无注入面
    const command = [spec.command, ...spec.args].join(" ");
    const result = await ssh.exec(hostId, { command: `${command} </dev/null`, timeoutMs: INSTALL_TIMEOUT_MS });
    return {
      tool: { id: tool.id, label: tool.label },
      display: spec.display,
      ok: result.code === 0,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async function planConfigSync() {
    const files = [];
    for (const candidate of SYNC_CANDIDATES) {
      let content = null;
      try {
        content = await readFile(join(localHome, candidate.local), "utf8");
      } catch { /* 本机不存在——如实 exists:false */ }
      files.push({
        id: candidate.id,
        label: candidate.label,
        local: candidate.local,
        remote: candidate.remote,
        exists: content !== null,
        size: content !== null ? Buffer.byteLength(content) : 0,
        containsSecrets: content !== null ? findSecretCandidates(content).length > 0 : false,
        digest: content !== null ? createHash("sha256").update(content).digest("hex") : null,
      });
    }
    return { files };
  }

  async function syncConfig(hostId, selections = [], options = {}) {
    if (!Array.isArray(selections) || !selections.length) {
      throw remoteOpsError("SYNC_FILES_REQUIRED", "files must be a non-empty array of planned file selections");
    }
    if (selections.some((selection) => !selection || typeof selection !== "object" || Array.isArray(selection))) {
      throw remoteOpsError("SYNC_PLAN_REQUIRED", "each sync file must include its id and planned digest", 409);
    }
    const unknown = selections
      .map((selection) => String(selection.id ?? ""))
      .filter((id) => !SYNC_CANDIDATES.some((candidate) => candidate.id === id));
    if (unknown.length) throw remoteOpsError("SYNC_FILE_UNKNOWN", `unknown sync files: ${unknown.join(", ")}`);
    const selected = [];
    for (const selection of selections) {
      const candidate = SYNC_CANDIDATES.find((entry) => entry.id === selection.id);
      if (selected.some((entry) => entry.id === candidate.id)) continue;
      let content;
      try {
        content = await readFile(join(localHome, candidate.local), "utf8");
      } catch {
        throw remoteOpsError("SYNC_PLAN_STALE", `local sync file changed since planning: ${candidate.label}`, 409);
      }
      const digest = createHash("sha256").update(content).digest("hex");
      if (!/^[a-f0-9]{64}$/i.test(String(selection.digest ?? "")) || digest !== selection.digest) {
        throw remoteOpsError("SYNC_PLAN_STALE", `local sync file changed since planning: ${candidate.label}`, 409);
      }
      const containsSecrets = findSecretCandidates(content).length > 0;
      if (containsSecrets && selection.allowSecrets !== true) {
        throw remoteOpsError("SYNC_SECRET_CONFIRMATION_REQUIRED", `secret confirmation is required for ${candidate.label}`, 409);
      }
      selected.push({ candidate, content, digest });
    }
    // 实测远端 $HOME（root=/root 等形态）；写回台账让 SFTP 围栏认这个家
    const homeResult = await ssh.exec(hostId, { command: 'printf %s "$HOME"', timeoutMs: 10_000 });
    if (homeResult.code !== 0) throw remoteOpsError("SYNC_HOME_UNKNOWN", `cannot resolve remote $HOME: ${homeResult.stderr || homeResult.code}`, 502);
    const remoteHome = String(homeResult.stdout ?? "").trim();
    if (!remoteHome.startsWith("/")) throw remoteOpsError("SYNC_HOME_UNKNOWN", "cannot resolve remote $HOME", 502);
    await ssh.update(hostId, { home: remoteHome }).catch(() => {});
    const canonicalHome = (await ssh.assertSftpResolvedPathPublic?.(hostId, remoteHome) ?? remoteHome).replace(/\/+$/, "") || "/";
    const transactionId = options.transactionId ?? randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(transactionId)) {
      throw remoteOpsError("REMOTE_RECOVERY_TRANSACTION_INVALID", "a valid transactionId is required", 400);
    }
    const entries = [];
    for (const { candidate, content, digest } of selected) {
      const remotePath = await canonicalTargetPath(ssh, hostId, posix.join(canonicalHome, candidate.remote));
      entries.push({
        id: candidate.id,
        label: candidate.label,
        remote: remotePath,
        content,
        bytes: Buffer.byteLength(content),
        publishedDigest: digest,
      });
    }
    entries.sort((left, right) => left.remote < right.remote ? -1 : left.remote > right.remote ? 1 : 0);
    if (new Set(entries.map((entry) => entry.remote)).size !== entries.length) {
      throw remoteOpsError("SYNC_TARGET_COLLISION", "multiple sync files resolve to the same canonical remote target", 409);
    }

    const prepared = [];
    try {
      for (const entry of entries) {
        const snapshot = await readOptionalRemote(ssh, hostId, entry.remote);
        const temp = `${entry.remote}.514forge-${transactionId}.tmp`;
        const backup = snapshot.exists ? `${entry.remote}.514forge-backup-${transactionId}` : null;
        prepared.push({
          ...entry,
          exists: snapshot.exists,
          baseContent: snapshot.content,
          temp,
          backup,
          baseDigest: snapshot.exists ? createHash("sha256").update(snapshot.content).digest("hex") : "missing",
          lock: syncLockFor(entry.remote, canonicalHome),
        });
      }
    } catch (error) {
      return {
        home: canonicalHome,
        complete: false,
        status: "preflight_failed",
        recoveryRequired: false,
        kind: "sync",
        transactionId,
        code: error.code ?? "SYNC_PREFLIGHT_FAILED",
        results: entries.map((entry) => ({ id: entry.id, label: entry.label, remote: entry.remote, ok: false, error: `同步未开始：${error.message}` })),
      };
    }

    const lockRoot = prepared[0].lock.root;
    const transactionState = joinPosix(lockRoot, `transaction-${transactionId}.status`);
    const lockRootResult = await ssh.exec(hostId, { command: `mkdir -p -- ${shQuote(lockRoot)} && chmod 700 ${shQuote(lockRoot)}`, timeoutMs: 10_000 });
    if (lockRootResult.code !== 0) {
      const failure = remoteOpsError("SYNC_LOCK_FAILED", `cannot create remote transaction lock root: ${lockRootResult.stderr || lockRootResult.code}`, 502);
      return { home: canonicalHome, complete: false, status: "preflight_failed", recoveryRequired: false, kind: "sync", transactionId, code: failure.code, results: syncResults(prepared, failure) };
    }

    let acquired;
    try {
      acquired = await ssh.exec(hostId, { command: acquireSyncLocksShell(prepared, transactionId, transactionState), timeoutMs: 10_000 });
    } catch (error) {
      if (error?.code !== "SSH_EXEC_TIMEOUT") throw error;
      const failure = remoteOpsError("SYNC_LOCK_UNKNOWN", "remote transaction lock acquisition timed out; automated retry is blocked", 503);
      return recoverySyncResult(canonicalHome, prepared, transactionId, failure, [], []);
    }
    if (acquired.code === 72) {
      await ssh.exec(hostId, { command: `rm -f -- ${shQuote(transactionState)}`, timeoutMs: 10_000 }).catch(() => {});
      const failure = remoteOpsError("REMOTE_CONFLICT", "another remote transaction already owns one or more sync targets", 409);
      return { home: canonicalHome, complete: false, status: "preflight_failed", recoveryRequired: false, kind: "sync", transactionId, code: failure.code, results: syncResults(prepared, failure) };
    }
    if (acquired.code === 82) {
      const failure = remoteOpsError("SYNC_LOCK_RELEASE_INCOMPLETE", "remote lock conflict cleanup was incomplete; automated retry is blocked", 409);
      return recoverySyncResult(canonicalHome, prepared, transactionId, failure, [], []);
    }
    if (acquired.code === 79) {
      await ssh.exec(hostId, { command: `rm -f -- ${shQuote(transactionState)}`, timeoutMs: 10_000 }).catch(() => {});
      const failure = remoteOpsError("SYNC_LOCK_FAILED", "cannot persist remote transaction lock ownership", 502);
      return { home: canonicalHome, complete: false, status: "preflight_failed", recoveryRequired: false, kind: "sync", transactionId, code: failure.code, results: syncResults(prepared, failure) };
    }
    if (acquired.code !== 0) {
      const failure = remoteOpsError("SYNC_LOCK_UNKNOWN", `remote lock acquisition failed with an unclassified state: ${acquired.stderr || acquired.code}`, 502);
      return recoverySyncResult(canonicalHome, prepared, transactionId, failure, [], []);
    }

    const applied = [];
    const currentApplied = new Map();
    const uncertain = [];
    const rolledBack = new Set();
    let failure = null;
    let retainLocks = false;

    const parents = [...new Set(prepared.map((entry) => posix.dirname(entry.remote)))].sort();
    try {
      const mkdir = await ssh.exec(hostId, { command: `mkdir -p -- ${parents.map(shQuote).join(" ")}`, timeoutMs: 10_000 });
      if (mkdir.code !== 0) failure = remoteOpsError("SYNC_MKDIR_FAILED", `cannot create remote config directories: ${mkdir.stderr || mkdir.code}`, 502);
    } catch (error) {
      failure = error;
    }

    if (!failure) {
      try {
        const snapshot = await ssh.exec(hostId, { command: verifySyncSnapshotShell(prepared), timeoutMs: 20_000 });
        if (snapshot.code === 73) failure = remoteOpsError("SYNC_CONFLICT", "one or more remote configs changed before the transaction could stage", 409);
        else if (snapshot.code === 74) failure = remoteOpsError("SYNC_SYMLINK", "refusing to sync through a symlinked remote config", 409);
        else if (snapshot.code === 75) failure = remoteOpsError("SYNC_HASH_UNAVAILABLE", "remote host has no SHA-256 utility", 502);
        else if (snapshot.code !== 0) failure = remoteOpsError("SYNC_PREFLIGHT_FAILED", `cannot verify the locked remote snapshot: ${snapshot.stderr || snapshot.code}`, 502);
      } catch (error) {
        failure = error;
      }
    }

    if (!failure) {
      for (const entry of prepared) {
        try {
          await ssh.sftpWrite(hostId, entry.temp, entry.content, { mode: 0o600, flags: "wx" });
        } catch (error) {
          failure = error;
          break;
        }
      }
    }

    if (!failure) {
      for (const entry of prepared) {
        const currentCas = entry.exists
          ? `test ! -L ${shQuote(entry.remote)} || exit 74; ${sha256Shell(entry.remote)}; test "$actual" = ${shQuote(entry.baseDigest)} || exit 73`
          : `test ! -L ${shQuote(entry.remote)} || exit 74; test ! -e ${shQuote(entry.remote)} || exit 73`;
        const backup = entry.backup
          ? `test ! -e ${shQuote(entry.backup)} || exit 77; cp -p -- ${shQuote(entry.remote)} ${shQuote(entry.backup)}`
          : ":";
        let publish;
        try {
          publish = await ssh.exec(hostId, {
            command: syncStatusShell([
              "set -eu",
              currentCas,
              sha256Shell(entry.temp, "staged"),
              `test "$staged" = ${shQuote(entry.publishedDigest)} || exit 76`,
              backup,
              `chmod 600 ${shQuote(entry.temp)}`,
              `mv -f -- ${shQuote(entry.temp)} ${shQuote(entry.remote)}`,
            ].join("; "), entry.lock, "publish"),
            timeoutMs: 20_000,
          });
        } catch (error) {
          if (error?.code === "SSH_EXEC_TIMEOUT") {
            failure = remoteOpsError("SYNC_COMMIT_UNKNOWN", `sync timed out for ${entry.remote}; commit state is unknown`, 503);
            uncertain.push(entry);
            retainLocks = true;
          } else {
            failure = error;
            uncertain.push(entry);
            retainLocks = true;
          }
          break;
        }
        if (publish.code !== 0) {
          const codes = {
            73: ["SYNC_CONFLICT", "remote config changed during sync", 409],
            74: ["SYNC_SYMLINK", "refusing to replace a symlinked remote config", 409],
            75: ["SYNC_HASH_UNAVAILABLE", "remote host has no SHA-256 utility", 502],
            76: ["SYNC_STAGING_MISMATCH", "uploaded remote config digest mismatch", 502],
            77: ["SYNC_BACKUP_CONFLICT", "remote backup path already exists", 409],
          };
          const known = codes[publish.code];
          const [code, message, status] = known ?? ["SYNC_PUBLISH_UNKNOWN", publish.stderr || `publish exited ${publish.code}`, 502];
          failure = remoteOpsError(code, `${message}: ${entry.remote}`, status);
          if (!known) {
            uncertain.push(entry);
            retainLocks = true;
          }
          break;
        }
        applied.push(entry);
        currentApplied.set(entry.remote, entry);
      }
    }

    if (!failure) {
      try {
        const verified = await ssh.exec(hostId, { command: verifySyncPublishedShell(prepared), timeoutMs: 20_000 });
        if (verified.code === 73) failure = remoteOpsError("SYNC_POST_PUBLISH_DRIFT", "one or more remote configs changed before the sync could be verified", 409);
        else if (verified.code === 74) failure = remoteOpsError("SYNC_SYMLINK", "a remote config became symlinked before post-publish verification", 409);
        else if (verified.code === 75) failure = remoteOpsError("SYNC_HASH_UNAVAILABLE", "remote host has no SHA-256 utility for post-publish verification", 502);
        else if (verified.code !== 0) failure = remoteOpsError("SYNC_POST_PUBLISH_FAILED", `cannot verify published remote configs: ${verified.stderr || verified.code}`, 502);
      } catch (error) {
        failure = remoteOpsError("SYNC_POST_PUBLISH_UNKNOWN", `post-publish verification did not complete: ${error.message}`, 503);
        uncertain.push(...prepared);
        retainLocks = true;
      }
    }

    const rollbackErrors = [];
    const originalFailure = failure;
    if (failure && !retainLocks) {
      for (const entry of [...currentApplied.values()].reverse()) {
        const action = entry.exists
          ? `test -f ${shQuote(entry.backup)} && test ! -L ${shQuote(entry.backup)} || exit 78; mv -f -- ${shQuote(entry.backup)} ${shQuote(entry.remote)}`
          : `rm -f -- ${shQuote(entry.remote)}`;
        const command = syncStatusShell(
          `set -eu; test ! -L ${shQuote(entry.remote)} || exit 74; ${sha256Shell(entry.remote)}; test "$actual" = ${shQuote(entry.publishedDigest)} || exit 73; ${action}`,
          entry.lock,
          "rollback",
        );
        try {
          const rollback = await ssh.exec(hostId, { command, timeoutMs: 10_000 });
          if (rollback.code === 0) {
            currentApplied.delete(entry.remote);
            rolledBack.add(entry.remote);
          } else {
            rollbackErrors.push(`${entry.remote}: ${rollback.stderr || `rollback exited ${rollback.code}`}`);
            uncertain.push(entry);
            retainLocks = true;
          }
        } catch (error) {
          rollbackErrors.push(`${entry.remote}: ${error.message}`);
          uncertain.push(entry);
          retainLocks = true;
        }
      }
      if (rollbackErrors.length) {
        failure = remoteOpsError(
          "SYNC_ROLLBACK_INCOMPLETE",
          `${originalFailure.message}; rollback was incomplete and automated retry is blocked`,
          409,
        );
        failure.causeCode = originalFailure.code;
      }
    }

    if (failure && !retainLocks) {
      try {
        const cleanup = await ssh.exec(hostId, { command: `rm -f -- ${prepared.map((entry) => shQuote(entry.temp)).join(" ")}`, timeoutMs: 10_000 });
        if (cleanup.code !== 0) {
          const cleanupFailure = remoteOpsError("SYNC_CLEANUP_INCOMPLETE", `remote staged-file cleanup failed: ${cleanup.stderr || cleanup.code}`, 502);
          cleanupFailure.causeCode = failure.code;
          failure = cleanupFailure;
          retainLocks = true;
        }
      } catch (error) {
        const cleanupFailure = remoteOpsError("SYNC_CLEANUP_UNKNOWN", `remote staged-file cleanup timed out or failed: ${error.message}`, 503);
        cleanupFailure.causeCode = failure.code;
        failure = cleanupFailure;
        retainLocks = true;
      }
    }

    if (!retainLocks) {
      let released;
      try {
        released = await ssh.exec(hostId, { command: releaseSyncLocksShell(prepared, transactionId), timeoutMs: 10_000 });
      } catch (error) {
        released = { code: -1, stderr: error.message };
      }
      if (released.code !== 0) {
        const releaseFailure = remoteOpsError("SYNC_LOCK_RELEASE_INCOMPLETE", `remote transaction lock release was incomplete: ${released.stderr || released.code}`, 409);
        if (failure) releaseFailure.causeCode = failure.code;
        failure = releaseFailure;
        retainLocks = true;
      } else {
        // 锁释放与状态墓碑清理分两条命令：即使第一条响应丢失，reconcile 仍能凭墓碑幂等收口。
        await ssh.exec(hostId, { command: `rm -f -- ${shQuote(transactionState)}`, timeoutMs: 10_000 }).catch(() => {});
      }
    }

    if (retainLocks) {
      return recoverySyncResult(
        canonicalHome,
        prepared,
        transactionId,
        failure ?? remoteOpsError("SYNC_STATE_UNKNOWN", "remote sync state is unknown", 503),
        [...currentApplied.values()],
        uncertain,
        { ...(rollbackErrors.length ? { rollbackErrors } : {}), ...(failure?.causeCode ? { causeCode: failure.causeCode } : {}), code: failure?.code },
      );
    }

    if (failure) {
      return {
        home: canonicalHome,
        complete: false,
        status: applied.length ? "rolled_back" : "preflight_failed",
        recoveryRequired: false,
        kind: "sync",
        transactionId,
        code: failure.code,
        applied: [],
        uncertain: [],
        backups: [],
        locks: [],
        results: syncResults(prepared, failure, { rolledBack }),
      };
    }

    const results = prepared.map((entry) => ({ ...publicSyncFile(entry), ok: true }));
    return {
      home: canonicalHome,
      complete: true,
      status: "applied",
      recoveryRequired: false,
      kind: "sync",
      transactionId,
      applied: applied.map(publicSyncFile),
      uncertain: [],
      backups: applied.filter((entry) => entry.backup).map((entry) => ({ remote: entry.remote, backup: entry.backup })),
      locks: [],
      results,
    };
  }

  async function reconcileSync(hostId, transactionId) {
    return reconcileRemoteTransaction(ssh, hostId, transactionId, { kind: "sync" });
  }

  return { probe, diagnoseProxy, installCli, planConfigSync, syncConfig, reconcileSync };
}
