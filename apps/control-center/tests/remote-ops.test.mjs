/**
 * remote-ops 契约测试（v41 波一）：探测解析 / CLI 安装 / 配置同步 plan+执行 / 路由状态码与门闸。
 * 不连网：ssh service 用假件；路由用收集式假 router + 真 remote-gates（同 pty 测试范式）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRemoteOps, parseProbeOutput, parseProxyProbeOutput } from "../src/ssh/remote-ops.mjs";
import { registerSshRoutes, setSshServiceForTest, setRemoteOpsForTest } from "../src/ssh/routes.mjs";
import { createRemoteGateService } from "../src/security/remote-gates.mjs";

const PROBE_FIXTURE = [
  "OS|Linux x86_64 6.8.0-51-generic",
  "HOST|lanniny-45",
  "SHELL|/bin/bash",
  "HOME|/home/lanniny",
  "DISK|100G total 42G free",
  "MEM|3.2Gi / 7.6Gi",
  "CPU|8|12.5",
  "MEMSTAT|8160437862|3435973837|42.1",
  "DISKSTAT|107374182400|62277025792|58",
  "LOAD|0.31|0.25|0.20",
  "UPTIME|86461",
  "PROCS|241",
  "NET|123456789|98765432",
  "CLI|claude|yes|claude 2.1.3 (Claude Code)",
  "CLI|codex|no||",
  "CLI|kimi|yes|kimi-code 0.5.1",
].join("\n");

test("parseProbeOutput: 行协议解析与版本提取", () => {
  const probe = parseProbeOutput(PROBE_FIXTURE);
  assert.equal(probe.os, "Linux x86_64 6.8.0-51-generic");
  assert.equal(probe.hostname, "lanniny-45");
  assert.equal(probe.shell, "/bin/bash");
  assert.equal(probe.home, "/home/lanniny");
  assert.equal(probe.disk, "100G total 42G free");
  assert.equal(probe.memory, "3.2Gi / 7.6Gi");
  assert.deepEqual(probe.metrics.cpu, { cores: 8, usagePercent: 12.5 });
  assert.deepEqual(probe.metrics.memory, { totalBytes: 8160437862, usedBytes: 3435973837, usagePercent: 42.1 });
  assert.deepEqual(probe.metrics.disk, { totalBytes: 107374182400, usedBytes: 62277025792, usagePercent: 58 });
  assert.deepEqual(probe.metrics.load, { one: 0.31, five: 0.25, fifteen: 0.2 });
  assert.equal(probe.metrics.uptimeSeconds, 86461);
  assert.equal(probe.metrics.processes, 241);
  assert.deepEqual(probe.metrics.network, { rxBytes: 123456789, txBytes: 98765432 });
  const claude = probe.clis.find((cli) => cli.id === "claude");
  assert.equal(claude.installed, true);
  assert.equal(claude.version, "2.1.3");
  const codex = probe.clis.find((cli) => cli.id === "codex");
  assert.equal(codex.installed, false);
  assert.equal(codex.version, null);
  const kimi = probe.clis.find((cli) => cli.id === "kimi");
  assert.equal(kimi.version, "0.5.1");
  // 未在 fixture 出现的 CLI 不进矩阵（矩阵只覆盖脚本实际输出的项）；未知 id 忽略
  assert.ok(!probe.clis.some((cli) => cli.id === "not-a-tool"));
});

test("parseProbeOutput: 缺失或越界指标保持 null，不把异常文本伪装成状态", () => {
  const probe = parseProbeOutput([
    "CPU|0|101",
    "MEMSTAT|-1|oops|NaN",
    "DISKSTAT|Infinity|12|-3",
    "LOAD|bad|0.5|-1",
    "UPTIME|-2",
    "PROCS|Infinity",
    "NET|-1|oops",
  ].join("\n"));
  assert.deepEqual(probe.metrics.cpu, { cores: null, usagePercent: null });
  assert.deepEqual(probe.metrics.memory, { totalBytes: null, usedBytes: null, usagePercent: null });
  assert.deepEqual(probe.metrics.disk, { totalBytes: null, usedBytes: 12, usagePercent: null });
  assert.deepEqual(probe.metrics.load, { one: null, five: 0.5, fifteen: null });
  assert.equal(probe.metrics.uptimeSeconds, null);
  assert.equal(probe.metrics.processes, null);
  assert.deepEqual(probe.metrics.network, { rxBytes: null, txBytes: null });
});

test("parseProxyProbeOutput: 超长 URL userinfo 必须先完整解析脱敏再限长", () => {
  const username = "operator".repeat(80);
  const password = "p@ssword".repeat(80);
  const proxy = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@proxy.example:7890/path`;
  const result = parseProxyProbeOutput(`ENV|HTTPS_PROXY|${proxy}`);
  const value = result.environment[0]?.value ?? "";
  assert.ok(value.length <= 500);
  assert.match(value, /^http:\/\/redacted:redacted@proxy\.example:7890\/path/);
  assert.doesNotMatch(value, /operator|p%40ssword|p@ssword/);
});

function fakeSsh({ execImpl, updateCalls = [], writes = [], files = {} } = {}) {
  return {
    exec: execImpl ?? (async () => ({ code: 0, stdout: "", stderr: "" })),
    async update(id, fields) { updateCalls.push({ id, fields }); return { id, ...fields }; },
    async sftpReadRaw(id, path) {
      if (!(path in files)) throw Object.assign(new Error("missing"), { code: "SFTP_FAILED" });
      return { content: files[path], truncated: false };
    },
    async sftpWrite(id, path, content, options) { writes.push({ id, path, content, options }); return { ok: true, bytes: Buffer.byteLength(content) }; },
  };
}

test("remoteOps.probe: 结构化回传 + 实测 home 回写台账", async () => {
  const updateCalls = [];
  const ssh = fakeSsh({ execImpl: async () => ({ code: 0, stdout: PROBE_FIXTURE, stderr: "" }), updateCalls });
  const ops = createRemoteOps(ssh, { localHome: "/nonexistent" });
  const probe = await ops.probe("h1");
  assert.equal(probe.home, "/home/lanniny");
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0].fields, { home: "/home/lanniny" });
  // 探测非零退出：如实 502 风格错误
  const failing = createRemoteOps(fakeSsh({ execImpl: async () => ({ code: 1, stdout: "", stderr: "boom" }) }), { localHome: "/nonexistent" });
  await assert.rejects(() => failing.probe("h1"), { code: "REMOTE_PROBE_FAILED" });
});

test("remoteOps.installCli: 未知 toolId 404；npm 通道命令拼装与结果回传", async () => {
  const seen = [];
  const ssh = fakeSsh({
    execImpl: async (id, { command }) => { seen.push(command); return { code: 0, stdout: "added 1 package", stderr: "" }; },
  });
  const ops = createRemoteOps(ssh, { localHome: "/nonexistent" });
  await assert.rejects(() => ops.installCli("h1", "not-a-tool"), { code: "REMOTE_TOOL_UNKNOWN" });
  const result = await ops.installCli("h1", "codex", { platform: "linux" });
  assert.equal(result.ok, true);
  assert.equal(result.display, "npm i -g @openai/codex@latest");
  assert.match(seen[0], /^npm install -g @openai\/codex@latest <\/dev\/null$/);
  // 非零退出如实 ok:false（不伪造成功）
  const failing = createRemoteOps(fakeSsh({ execImpl: async () => ({ code: 3, stdout: "", stderr: "EACCES" }) }), { localHome: "/nonexistent" });
  const failed = await failing.installCli("h1", "codex", { platform: "linux" });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 3);
});

test("remoteOps.planConfigSync: exists/size/containsSecrets 三态", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-ops-plan-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".codex"), { recursive: true });
  await writeFile(join(dir, ".codex", "config.toml"), 'model = "gpt-5"\n', "utf8");
  await mkdir(join(dir, ".kimi-code"), { recursive: true });
  await writeFile(join(dir, ".kimi-code", "config.toml"), 'api_key = "sk-1234567890abcdef1234567890abcdef"\n', "utf8");
  const ops = createRemoteOps(fakeSsh(), { localHome: dir });
  const { files } = await ops.planConfigSync();
  const codex = files.find((file) => file.id === "codex-config");
  assert.equal(codex.exists, true);
  assert.ok(codex.size > 0);
  assert.equal(codex.containsSecrets, false);
  assert.match(codex.digest, /^[a-f0-9]{64}$/);
  const kimi = files.find((file) => file.id === "kimi-config");
  assert.equal(kimi.exists, true);
  assert.equal(kimi.containsSecrets, true); // api_key 字面量被检出——前端红字默认不勾
  const claude = files.find((file) => file.id === "claude-settings");
  assert.equal(claude.exists, false);
});

test("remoteOps.syncConfig: 校验链 + mkdir/sftpWrite 流程 + 本机缺失如实失败", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-ops-sync-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".codex"), { recursive: true });
  await writeFile(join(dir, ".codex", "config.toml"), 'model = "gpt-5"\n', "utf8");
  const writes = [];
  const commands = [];
  const ssh = fakeSsh({
    execImpl: async (id, { command }) => {
      commands.push(command);
      if (command.includes("$HOME")) return { code: 0, stdout: "/root", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    writes,
  });
  const ops = createRemoteOps(ssh, { localHome: dir });
  await assert.rejects(() => ops.syncConfig("h1", []), { code: "SYNC_FILES_REQUIRED" });
  await assert.rejects(() => ops.syncConfig("h1", ["codex-config"]), { code: "SYNC_PLAN_REQUIRED" });
  await assert.rejects(() => ops.syncConfig("h1", [{ id: "nope", digest: "0".repeat(64) }]), { code: "SYNC_FILE_UNKNOWN" });
  const plan = await ops.planConfigSync();
  const codexPlan = plan.files.find((file) => file.id === "codex-config");
  const result = await ops.syncConfig("h1", [{ id: codexPlan.id, digest: codexPlan.digest }]);
  assert.equal(result.home, "/root");
  const okEntry = result.results.find((entry) => entry.id === "codex-config");
  assert.equal(okEntry.ok, true);
  assert.equal(okEntry.remote, "/root/.codex/config.toml");
  assert.equal(writes.length, 1);
  assert.match(writes[0].path, /^\/root\/\.codex\/config\.toml\.514forge-[\w-]+\.tmp$/);
  assert.equal(writes[0].content, 'model = "gpt-5"\n');
  assert.deepEqual(writes[0].options, { mode: 0o600, flags: "wx" });
  assert.ok(commands.some((command) => command.includes("mkdir -p -- '/root/.codex'")));
  assert.ok(commands.some((command) => command.includes("staged=") && command.includes("mv -f --")));
  assert.equal(result.complete, true);
  assert.equal(result.status, "applied");
});

test("remoteOps.syncConfig: plan 后本机内容或秘密状态变化必须重新确认", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-ops-stale-plan-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".codex"), { recursive: true });
  const path = join(dir, ".codex", "config.toml");
  await writeFile(path, 'model = "gpt-5"\n', "utf8");
  const ops = createRemoteOps(fakeSsh(), { localHome: dir });
  const first = (await ops.planConfigSync()).files.find((file) => file.id === "codex-config");
  await writeFile(path, 'api_key = "sk-1234567890abcdef1234567890abcdef"\n', "utf8");
  await assert.rejects(() => ops.syncConfig("h1", [{ id: first.id, digest: first.digest }]), {
    code: "SYNC_PLAN_STALE",
    httpStatus: 409,
  });
  const secret = (await ops.planConfigSync()).files.find((file) => file.id === "codex-config");
  await assert.rejects(() => ops.syncConfig("h1", [{ id: secret.id, digest: secret.digest }]), {
    code: "SYNC_SECRET_CONFIRMATION_REQUIRED",
    httpStatus: 409,
  });
});

test("remoteOps.syncConfig rolls back earlier files with digest CAS when a later publish fails", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-ops-rollback-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".codex"), { recursive: true });
  await writeFile(join(dir, ".codex", "config.toml"), 'model = "gpt-5"\n', "utf8");
  await writeFile(join(dir, ".codex", "AGENTS.md"), "instructions\n", "utf8");
  const commands = [];
  let publishes = 0;
  const ssh = fakeSsh({
    files: {
      "/root/.codex/config.toml": "old-config\n",
      "/root/.codex/AGENTS.md": "old-agents\n",
    },
    execImpl: async (id, { command }) => {
      commands.push(command);
      if (command.includes("$HOME")) return { code: 0, stdout: "/root", stderr: "" };
      if (command.includes("staged=") && command.includes("mv -f --")) {
        publishes += 1;
        if (publishes === 2) return { code: 73, stdout: "", stderr: "changed" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  const ops = createRemoteOps(ssh, { localHome: dir });
  const plan = await ops.planConfigSync();
  const selections = ["codex-config", "codex-agents"].map((id) => {
    const file = plan.files.find((entry) => entry.id === id);
    return { id, digest: file.digest };
  });
  const result = await ops.syncConfig("h1", selections);
  assert.equal(result.complete, false);
  assert.equal(result.status, "rolled_back");
  assert.equal(result.recoveryRequired, false);
  const rollback = commands.find((command) => !command.includes("staged=") && command.includes("514forge-backup") && command.includes("mv -f --"));
  assert.match(rollback, /test "\$actual" =/);
  assert.ok(result.results.some((entry) => entry.rolledBack));
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("remoteOps.syncConfig: canonical 锁串行化并发同步，冲突方不得进入发布", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-ops-concurrency-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".codex"), { recursive: true });
  await writeFile(join(dir, ".codex", "config.toml"), 'model = "gpt-5"\n', "utf8");

  const verificationEntered = deferred();
  const releaseVerification = deferred();
  const acquireCommands = [];
  const publishedTransactions = [];
  let lockHeld = false;
  let verificationCount = 0;
  const ssh = fakeSsh({
    files: { "/srv/canonical-home/.codex/config.toml": "old\n" },
    execImpl: async (id, { command }) => {
      if (command.includes('$HOME')) return { code: 0, stdout: "/root", stderr: "" };
      if (command.includes("acquire:running") && command.includes("umask 077")) {
        acquireCommands.push(command);
        if (lockHeld) return { code: 72, stdout: "", stderr: "locked" };
        lockHeld = true;
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command.startsWith("set -eu") && command.includes("actual_0=")) {
        verificationCount += 1;
        if (verificationCount === 1) {
          verificationEntered.resolve();
          await releaseVerification.promise;
        }
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command.includes("publish:running")) {
        publishedTransactions.push(command.match(/514forge-([0-9a-f-]+)\.tmp/i)?.[1]);
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command.startsWith("set -u; test \"$(cat") && command.includes("rmdir --")) lockHeld = false;
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  ssh.assertSftpResolvedPathPublic = async (id, path) => path === "/root" ? "/srv/canonical-home" : path;

  const ops = createRemoteOps(ssh, { localHome: dir });
  const file = (await ops.planConfigSync()).files.find((entry) => entry.id === "codex-config");
  const first = ops.syncConfig("h1", [{ id: file.id, digest: file.digest }]);
  await verificationEntered.promise;
  const second = await ops.syncConfig("h1", [{ id: file.id, digest: file.digest }]);
  releaseVerification.resolve();
  const firstResult = await first;

  assert.equal(firstResult.complete, true);
  assert.equal(second.complete, false);
  assert.equal(second.code, "REMOTE_CONFLICT");
  assert.equal(second.recoveryRequired, false);
  assert.equal(acquireCommands.length, 2);
  const lockNames = acquireCommands.map((command) => command.match(/\.514forge-locks\/([0-9a-f]{64})/)?.[1]);
  assert.equal(lockNames[0], lockNames[1]);
  assert.equal(lockNames[0], createHash("sha256").update("/srv/canonical-home/.codex/config.toml").digest("hex"));
  assert.equal(publishedTransactions.length, 1);
});

test("remoteOps.syncConfig: 发布超时保锁并返回完整 sync recovery 契约", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-ops-timeout-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".codex"), { recursive: true });
  await writeFile(join(dir, ".codex", "config.toml"), 'model = "gpt-5"\n', "utf8");
  const commands = [];
  const ssh = fakeSsh({
    files: { "/root/.codex/config.toml": "old\n" },
    execImpl: async (id, { command }) => {
      commands.push(command);
      if (command.includes('$HOME')) return { code: 0, stdout: "/root", stderr: "" };
      if (command.includes("publish:running")) throw Object.assign(new Error("deadline"), { code: "SSH_EXEC_TIMEOUT" });
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  const ops = createRemoteOps(ssh, { localHome: dir });
  const file = (await ops.planConfigSync()).files.find((entry) => entry.id === "codex-config");
  const result = await ops.syncConfig("h1", [{ id: file.id, digest: file.digest }]);

  assert.equal(result.status, "recovery_required");
  assert.equal(result.recoveryRequired, true);
  assert.equal(result.retryable, false);
  assert.equal(result.kind, "sync");
  assert.match(result.transactionId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(result.recovery, { kind: "sync", transactionId: result.transactionId });
  assert.equal(result.applied.length, 0);
  assert.equal(result.uncertain.length, 1);
  assert.equal(result.backups.length, 1);
  assert.equal(result.locks.length, 1);
  assert.match(result.locks[0], /^\/root\/\.514forge-locks\/[0-9a-f]{64}$/);
  const acquire = commands.find((command) => command.includes("acquire:running"));
  assert.match(acquire, new RegExp(`514forge-${result.transactionId}\\.tmp`));
  assert.match(acquire, /printf '%s\\n' 'sync'/);
  const publishIndex = commands.findIndex((command) => command.includes("publish:running"));
  assert.ok(publishIndex >= 0);
  assert.ok(!commands.slice(publishIndex + 1).some((command) => command.includes("rmdir --")));
});

test("remoteOps.syncConfig: 发布后摘要回读超时把全部目标标为 uncertain 并保锁", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-ops-readback-timeout-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".codex"), { recursive: true });
  await writeFile(join(dir, ".codex", "config.toml"), 'model = "gpt-5"\n', "utf8");
  const commands = [];
  const ssh = fakeSsh({
    execImpl: async (id, { command }) => {
      commands.push(command);
      if (command.includes('$HOME')) return { code: 0, stdout: "/root", stderr: "" };
      if (command.includes("published_0=")) throw Object.assign(new Error("readback deadline"), { code: "SSH_EXEC_TIMEOUT" });
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  const ops = createRemoteOps(ssh, { localHome: dir });
  const file = (await ops.planConfigSync()).files.find((entry) => entry.id === "codex-config");
  const result = await ops.syncConfig("h1", [{ id: file.id, digest: file.digest }]);

  assert.equal(result.status, "recovery_required");
  assert.equal(result.code, "SYNC_POST_PUBLISH_UNKNOWN");
  assert.equal(result.applied.length, 1);
  assert.equal(result.uncertain.length, 1);
  const readbackIndex = commands.findIndex((command) => command.includes("published_0="));
  assert.ok(readbackIndex >= 0);
  assert.ok(!commands.slice(readbackIndex + 1).some((command) => command.includes("rollback:running") || command.includes("rmdir --")));
});

test("remoteOps.syncConfig: 回滚不完整保留当前 applied、uncertain、backup 与全部锁", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-ops-rollback-recovery-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".codex"), { recursive: true });
  await writeFile(join(dir, ".codex", "config.toml"), 'model = "gpt-5"\n', "utf8");
  await writeFile(join(dir, ".codex", "AGENTS.md"), "instructions\n", "utf8");
  let publishCount = 0;
  const commands = [];
  const ssh = fakeSsh({
    files: {
      "/root/.codex/config.toml": "old-config\n",
      "/root/.codex/AGENTS.md": "old-agents\n",
    },
    execImpl: async (id, { command }) => {
      commands.push(command);
      if (command.includes('$HOME')) return { code: 0, stdout: "/root", stderr: "" };
      if (command.includes("publish:running")) {
        publishCount += 1;
        return publishCount === 2 ? { code: 73, stdout: "", stderr: "changed" } : { code: 0, stdout: "", stderr: "" };
      }
      if (command.includes("rollback:running")) return { code: 73, stdout: "", stderr: "drift" };
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  const ops = createRemoteOps(ssh, { localHome: dir });
  const plan = await ops.planConfigSync();
  const selections = ["codex-config", "codex-agents"].map((id) => {
    const file = plan.files.find((entry) => entry.id === id);
    return { id, digest: file.digest };
  });
  const result = await ops.syncConfig("h1", selections);

  assert.equal(result.status, "recovery_required");
  assert.equal(result.code, "SYNC_ROLLBACK_INCOMPLETE");
  assert.equal(result.causeCode, "SYNC_CONFLICT");
  assert.equal(result.applied.length, 1);
  assert.equal(result.uncertain.length, 1);
  assert.equal(result.applied[0].remote, result.uncertain[0].remote);
  assert.equal(result.backups.length, 1);
  assert.equal(result.locks.length, 2);
  assert.equal(result.rollbackErrors.length, 1);
  const rollbackIndex = commands.findIndex((command) => command.includes("rollback:running"));
  assert.ok(rollbackIndex >= 0);
  assert.ok(!commands.slice(rollbackIndex + 1).some((command) => command.includes("rmdir --")));
});

function b64(value) {
  return Buffer.from(String(value), "utf8").toString("base64");
}

function syncRecoveryDiscovery(transactionId, { target = "/root/.codex/config.toml", temp = null, kind = "sync", status = "publish:0" } = {}) {
  const name = createHash("sha256").update(target).digest("hex");
  const published = createHash("sha256").update('model = "gpt-5"\n').digest("hex");
  const fields = [target, "missing", published, "", temp ?? `${target}.514forge-${transactionId}.tmp`, kind, "", "yes", status];
  return `TX64|${b64("acquire:0")}\nLOCK64|${name}|${fields.map(b64).join("|")}\n`;
}

test("remoteOps.reconcileSync: 只按事务 ID 发现元数据，双摘要核对成功后释放", async () => {
  const transactionId = "11111111-1111-4111-8111-111111111111";
  const commands = [];
  const ssh = fakeSsh({
    execImpl: async (id, { command }) => {
      commands.push(command);
      if (command.includes('$HOME')) return { code: 0, stdout: "/root", stderr: "" };
      if (command.includes("printf 'TX64|'")) return { code: 0, stdout: syncRecoveryDiscovery(transactionId), stderr: "" };
      if (command.includes("resolution_check_0")) return { code: 0, stdout: "RESULT|0|published\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  const result = await createRemoteOps(ssh, { localHome: "/unused" }).reconcileSync("h1", transactionId);
  assert.deepEqual(result, {
    kind: "sync",
    transactionId,
    recoveryRequired: false,
    released: [{ remote: "/root/.codex/config.toml", resolution: "published" }],
  });
  const reconcile = commands.find((command) => command.includes("resolution_check_0"));
  assert.match(reconcile, /test "\$reconcile_actual_0" = 'missing'/);
  assert.match(reconcile, /rm -f -- '\/root\/\.codex\/config\.toml\.514forge-/);
  assert.match(reconcile, /rmdir -- '\/root\/\.514forge-locks\/[0-9a-f]{64}'/);
});

test("remoteOps.reconcileSync: 拒绝不绑定事务 ID 的 artifact 元数据并保留恢复证据", async () => {
  const transactionId = "22222222-2222-4222-8222-222222222222";
  const target = "/root/.codex/config.toml";
  const expectedLock = `/root/.514forge-locks/${createHash("sha256").update(target).digest("hex")}`;
  const ssh = fakeSsh({
    execImpl: async (id, { command }) => {
      if (command.includes('$HOME')) return { code: 0, stdout: "/root", stderr: "" };
      if (command.includes("printf 'TX64|'")) {
        return { code: 0, stdout: syncRecoveryDiscovery(transactionId, { temp: `${target}.514forge-other.tmp` }), stderr: "" };
      }
      assert.fail("元数据绑定失败后不得进入摘要核对或释放阶段");
    },
  });
  await assert.rejects(
    () => createRemoteOps(ssh, { localHome: "/unused" }).reconcileSync("h1", transactionId),
    (error) => {
      assert.equal(error.code, "REMOTE_RECOVERY_METADATA_MISMATCH");
      assert.equal(error.recoveryRequired, true);
      assert.equal(error.retryable, false);
      assert.equal(error.transactionId, transactionId);
      assert.deepEqual(error.recovery, { kind: "sync", transactionId });
      assert.deepEqual(error.locks, [expectedLock]);
      return true;
    },
  );
});

test("remoteOps.reconcileSync: 锁已释放但墓碑尚在时幂等完成", async () => {
  const transactionId = "33333333-3333-4333-8333-333333333333";
  const commands = [];
  const ssh = fakeSsh({
    execImpl: async (id, { command }) => {
      commands.push(command);
      if (command.includes('$HOME')) return { code: 0, stdout: "/root", stderr: "" };
      if (command.includes("printf 'TX64|'")) return { code: 0, stdout: `TX64|${b64("acquire:0")}\n`, stderr: "" };
      if (command.startsWith("rm -f --")) return { code: 0, stdout: "", stderr: "" };
      assert.fail("无 owner 锁的 settled 墓碑不得进入摘要核对");
    },
  });
  const result = await createRemoteOps(ssh, { localHome: "/unused" }).reconcileSync("h1", transactionId);
  assert.deepEqual(result, { kind: "sync", transactionId, recoveryRequired: false, released: [] });
  assert.ok(commands.some((command) => command.startsWith("rm -f --") && command.includes(`transaction-${transactionId}.status`)));
  assert.ok(!commands.some((command) => command.includes("transaction_status=")));
});

test("ssh routes: probe/install-cli/sync-config 状态码与门闸", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-ops-routes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const remoteGates = await createRemoteGateService({ dataRoot: dir }).init();
  const calls = [];
  setSshServiceForTest({ list: () => [], _initPromise: Promise.resolve() });
  setRemoteOpsForTest({
    async probe(id) { calls.push(["probe", id]); return { os: "Linux" }; },
    async installCli(id, toolId) { calls.push(["install", id, toolId]); return { ok: true, code: 0, display: "npm i -g x" }; },
    async planConfigSync() { return { files: [] }; },
    async syncConfig(id, files) { calls.push(["sync", id, files]); return { home: "/root", results: [] }; },
  });
  t.after(() => { setSshServiceForTest(null); setRemoteOpsForTest(null); });

  const routes = [];
  const router = {
    get: (prefix, handler) => routes.push({ method: "GET", prefix, handler }),
    post: (prefix, handler) => routes.push({ method: "POST", prefix, handler }),
    delete: (prefix, handler) => routes.push({ method: "DELETE", prefix, handler }),
  };
  let nextBody = {};
  const ctx = {
    state: { dataRoot: dir, eventStore: null },
    remoteGates,
    json(response, status, payload) { response.status = status; response.payload = payload; },
    async body() { return nextBody; },
  };
  registerSshRoutes(router, ctx);
  const dispatch = async (method, path) => {
    const url = new URL(path, "http://localhost");
    for (const route of routes) {
      if (route.method !== method || !url.pathname.startsWith(route.prefix)) continue;
      const response = {};
      if (await route.handler({}, response, url, ctx)) return response;
    }
    return null;
  };

  // 门闸未授权：probe/install-cli/sync-config/plan 全 501
  nextBody = {};
  let response = await dispatch("POST", "/api/ssh/hosts/h1/probe");
  assert.equal(response.status, 501);
  assert.equal(response.payload.code, "REMOTE_GATE_BLOCKED");
  response = await dispatch("GET", "/api/ssh/hosts/h1/env-sync/plan");
  assert.equal(response.status, 501);

  await remoteGates.grant("ssh", { source: "test" });
  response = await dispatch("POST", "/api/ssh/hosts/h1/probe");
  assert.equal(response.status, 200);
  assert.equal(response.payload.probe.os, "Linux");
  nextBody = { toolId: "codex", platform: "linux" };
  response = await dispatch("POST", "/api/ssh/hosts/h1/install-cli");
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), ["install", "h1", "codex"]);
  response = await dispatch("GET", "/api/ssh/hosts/h1/env-sync/plan");
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload.files, []);

  // sync-config 叠加 sftp 闸：ssh 已授权、sftp 未授权仍 501
  nextBody = { files: [{ id: "codex-config", digest: "0".repeat(64) }] };
  response = await dispatch("POST", "/api/ssh/hosts/h1/env-sync");
  assert.equal(response.status, 501);
  await remoteGates.grant("sftp", { source: "test" });
  response = await dispatch("POST", "/api/ssh/hosts/h1/env-sync");
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), ["sync", "h1", [{ id: "codex-config", digest: "0".repeat(64) }]]);
});
