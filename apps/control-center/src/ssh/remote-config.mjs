/**
 * 远端配置发布器：复用本机 ProviderStore 的九应用投影规则，但以远端原文件为合并基底。
 * 原始配置和密钥只在服务端内存与 SSH/SFTP 通道内流动，HTTP 只返回路径、体积和备份证据。
 */
import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";

const REMOTE_PROVIDER_APPS = new Set(["claude", "codex", "gemini", "grokbuild", "kimi", "opencode", "openclaw", "hermes"]);
const PROJECT_CONFIG_TARGETS = new Map([
  ["claude::~/.claude/settings.json", ".claude/settings.json"],
  ["codex::~/.codex/config.toml", ".codex/config.toml"],
]);

function remoteConfigError(code, message, httpStatus = 400) {
  return Object.assign(new Error(message), { code, httpStatus });
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function joinPosix(base, relative) {
  const cleanBase = String(base).replace(/\/+$/, "") || "/";
  return cleanBase === "/" ? `/${relative}` : `${cleanBase}/${relative}`;
}

function sha256Shell(path, variable = "actual") {
  return `${variable}=$(if command -v sha256sum >/dev/null 2>&1; then sha256sum ${shQuote(path)} | awk '{print $1}'; elif command -v shasum >/dev/null 2>&1; then shasum -a 256 ${shQuote(path)} | awk '{print $1}'; else exit 75; fi)`;
}

async function canonicalTargetPath(ssh, hostId, remote) {
  const parent = posix.dirname(remote);
  const canonicalParent = await ssh.assertSftpResolvedPathPublic?.(hostId, parent, { allowMissing: true }) ?? parent;
  return joinPosix(canonicalParent, posix.basename(remote));
}

function lockFor(remote, home) {
  const root = joinPosix(home, ".514forge-locks");
  const path = joinPosix(root, createHash("sha256").update(remote).digest("hex"));
  return {
    remote,
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

function releaseLockShell(lock, transactionId) {
  const metadata = [lock.target, lock.base, lock.published, lock.backupMetadata, lock.tempMetadata, lock.kind, lock.scope, lock.changed, lock.status, lock.owner];
  return `test "$(cat ${shQuote(lock.owner)} 2>/dev/null || true)" = ${shQuote(transactionId)} && rm -f -- ${metadata.map(shQuote).join(" ")} && rmdir -- ${shQuote(lock.path)}`;
}

function statusWrappedShell(command, lock, phase) {
  const trapBody = `rc=$?; trap - 0; printf '%s:%s\\n' ${shQuote(phase)} "$rc" > ${shQuote(lock.status)}; exit "$rc"`;
  return `printf '%s\\n' ${shQuote(`${phase}:running`)} > ${shQuote(lock.status)}; trap ${shQuote(trapBody)} 0; ${command}`;
}

function acquireLocksShell(files, transactionId, transactionState, scope) {
  const transactionTrap = `rc=$?; trap - 0; printf '%s:%s\\n' 'acquire' "$rc" > ${shQuote(transactionState)}; exit "$rc"`;
  const commands = [
    "set -u",
    "umask 077",
    `printf '%s\\n' 'acquire:running' > ${shQuote(transactionState)}`,
    `trap ${shQuote(transactionTrap)} 0`,
  ];
  const acquired = [];
  for (const file of files) {
    const lock = file.lock;
    const cleanup = acquired.slice().reverse().map((entry) => releaseLockShell(entry.lock, transactionId)).join(" && ") || ":";
    commands.push(`if mkdir -- ${shQuote(lock.path)}; then :; elif test -d ${shQuote(lock.path)}; then ${cleanup} || exit 82; exit 72; else ${cleanup} || exit 82; exit 79; fi`);
    const metadataEntries = [
      [lock.target, file.remote],
      [lock.base, file.baseDigest],
      [lock.published, file.publishedDigest],
      [lock.backupMetadata, file.backup ?? ""],
      [lock.tempMetadata, file.temp],
      [lock.kind, "provider"],
      [lock.scope, scope ?? ""],
      [lock.changed, file.changed ? "yes" : "no"],
      [lock.status, file.changed ? "prepared" : "unchanged"],
      [lock.owner, transactionId],
    ];
    const metadata = metadataEntries.map(([path, value]) => `printf '%s\\n' ${shQuote(value)} > ${shQuote(path)}`).join(" && ");
    const cleanupCurrent = `rm -f -- ${metadataEntries.map(([path]) => shQuote(path)).join(" ")} && rmdir -- ${shQuote(lock.path)}`;
    commands.push(`if ! { ${metadata}; }; then ${cleanupCurrent} 2>/dev/null || exit 82; ${cleanup} || exit 82; exit 79; fi`);
    acquired.push(file);
  }
  return commands.join("; ");
}

function releaseLocksShell(locks, transactionId, transactionState = null) {
  const commands = ["set -u", ...locks.slice().reverse().map((lock) => `${releaseLockShell(lock, transactionId)} || exit 81`)];
  if (transactionState) commands.push(`rm -f -- ${shQuote(transactionState)}`);
  return commands.join("; ");
}

function publicApplied(file) {
  return { remote: file.remote, bytes: file.bytes, backup: file.backup };
}

function recoveryDetails(files, applied, uncertain) {
  const affected = [...applied, ...uncertain];
  const backups = new Map();
  for (const file of affected) {
    if (file.backup) backups.set(file.backup, { remote: file.remote, backup: file.backup });
  }
  return {
    applied: applied.map(publicApplied),
    uncertain: uncertain.map(publicApplied),
    backups: [...backups.values()],
    locks: files.map((file) => file.lock.path),
  };
}

function verifySnapshotShell(files) {
  const commands = ["set -eu"];
  files.forEach((file, index) => {
    if (file.exists) {
      commands.push(`test ! -L ${shQuote(file.remote)} || exit 74`);
      commands.push(sha256Shell(file.remote, `actual_${index}`));
      commands.push(`test "$actual_${index}" = ${shQuote(file.baseDigest)} || exit 73`);
    } else {
      commands.push(`test ! -L ${shQuote(file.remote)} || exit 74`);
      commands.push(`test ! -e ${shQuote(file.remote)} || exit 73`);
    }
  });
  return commands.join("; ");
}

function recoveryError(code, message, transactionId, details, httpStatus = 409) {
  return Object.assign(remoteConfigError(code, message, httpStatus), {
    recoveryRequired: true,
    retryable: false,
    transactionId,
    recovery: { kind: "provider", transactionId },
    ...details,
  });
}

const RECOVERY_FIELDS = ["target", "base", "published", "backup", "temp", "kind", "scope", "changed", "status"];

function recoveryDiscoveryShell(root, transactionId, transactionState) {
  const fields = RECOVERY_FIELDS.map((field) => `printf '|'; test -f "$lock/${field}" && base64 < "$lock/${field}" | tr -d '\\n' || :`).join("; ");
  return [
    "set -eu",
    "command -v base64 >/dev/null 2>&1 || exit 80",
    `printf 'TX64|'; test -f ${shQuote(transactionState)} && base64 < ${shQuote(transactionState)} | tr -d '\\n' || :; printf '\\n'`,
    `for lock in ${shQuote(root)}/*; do test -d "$lock" || continue; name=${"${lock##*/}"}; case "$name" in ''|*[!0-9a-f]*) continue;; esac; test ${"${#name}"} -eq 64 || continue; test "$(cat "$lock/owner" 2>/dev/null || true)" = ${shQuote(transactionId)} || continue; printf 'LOCK64|%s' "$name"; ${fields}; printf '\\n'; done`,
  ].join("; ");
}

function decodeRecoveryDiscovery(stdout) {
  let transactionStatus = null;
  const locks = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (line.startsWith("TX64|")) {
      const encoded = line.slice(5);
      transactionStatus = encoded ? Buffer.from(encoded, "base64").toString("utf8").trim() : null;
      continue;
    }
    if (!line.startsWith("LOCK64|")) continue;
    const parts = line.split("|");
    if (parts.length !== 2 + RECOVERY_FIELDS.length) continue;
    const entry = { name: parts[1] };
    RECOVERY_FIELDS.forEach((field, index) => {
      entry[field] = parts[index + 2] ? Buffer.from(parts[index + 2], "base64").toString("utf8").replace(/\r?\n$/, "") : "";
    });
    locks.push(entry);
  }
  return { transactionStatus, locks };
}

function settledStatusShell(statusVariable) {
  return `case "$${statusVariable}" in *:running) exit 84;; prepared|unchanged|publish:[0-9]|publish:[0-9][0-9]|publish:[0-9][0-9][0-9]|rollback:[0-9]|rollback:[0-9][0-9]|rollback:[0-9][0-9][0-9]) :;; *) exit 83;; esac`;
}

function actualDigestShell(record, index, resolutionVariable) {
  const actual = `reconcile_actual_${index}`;
  return [
    `if test -L ${shQuote(record.remote)}; then exit 85; elif test -e ${shQuote(record.remote)}; then ${sha256Shell(record.remote, actual)}; else ${actual}=missing; fi`,
    `if test "$${actual}" = ${shQuote(record.baseDigest)}; then ${resolutionVariable}=base; elif test "$${actual}" = ${shQuote(record.publishedDigest)}; then ${resolutionVariable}=published; else exit 85; fi`,
  ].join("; ");
}

function reconcileShell(records, transactionId, transactionState) {
  const commands = [
    "set -eu",
    `transaction_status=$(cat ${shQuote(transactionState)} 2>/dev/null || true)`,
    `case "$transaction_status" in acquire:running|'') exit 84;; acquire:[0-9]|acquire:[0-9][0-9]|acquire:[0-9][0-9][0-9]) :;; *) exit 83;; esac`,
  ];
  records.forEach((record, index) => {
    const lock = record.lock;
    commands.push(`test -d ${shQuote(lock.path)} || exit 87`);
    commands.push(`test "$(cat ${shQuote(lock.owner)} 2>/dev/null || true)" = ${shQuote(transactionId)} || exit 72`);
    const metadata = [
      [lock.target, record.remote],
      [lock.base, record.baseDigest],
      [lock.published, record.publishedDigest],
      [lock.backupMetadata, record.backup ?? ""],
      [lock.tempMetadata, record.temp],
      [lock.kind, record.kind],
      [lock.scope, record.scope ?? ""],
      [lock.changed, record.changed ? "yes" : "no"],
    ];
    for (const [path, expected] of metadata) commands.push(`test "$(cat ${shQuote(path)} 2>/dev/null || true)" = ${shQuote(expected)} || exit 83`);
    commands.push(`reconcile_status_${index}=$(cat ${shQuote(lock.status)} 2>/dev/null || true)`);
    commands.push(settledStatusShell(`reconcile_status_${index}`));
    commands.push(actualDigestShell(record, index, `resolution_${index}`));
    commands.push(`printf 'RESULT|${index}|%s\\n' "$resolution_${index}"`);
  });
  records.forEach((record, index) => {
    commands.push(`reconcile_status_${index}=$(cat ${shQuote(record.lock.status)} 2>/dev/null || true)`);
    commands.push(settledStatusShell(`reconcile_status_${index}`));
    commands.push(actualDigestShell(record, index, `resolution_check_${index}`));
  });
  for (const record of records.slice().reverse()) {
    commands.push(`rm -f -- ${shQuote(record.temp)}`);
    commands.push(`${releaseLockShell(record.lock, transactionId)} || exit 81`);
  }
  commands.push(`rm -f -- ${shQuote(transactionState)}`);
  return commands.join("; ");
}

function reconcileFailure(errorFactory, result, transactionId, details) {
  const messages = new Map([
    [72, ["REMOTE_CONFLICT", "a recovery lock is now owned by another transaction", 409]],
    [75, ["REMOTE_RECOVERY_HASH_UNAVAILABLE", "remote host has no SHA-256 utility for recovery", 502]],
    [80, ["REMOTE_RECOVERY_BASE64_UNAVAILABLE", "remote host has no base64 utility for recovery metadata", 502]],
    [81, ["REMOTE_RECOVERY_RELEASE_INCOMPLETE", "verified recovery lock release was incomplete", 409]],
    [83, ["REMOTE_RECOVERY_METADATA_MISMATCH", "remote recovery metadata failed integrity validation", 409]],
    [84, ["REMOTE_RECOVERY_PENDING", "the remote transaction is still running; recovery remains blocked", 409]],
    [85, ["REMOTE_RECOVERY_DRIFT", "a recovery target no longer matches its base or published digest", 409]],
    [87, ["REMOTE_RECOVERY_CHANGED", "remote recovery locks changed during reconciliation", 409]],
  ]);
  const [code, message, status] = messages.get(result.code) ?? ["REMOTE_RECOVERY_FAILED", `remote recovery reconcile failed: ${result.stderr || result.code}`, 502];
  return Object.assign(errorFactory(code, message, status), {
    recoveryRequired: true,
    retryable: false,
    transactionId,
    ...details,
  });
}

function scopedRecoveryError(kind, code, message, transactionId, details, httpStatus = 409) {
  return Object.assign(remoteConfigError(code, message, httpStatus), {
    recoveryRequired: true,
    retryable: false,
    transactionId,
    recovery: { kind, transactionId },
    ...details,
  });
}

export async function reconcileRemoteTransaction(ssh, hostId, transactionId, { kind, projectPath = null } = {}) {
  const normalizedId = String(transactionId ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedId)) {
    throw remoteConfigError("REMOTE_RECOVERY_TRANSACTION_INVALID", "a valid recovery transactionId is required", 400);
  }
  if (kind !== "provider" && kind !== "graph" && kind !== "sync") {
    throw remoteConfigError("REMOTE_RECOVERY_KIND_INVALID", "recovery kind must be provider, graph, or sync", 400);
  }
  const home = await resolveHome(ssh, hostId);
  const scope = projectPath
    ? await ssh.assertSftpResolvedPathPublic?.(hostId, projectPath) ?? projectPath
    : "";
  const root = joinPosix(home, ".514forge-locks");
  const transactionState = joinPosix(root, `transaction-${normalizedId}.status`);
  let discovered;
  try {
    discovered = await ssh.exec(hostId, {
      command: recoveryDiscoveryShell(root, normalizedId, transactionState),
      timeoutMs: 10_000,
    });
  } catch (error) {
    if (error?.code !== "SSH_EXEC_TIMEOUT") throw error;
    throw scopedRecoveryError(
      kind,
      "REMOTE_RECOVERY_PROBE_UNKNOWN",
      "remote recovery probe timed out; lock state remains unchanged",
      normalizedId,
      { applied: [], uncertain: [], backups: [], locks: [] },
      503,
    );
  }
  if (discovered.code !== 0) {
    const error = reconcileFailure(remoteConfigError, discovered, normalizedId, { applied: [], uncertain: [], backups: [], locks: [] });
    error.recovery = { kind, transactionId: normalizedId };
    throw error;
  }
  const parsed = decodeRecoveryDiscovery(discovered.stdout);
  if (!parsed.locks.length) {
    if (parsed.transactionStatus === "acquire:running") {
      throw scopedRecoveryError(
        kind,
        "REMOTE_RECOVERY_PENDING",
        "the remote transaction is still running; recovery remains blocked",
        normalizedId,
        { applied: [], uncertain: [], backups: [], locks: [] },
      );
    }
    if (/^acquire:\d{1,3}$/.test(parsed.transactionStatus ?? "")) {
      // Locks are the write exclusion primitive. A settled acquisition with no
      // remaining owner locks means release committed and only state cleanup
      // may have failed or timed out; returning success makes recovery idempotent.
      await ssh.exec(hostId, { command: `rm -f -- ${shQuote(transactionState)}`, timeoutMs: 10_000 }).catch(() => {});
      return { kind, transactionId: normalizedId, recoveryRequired: false, released: [] };
    }
    throw remoteConfigError("REMOTE_RECOVERY_NOT_FOUND", `no ${kind} recovery locks found for transaction ${normalizedId}`, 404);
  }
  const lockPaths = parsed.locks.map((item) => joinPosix(root, item.name));
  const records = [];
  for (const entry of parsed.locks) {
    const remote = await canonicalTargetPath(ssh, hostId, entry.target);
    if (remote !== entry.target || entry.name !== createHash("sha256").update(remote).digest("hex")) {
      throw scopedRecoveryError(
        kind,
        "REMOTE_RECOVERY_METADATA_MISMATCH",
        "remote recovery target failed canonical lock validation",
        normalizedId,
        { applied: [], uncertain: [], backups: [], locks: lockPaths },
      );
    }
    if (entry.kind !== kind || entry.scope !== scope || !/^(?:missing|[a-f0-9]{64})$/i.test(entry.base) || !/^[a-f0-9]{64}$/i.test(entry.published)) {
      throw scopedRecoveryError(
        kind,
        "REMOTE_RECOVERY_METADATA_MISMATCH",
        `remote ${kind} recovery metadata does not match the requested scope`,
        normalizedId,
        { applied: [], uncertain: [], backups: [], locks: lockPaths },
      );
    }
    const expectedTemp = `${remote}.514forge-${normalizedId}.tmp`;
    const expectedBackup = entry.base === "missing" ? "" : `${remote}.514forge-backup-${normalizedId}`;
    if (entry.temp !== expectedTemp || entry.backup !== expectedBackup || !/^(?:yes|no)$/.test(entry.changed) || (kind !== "provider" && entry.changed !== "yes")) {
      throw scopedRecoveryError(
        kind,
        "REMOTE_RECOVERY_METADATA_MISMATCH",
        `remote ${kind} recovery artifact paths failed transaction binding`,
        normalizedId,
        { applied: [], uncertain: [], backups: [], locks: lockPaths },
      );
    }
    records.push({
      remote,
      baseDigest: entry.base,
      publishedDigest: entry.published,
      backup: entry.backup || null,
      temp: entry.temp,
      kind: entry.kind,
      scope: entry.scope,
      changed: entry.changed === "yes",
      status: entry.status,
      lock: lockFor(remote, home),
    });
  }
  records.sort((left, right) => left.remote < right.remote ? -1 : left.remote > right.remote ? 1 : 0);
  let result;
  try {
    result = await ssh.exec(hostId, { command: reconcileShell(records, normalizedId, transactionState), timeoutMs: 20_000 });
  } catch (error) {
    if (error?.code !== "SSH_EXEC_TIMEOUT") throw error;
    throw scopedRecoveryError(
      kind,
      "REMOTE_RECOVERY_RECONCILE_UNKNOWN",
      "remote recovery reconcile timed out; lock release state is unknown and automated retry remains blocked",
      normalizedId,
      recoveryDetails(records, [], records),
      503,
    );
  }
  if (result.code !== 0) {
    const error = reconcileFailure(remoteConfigError, result, normalizedId, recoveryDetails(records, [], records));
    error.recovery = { kind, transactionId: normalizedId };
    throw error;
  }
  const resolutions = new Map();
  for (const line of String(result.stdout ?? "").split(/\r?\n/)) {
    const match = line.match(/^RESULT\|(\d+)\|(base|published)$/);
    if (match) resolutions.set(Number(match[1]), match[2]);
  }
  if (resolutions.size !== records.length) {
    throw scopedRecoveryError(
      kind,
      "REMOTE_RECOVERY_RESULT_INCOMPLETE",
      "remote recovery completed without a complete digest resolution ledger",
      normalizedId,
      recoveryDetails(records, [], records),
    );
  }
  return {
    kind,
    transactionId: normalizedId,
    recoveryRequired: false,
    released: records.map((record, index) => ({ remote: record.remote, resolution: resolutions.get(index) })),
  };
}

function previewRelativePath(app, shownPath) {
  const shown = String(shownPath ?? "").replace(/\\/g, "/");
  if (shown.startsWith("~/")) return shown.slice(2);
  if (app === "hermes" && /\/hermes\/config\.yaml$/i.test(shown)) return ".hermes/config.yaml";
  throw remoteConfigError("REMOTE_PROVIDER_PATH_UNSUPPORTED", `provider projection is not portable to a remote POSIX host: ${shownPath}`, 422);
}

function remotePathFor(app, shownPath, home, projectPath = null) {
  const projectRelative = projectPath ? PROJECT_CONFIG_TARGETS.get(`${app}::${String(shownPath).replace(/\\/g, "/")}`) : null;
  return joinPosix(projectRelative ? projectPath : home, projectRelative ?? previewRelativePath(app, shownPath));
}

async function resolveHome(ssh, hostId) {
  const result = await ssh.exec(hostId, { command: 'printf %s "$HOME"', timeoutMs: 10_000 });
  const home = String(result.stdout ?? "").trim();
  if (!home.startsWith("/")) throw remoteConfigError("REMOTE_CONFIG_HOME_UNKNOWN", "cannot resolve remote $HOME", 502);
  await ssh.update(hostId, { home }).catch(() => {});
  const canonical = await ssh.assertSftpResolvedPathPublic?.(hostId, home) ?? home;
  return canonical.replace(/\/+$/, "") || "/";
}

async function readOptionalRaw(ssh, hostId, remote) {
  try {
    const result = await ssh.sftpReadRaw(hostId, remote);
    return { exists: true, content: result.content };
  } catch (error) {
    if (error?.code !== "SFTP_FAILED") throw error;
    const stat = await ssh.exec(hostId, {
      command: `if [ -f ${shQuote(remote)} ]; then printf yes; else printf no; fi`,
      timeoutMs: 10_000,
    });
    if (String(stat.stdout).trim() === "yes") throw error;
    return { exists: false, content: "" };
  }
}

function publicPlan(plan) {
  return {
    app: plan.app,
    provider: plan.provider,
    target: plan.target,
    planRevision: plan.planRevision,
    files: plan.files.map(({ content, baseContent, baseDigest, publishedDigest, ...file }) => file),
  };
}

function revisionOf(plan) {
  return createHash("sha256").update(JSON.stringify({
    app: plan.app,
    providerId: plan.provider?.id ?? null,
    target: plan.target,
    files: plan.files.map((file) => ({
      path: file.path,
      remote: file.remote,
      exists: file.exists,
      baseDigest: file.baseDigest,
      publishedDigest: file.publishedDigest,
    })),
  })).digest("hex");
}

export function createRemoteConfigService(ssh, providerStore, { eventStore = null } = {}) {
  if (!providerStore?.previewSwitch) throw new TypeError("providerStore.previewSwitch is required");

  async function buildProviderPlan(hostId, app, providerId, { projectPath = null } = {}) {
    const normalizedApp = String(app ?? "");
    if (!REMOTE_PROVIDER_APPS.has(normalizedApp)) {
      throw remoteConfigError(
        "REMOTE_PROVIDER_APP_UNSUPPORTED",
        normalizedApp === "claude-desktop"
          ? "Claude Desktop cannot run on a headless remote POSIX host"
          : `remote provider app is unsupported: ${normalizedApp}`,
        422,
      );
    }
    const home = await resolveHome(ssh, hostId);
    const resolvedProjectPath = projectPath
      ? await ssh.assertSftpResolvedPathPublic?.(hostId, projectPath) ?? projectPath
      : null;
    const seed = await providerStore.previewSwitch(normalizedApp, { id: String(providerId ?? "") }, {
      reveal: true,
      baseFiles: {},
    });
    const baseFiles = {};
    const remoteBases = new Map();
    for (const file of seed.files ?? []) {
      if (file.removed) throw remoteConfigError("REMOTE_PROVIDER_REMOVE_UNSUPPORTED", `remote projection would remove ${file.path}`, 422);
      const requestedRemote = remotePathFor(normalizedApp, file.path, home, resolvedProjectPath);
      ssh.assertSftpPathPublic?.(hostId, requestedRemote);
      const remote = await canonicalTargetPath(ssh, hostId, requestedRemote);
      const base = await readOptionalRaw(ssh, hostId, remote);
      baseFiles[file.path] = base.content;
      remoteBases.set(file.path, { remote, ...base });
    }
    const projected = await providerStore.previewSwitch(normalizedApp, { id: String(providerId ?? "") }, {
      reveal: true,
      baseFiles,
    });
    const files = (projected.files ?? []).map((file) => {
      if (file.removed || typeof file.content !== "string") {
        throw remoteConfigError("REMOTE_PROVIDER_OUTPUT_INVALID", `remote projection returned an unsupported operation for ${file.path}`, 422);
      }
      const base = remoteBases.get(file.path);
      if (!base) throw remoteConfigError("REMOTE_PROVIDER_OUTPUT_DRIFT", `remote projection target changed during planning: ${file.path}`, 409);
      return {
        path: file.path,
        remote: base.remote,
        exists: base.exists,
        bytes: Buffer.byteLength(file.content),
        changed: file.content !== base.content,
        containsCredentialMaterial: /(?:api[_-]?key|auth|token|credential)/i.test(file.content),
        content: file.content,
        baseContent: base.content,
        baseDigest: base.exists ? createHash("sha256").update(base.content).digest("hex") : "missing",
        publishedDigest: createHash("sha256").update(file.content).digest("hex"),
      };
    });
    const remotes = new Set();
    for (const file of files) {
      if (remotes.has(file.remote)) {
        throw remoteConfigError("REMOTE_PROVIDER_OUTPUT_DRIFT", `multiple provider outputs resolve to the same remote target: ${file.remote}`, 409);
      }
      remotes.add(file.remote);
    }
    const plan = {
      app: normalizedApp,
      provider: projected.provider,
      target: { hostId, home, projectPath: resolvedProjectPath || null },
      files,
    };
    plan.planRevision = revisionOf(plan);
    return plan;
  }

  async function planProvider(hostId, app, providerId, options = {}) {
    return publicPlan(await buildProviderPlan(hostId, app, providerId, options));
  }

  async function applyProvider(hostId, app, providerId, options = {}) {
    const plan = await buildProviderPlan(hostId, app, providerId, options);
    if (!/^[a-f0-9]{64}$/i.test(String(options.planRevision ?? "")) || options.planRevision !== plan.planRevision) {
      throw remoteConfigError(
        "REMOTE_PROVIDER_PLAN_STALE",
        "remote provider plan changed after confirmation; refresh the plan and confirm again",
        409,
      );
    }
    const transactionId = options.transactionId ?? randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(transactionId)) {
      throw remoteConfigError("REMOTE_RECOVERY_TRANSACTION_INVALID", "a valid transactionId is required", 400);
    }
    const files = plan.files.slice()
      .sort((left, right) => left.remote < right.remote ? -1 : left.remote > right.remote ? 1 : 0)
      .map((file) => ({
        ...file,
        temp: `${file.remote}.514forge-${transactionId}.tmp`,
        backup: file.exists ? `${file.remote}.514forge-backup-${transactionId}` : null,
        lock: lockFor(file.remote, plan.target.home),
      }));
    const applied = [];
    let failure = null;
    let retainLocks = false;
    let locksHeld = false;
    let transactionState = null;

    if (files.length) {
      const lockRoot = files[0].lock.root;
      transactionState = joinPosix(lockRoot, `transaction-${transactionId}.status`);
      const lockRootResult = await ssh.exec(hostId, { command: `mkdir -p -- ${shQuote(lockRoot)} && chmod 700 ${shQuote(lockRoot)}`, timeoutMs: 10_000 });
      if (lockRootResult.code !== 0) throw remoteConfigError("REMOTE_CONFIG_LOCK_FAILED", `cannot create remote transaction lock root: ${lockRootResult.stderr || lockRootResult.code}`, 502);

      let acquired;
      try {
        acquired = await ssh.exec(hostId, {
          command: acquireLocksShell(files, transactionId, transactionState, plan.target.projectPath ?? ""),
          timeoutMs: 10_000,
        });
      } catch (error) {
        if (error?.code !== "SSH_EXEC_TIMEOUT") throw error;
        throw recoveryError(
          "REMOTE_CONFIG_LOCK_UNKNOWN",
          "remote transaction lock acquisition timed out; lock ownership is unknown and automated retry is blocked",
          transactionId,
          recoveryDetails(files, [], []),
          503,
        );
      }
      if (acquired.code === 72) {
        await ssh.exec(hostId, { command: `rm -f -- ${shQuote(transactionState)}`, timeoutMs: 10_000 }).catch(() => {});
        throw remoteConfigError("REMOTE_CONFLICT", "another remote transaction already owns one or more config targets", 409);
      }
      if (acquired.code === 82) {
        throw recoveryError(
          "REMOTE_CONFIG_LOCK_RELEASE_INCOMPLETE",
          "remote lock conflict cleanup was incomplete; manual recovery is required and automated retry is blocked",
          transactionId,
          recoveryDetails(files, [], []),
        );
      }
      if (acquired.code === 79) {
        await ssh.exec(hostId, { command: `rm -f -- ${shQuote(transactionState)}`, timeoutMs: 10_000 }).catch(() => {});
        throw remoteConfigError("REMOTE_CONFIG_LOCK_FAILED", "cannot persist remote transaction lock ownership", 502);
      }
      if (acquired.code !== 0) throw remoteConfigError("REMOTE_CONFIG_LOCK_FAILED", `cannot acquire remote transaction locks: ${acquired.stderr || acquired.code}`, 502);
      locksHeld = true;

      const parents = [...new Set(files.map((file) => posix.dirname(file.remote)))].sort();
      let mkdir = null;
      try {
        mkdir = await ssh.exec(hostId, { command: `mkdir -p -- ${parents.map(shQuote).join(" ")}`, timeoutMs: 10_000 });
      } catch (error) {
        failure = error;
      }
      if (!failure && mkdir.code !== 0) failure = remoteConfigError("REMOTE_CONFIG_MKDIR_FAILED", `cannot create remote config directories: ${mkdir.stderr || mkdir.code}`, 502);

      let snapshot = null;
      if (!failure) {
        try {
          snapshot = await ssh.exec(hostId, { command: verifySnapshotShell(files), timeoutMs: 20_000 });
        } catch (error) {
          failure = error;
        }
      }
      if (snapshot?.code === 73) {
        failure = remoteConfigError("REMOTE_CONFIG_CONFLICT", "one or more remote configs changed before the transaction could publish", 409);
      } else if (snapshot?.code === 74) {
        failure = remoteConfigError("REMOTE_CONFIG_SYMLINK", "refusing to publish through a symlinked remote config", 409);
      } else if (snapshot?.code === 75) {
        failure = remoteConfigError("REMOTE_CONFIG_HASH_UNAVAILABLE", "remote host has no SHA-256 utility", 502);
      } else if (snapshot && snapshot.code !== 0) {
        failure = remoteConfigError("REMOTE_CONFIG_PREFLIGHT_FAILED", `cannot verify the locked remote snapshot: ${snapshot.stderr || snapshot.code}`, 502);
      }
    }

    try {
      for (const file of files.filter((entry) => entry.changed)) {
        if (failure) break;
        await ssh.sftpWrite(hostId, file.temp, file.content, { mode: 0o600, flags: "wx" });
        const currentCas = file.exists
          ? `test ! -L ${shQuote(file.remote)} || exit 74; ${sha256Shell(file.remote)}; test "$actual" = ${shQuote(file.baseDigest)} || exit 73`
          : `test ! -L ${shQuote(file.remote)} || exit 74; test ! -e ${shQuote(file.remote)} || exit 73`;
        const backup = file.backup
          ? `test ! -e ${shQuote(file.backup)} || exit 77; cp -p -- ${shQuote(file.remote)} ${shQuote(file.backup)}`
          : ":";
        let publish;
        try {
          publish = await ssh.exec(hostId, {
            command: statusWrappedShell([
              "set -eu",
              currentCas,
              sha256Shell(file.temp, "staged"),
              `test "$staged" = ${shQuote(file.publishedDigest)} || exit 76`,
              backup,
              `chmod 600 ${shQuote(file.temp)}`,
              `mv -f -- ${shQuote(file.temp)} ${shQuote(file.remote)}`,
            ].join("; "), file.lock, "publish"),
            timeoutMs: 20_000,
          });
        } catch (error) {
          if (error?.code !== "SSH_EXEC_TIMEOUT") throw error;
          retainLocks = true;
          throw recoveryError(
            "REMOTE_CONFIG_COMMIT_UNKNOWN",
            `remote publish timed out for ${file.remote}; commit state is unknown, manual recovery is required, and automated retry is blocked`,
            transactionId,
            recoveryDetails(files, applied, [file]),
            503,
          );
        }
        if (publish.code !== 0) {
          await ssh.exec(hostId, { command: `rm -f -- ${shQuote(file.temp)}`, timeoutMs: 10_000 }).catch(() => {});
          if (publish.code === 73) throw remoteConfigError("REMOTE_CONFIG_CONFLICT", `remote config changed during publish: ${file.remote}`, 409);
          if (publish.code === 74) throw remoteConfigError("REMOTE_CONFIG_SYMLINK", `refusing to replace a symlinked remote config: ${file.remote}`, 409);
          if (publish.code === 75) throw remoteConfigError("REMOTE_CONFIG_HASH_UNAVAILABLE", "remote host has no SHA-256 utility", 502);
          if (publish.code === 76) throw remoteConfigError("REMOTE_CONFIG_STAGING_MISMATCH", `uploaded remote config digest mismatch: ${file.remote}`, 502);
          if (publish.code === 77) throw remoteConfigError("REMOTE_CONFIG_BACKUP_CONFLICT", `remote backup path already exists: ${file.backup}`, 409);
          throw remoteConfigError("REMOTE_CONFIG_PUBLISH_FAILED", `cannot publish ${file.remote}: ${publish.stderr || publish.code}`, 502);
        }
        applied.push(file);
      }
    } catch (error) {
      failure = error;
      if (!error?.recoveryRequired) {
        const rollbackErrors = [];
        const rollbackUncertain = [];
        for (const file of applied.slice().reverse()) {
          const rollbackAction = file.exists
            ? `test -f ${shQuote(file.backup)} && test ! -L ${shQuote(file.backup)} || exit 78; mv -f -- ${shQuote(file.backup)} ${shQuote(file.remote)}`
            : `rm -f -- ${shQuote(file.remote)}`;
          const command = statusWrappedShell(
            `set -eu; test ! -L ${shQuote(file.remote)} || exit 74; ${sha256Shell(file.remote)}; test "$actual" = ${shQuote(file.publishedDigest)} || exit 73; ${rollbackAction}`,
            file.lock,
            "rollback",
          );
          try {
            const result = await ssh.exec(hostId, { command, timeoutMs: 10_000 });
            if (result.code !== 0) {
              rollbackErrors.push(`${file.remote}: ${result.stderr || result.code}`);
              rollbackUncertain.push(file);
            }
          } catch (rollbackError) {
            rollbackErrors.push(`${file.remote}: ${rollbackError.message}`);
            rollbackUncertain.push(file);
          }
        }
        if (rollbackErrors.length) {
          retainLocks = true;
          failure = recoveryError(
            "REMOTE_CONFIG_ROLLBACK_INCOMPLETE",
            `${error.message}; rollback was incomplete, manual recovery is required, and automated retry is blocked`,
            transactionId,
            recoveryDetails(files, applied, rollbackUncertain),
          );
          failure.rollbackErrors = rollbackErrors;
        }
      }
    }

    if (locksHeld && !retainLocks) {
      let released;
      try {
        released = await ssh.exec(hostId, {
          command: releaseLocksShell(files.map((file) => file.lock), transactionId, transactionState),
          timeoutMs: 10_000,
        });
      } catch (error) {
        released = { code: -1, stderr: error.message };
      }
      if (released.code !== 0) {
        const releaseFailure = recoveryError(
          "REMOTE_CONFIG_LOCK_RELEASE_INCOMPLETE",
          `remote transaction lock release was incomplete (${released.stderr || released.code}); manual recovery is required and automated retry is blocked`,
          transactionId,
          recoveryDetails(files, applied, []),
        );
        if (failure) releaseFailure.causeCode = failure.code;
        failure = releaseFailure;
      }
    }
    if (failure) throw failure;
    await eventStore?.emit("provider.remote_switch", {
      hostId,
      projectPath: plan.target.projectPath,
      app: plan.app,
      providerId: plan.provider.id,
      files: applied.map((file) => file.remote),
    }).catch(() => {});
    return {
      ...publicPlan(plan),
      transactionId,
      applied: applied.map(publicApplied),
      unchanged: files.filter((file) => !file.changed).map((file) => file.remote),
    };
  }

  async function reconcileProvider(hostId, transactionId, { projectPath = null } = {}) {
    return reconcileRemoteTransaction(ssh, hostId, transactionId, { kind: "provider", projectPath });
  }

  return { planProvider, applyProvider, reconcileProvider };
}
