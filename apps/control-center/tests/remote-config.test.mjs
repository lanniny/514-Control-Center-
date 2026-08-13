import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ProviderStore } from "../src/providers.mjs";
import { createRemoteConfigService } from "../src/ssh/remote-config.mjs";
import { parseProxyProbeOutput } from "../src/ssh/remote-ops.mjs";
import {
  registerSshRoutes,
  setRemoteConfigForTest,
  setRemoteGraphForTest,
  setRemoteOpsForTest,
  setSshServiceForTest,
} from "../src/ssh/routes.mjs";
import {
  registerRemoteProjectRoutes,
  setRemoteProjectConfigForTest,
  setRemoteProjectGraphForTest,
  setRemoteProjectOpsForTest,
  setRemoteProjectsServiceForTest,
} from "../src/remote-projects/routes.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

function projectedStore(paths, { content = "new-token=secret-material" } = {}) {
  const calls = [];
  return {
    calls,
    async previewSwitch(app, draft, options) {
      calls.push({ app, draft, options });
      return {
        app,
        provider: { id: draft.id, name: "Remote provider", apps: { [app]: true } },
        files: paths.map((path) => ({ path, content: `${content}\npath=${path}\n` })),
      };
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const RECOVERY_TX = "11111111-1111-4111-8111-111111111111";
const TRANSACTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECOVERY_FIELDS = ["target", "base", "published", "backup", "temp", "kind", "scope", "changed", "status"];

function recoveryDiscovery({
  transactionId = RECOVERY_TX,
  transactionStatus = "acquire:0",
  remote = "/home/lo/.codex/config.toml",
  base = "a".repeat(64),
  published = "b".repeat(64),
  kind = "provider",
  scope = "",
  changed = "yes",
  status = "publish:0",
  name = null,
} = {}) {
  const values = {
    target: remote,
    base,
    published,
    backup: base === "missing" ? "" : `${remote}.514forge-backup-${transactionId}`,
    temp: `${remote}.514forge-${transactionId}.tmp`,
    kind,
    scope,
    changed,
    status,
  };
  const encoded = RECOVERY_FIELDS.map((field) => Buffer.from(values[field]).toString("base64"));
  return [
    `TX64|${Buffer.from(transactionStatus).toString("base64")}`,
    `LOCK64|${name ?? createHash("sha256").update(remote).digest("hex")}|${encoded.join("|")}`,
  ].join("\n");
}

function recoveryStateOnly(transactionStatus) {
  return `TX64|${Buffer.from(transactionStatus).toString("base64")}`;
}

function recoverySsh({ discovery = recoveryDiscovery(), reconcileCode = 0, reconcileStdout = "RESULT|0|published\n", reconcileTimeout = false, resolvePath = (path) => path } = {}) {
  const execCalls = [];
  return {
    execCalls,
    async update() {},
    async assertSftpResolvedPathPublic(hostId, path) { return resolvePath(path); },
    async exec(hostId, input) {
      execCalls.push(input.command);
      if (input.command === 'printf %s "$HOME"') return { code: 0, stdout: "/home/lo", stderr: "" };
      if (input.command.includes("TX64|")) return { code: 0, stdout: discovery, stderr: "" };
      if (input.command.includes("transaction_status=")) {
        if (reconcileTimeout) throw Object.assign(new Error("timeout"), { code: "SSH_EXEC_TIMEOUT" });
        return { code: reconcileCode, stdout: reconcileStdout, stderr: reconcileCode ? `exit ${reconcileCode}` : "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

function sshFixture({
  home = "/home/lo",
  files = {},
  failPublishAt = 0,
  failPublishCode = 17,
  timeoutPublishAt = 0,
  rollbackCode = 0,
} = {}) {
  const raw = new Map(Object.entries(files));
  const execCalls = [];
  const writes = [];
  let publishCount = 0;
  return {
    raw,
    execCalls,
    writes,
    assertSftpPathPublic() {},
    async update() {},
    async sftpReadRaw(hostId, remote) {
      assert.equal(hostId, "host-1");
      if (!raw.has(remote)) throw Object.assign(new Error("missing"), { code: "SFTP_FAILED" });
      return { content: raw.get(remote) };
    },
    async sftpWrite(hostId, remote, content, options) {
      writes.push({ hostId, remote, content, options });
      return { ok: true };
    },
    async exec(hostId, input) {
      execCalls.push({ hostId, ...input });
      if (input.command === 'printf %s "$HOME"') return { code: 0, stdout: home, stderr: "" };
      if (input.command.startsWith("if [ -f ")) return { code: 0, stdout: "no", stderr: "" };
      if (input.command.startsWith("mkdir -p ")) return { code: 0, stdout: "", stderr: "" };
      if (input.command.includes("staged=") && input.command.includes("mv -f --")) {
        publishCount += 1;
        if (publishCount === timeoutPublishAt) {
          throw Object.assign(new Error("publish timeout"), { code: "SSH_EXEC_TIMEOUT", httpStatus: 504 });
        }
        if (publishCount === failPublishAt) return { code: failPublishCode, stdout: "", stderr: "publish failed" };
      }
      if (!input.command.includes("staged=") && input.command.includes("514forge-backup") && input.command.includes("mv -f --")) {
        return { code: rollbackCode, stdout: "", stderr: rollbackCode ? "rollback conflict" : "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

test("remote provider plan uses remote files as projection bases and never returns contents", async () => {
  const remote = "/home/lo/.codex/config.toml";
  const ssh = sshFixture({ files: { [remote]: "remote-only=true\nold-token=remote-secret\n" } });
  const providers = projectedStore(["~/.codex/config.toml"]);
  const service = createRemoteConfigService(ssh, providers);

  const plan = await service.planProvider("host-1", "codex", "provider-1");

  assert.equal(providers.calls.length, 2);
  assert.deepEqual(providers.calls[0].options.baseFiles, {});
  assert.equal(providers.calls[1].options.baseFiles["~/.codex/config.toml"], "remote-only=true\nold-token=remote-secret\n");
  assert.deepEqual(plan.files, [{
    path: "~/.codex/config.toml",
    remote,
    exists: true,
    bytes: Buffer.byteLength("new-token=secret-material\npath=~/.codex/config.toml\n"),
    changed: true,
    containsCredentialMaterial: true,
  }]);
  assert.equal(JSON.stringify(plan).includes("secret-material"), false);
  assert.equal(JSON.stringify(plan).includes("remote-secret"), false);
});

test("remote provider apply writes a private temp file, backs up, and atomically publishes", async () => {
  const remote = "/home/lo/.claude/settings.json";
  const ssh = sshFixture({ files: { [remote]: "{\"old\":true}" } });
  const providers = projectedStore(["~/.claude/settings.json"], { content: "token=publish-secret" });
  const events = [];
  const service = createRemoteConfigService(ssh, providers, {
    eventStore: { async emit(type, payload) { events.push({ type, payload }); } },
  });
  const plan = await service.planProvider("host-1", "claude", "provider-1");
  const result = await service.applyProvider("host-1", "claude", "provider-1", { planRevision: plan.planRevision });

  assert.equal(ssh.writes.length, 1);
  assert.match(ssh.writes[0].remote, /^\/home\/lo\/\.claude\/settings\.json\.514forge-[\w-]+\.tmp$/);
  assert.deepEqual(ssh.writes[0].options, { mode: 0o600, flags: "wx" });
  const publish = ssh.execCalls.find((entry) => entry.command.includes("mv -f --"));
  assert.match(publish.command, /cp -p --/);
  assert.match(publish.command, /test ! -L/);
  assert.match(publish.command, /sha256sum/);
  assert.match(publish.command, /chmod 600/);
  assert.match(publish.command, /mv -f --/);
  const lock = ssh.execCalls.find((entry) => entry.command.includes("umask 077") && entry.command.includes("mkdir --"));
  assert.match(lock.command, new RegExp(createHash("sha256").update(remote).digest("hex")));
  assert.ok(ssh.execCalls.some((entry) => entry.command.includes("rmdir --") && entry.command.includes(".514forge-locks")));
  assert.equal(result.applied[0].remote, remote);
  assert.match(result.applied[0].backup, /^\/home\/lo\/\.claude\/settings\.json\.514forge-backup-/);
  assert.equal(JSON.stringify(result).includes("publish-secret"), false);
  assert.deepEqual(events.map((entry) => entry.type), ["provider.remote_switch"]);
});

test("remote provider apply rejects publish-time digest conflicts without reporting success", async () => {
  const remote = "/home/lo/.claude/settings.json";
  const ssh = sshFixture({ files: { [remote]: "{\"old\":true}" }, failPublishAt: 1, failPublishCode: 73 });
  const events = [];
  const service = createRemoteConfigService(ssh, projectedStore(["~/.claude/settings.json"]), {
    eventStore: { async emit(type) { events.push(type); } },
  });

  const plan = await service.planProvider("host-1", "claude", "provider-1");
  await assert.rejects(() => service.applyProvider("host-1", "claude", "provider-1", { planRevision: plan.planRevision }), {
    code: "REMOTE_CONFIG_CONFLICT",
    httpStatus: 409,
  });
  assert.equal(events.length, 0);
  assert.ok(ssh.execCalls.some((entry) => entry.command.startsWith("rm -f --") && entry.command.includes(".tmp")));
});

test("a later publish failure rolls back every file already published in fixed canonical-path order", async () => {
  const config = "/home/lo/.codex/config.toml";
  const auth = "/home/lo/.codex/auth.json";
  const ssh = sshFixture({ files: { [config]: "old-config", [auth]: "old-auth" }, failPublishAt: 2 });
  const service = createRemoteConfigService(ssh, projectedStore(["~/.codex/config.toml", "~/.codex/auth.json"]));

  const plan = await service.planProvider("host-1", "codex", "provider-1");
  await assert.rejects(() => service.applyProvider("host-1", "codex", "provider-1", { planRevision: plan.planRevision }), {
    code: "REMOTE_CONFIG_PUBLISH_FAILED",
  });

  const rollback = ssh.execCalls.find((entry) => !entry.command.includes("staged=") && entry.command.includes("514forge-backup") && entry.command.includes("mv -f --"));
  assert.ok(rollback, "the first published file must be restored from its transaction backup");
  assert.match(rollback.command, /\.codex\/auth\.json/);
  assert.match(rollback.command, /test "\$actual" =/);
  assert.doesNotMatch(rollback.command, /cp -p -- .*514forge-backup/);
});

test("provider rollback refuses to overwrite a post-publish external edit", async () => {
  const config = "/home/lo/.codex/config.toml";
  const auth = "/home/lo/.codex/auth.json";
  const ssh = sshFixture({ files: { [config]: "old-config", [auth]: "old-auth" }, failPublishAt: 2, rollbackCode: 73 });
  const service = createRemoteConfigService(ssh, projectedStore(["~/.codex/config.toml", "~/.codex/auth.json"]));

  const plan = await service.planProvider("host-1", "codex", "provider-1");
  const error = await service.applyProvider("host-1", "codex", "provider-1", { planRevision: plan.planRevision }).catch((caught) => caught);
  assert.equal(error.code, "REMOTE_CONFIG_ROLLBACK_INCOMPLETE");
  assert.equal(error.recoveryRequired, true);
  assert.equal(error.retryable, false);
  assert.match(error.transactionId, /^[0-9a-f-]{36}$/);
  assert.equal(error.rollbackErrors.length, 1);
  assert.match(error.rollbackErrors[0], /rollback conflict|73/);
  assert.deepEqual(error.applied.map((entry) => entry.remote), [auth]);
  assert.deepEqual(error.uncertain.map((entry) => entry.remote), [auth]);
  assert.deepEqual(error.backups.map((entry) => entry.remote), [auth]);
  assert.equal(error.locks.length, 2);
});

test("provider publish timeout preserves structured recovery evidence and keeps locks fail-closed", async () => {
  const config = "/home/lo/.codex/config.toml";
  const auth = "/home/lo/.codex/auth.json";
  const ssh = sshFixture({ files: { [config]: "old-config", [auth]: "old-auth" }, timeoutPublishAt: 2 });
  const service = createRemoteConfigService(ssh, projectedStore(["~/.codex/config.toml", "~/.codex/auth.json"]));

  const plan = await service.planProvider("host-1", "codex", "provider-1");
  const error = await service.applyProvider("host-1", "codex", "provider-1", { planRevision: plan.planRevision }).catch((caught) => caught);
  assert.equal(error.code, "REMOTE_CONFIG_COMMIT_UNKNOWN");
  assert.equal(error.httpStatus, 503);
  assert.equal(error.recoveryRequired, true);
  assert.equal(error.retryable, false);
  assert.match(error.transactionId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(error.applied.map((entry) => entry.remote), [auth]);
  assert.deepEqual(error.uncertain.map((entry) => entry.remote), [config]);
  assert.deepEqual(error.backups.map((entry) => entry.remote).sort(), [auth, config].sort());
  assert.equal(error.locks.length, 2);
  assert.equal(ssh.execCalls.some((entry) => !entry.command.includes("staged=") && entry.command.includes("514forge-backup") && entry.command.includes("mv -f --")), false);
  assert.equal(ssh.execCalls.filter((entry) => entry.command.startsWith("set -u") && !entry.command.includes("umask 077")).length, 0);
});

test("concurrent provider transactions acquire every target lock once and reject the second writer", async () => {
  const config = "/home/lo/.codex/config.toml";
  const auth = "/home/lo/.codex/auth.json";
  const raw = new Map([[config, "old-config"], [auth, "old-auth"]]);
  const locks = new Set();
  const publishEntered = deferred();
  const allowPublish = deferred();
  const execCalls = [];
  const writes = [];
  let paused = false;
  const ssh = {
    assertSftpPathPublic() {},
    async update() {},
    async sftpReadRaw(hostId, remote) {
      if (!raw.has(remote)) throw Object.assign(new Error("missing"), { code: "SFTP_FAILED" });
      return { content: raw.get(remote) };
    },
    async sftpWrite(hostId, remote, content, options) { writes.push({ remote, content, options }); },
    async exec(hostId, input) {
      execCalls.push(input.command);
      if (input.command === 'printf %s "$HOME"') return { code: 0, stdout: "/home/lo", stderr: "" };
      if (input.command.includes("umask 077") && input.command.includes("mkdir --")) {
        const requested = [...input.command.matchAll(/mkdir -- '([^']+)'/g)].map((match) => match[1]);
        if (requested.some((path) => locks.has(path))) return { code: 72, stdout: "", stderr: "locked" };
        requested.forEach((path) => locks.add(path));
        return { code: 0, stdout: "", stderr: "" };
      }
      if (input.command.startsWith("set -u") && input.command.includes("rmdir --")) {
        for (const match of input.command.matchAll(/rmdir -- '([^']+)'/g)) locks.delete(match[1]);
        return { code: 0, stdout: "", stderr: "" };
      }
      if (input.command.includes("staged=") && input.command.includes("mv -f --")) {
        if (!paused) {
          paused = true;
          publishEntered.resolve();
          await allowPublish.promise;
        }
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const service = createRemoteConfigService(ssh, projectedStore(["~/.codex/config.toml", "~/.codex/auth.json"]));
  const plan = await service.planProvider("host-1", "codex", "provider-1");
  const first = service.applyProvider("host-1", "codex", "provider-1", { planRevision: plan.planRevision });
  await publishEntered.promise;

  const secondError = await service.applyProvider("host-1", "codex", "provider-1", { planRevision: plan.planRevision }).catch((caught) => caught);
  assert.equal(secondError.code, "REMOTE_CONFLICT");
  assert.equal(secondError.httpStatus, 409);
  assert.equal(writes.length, 1, "the conflicting transaction must not stage any file");
  assert.equal(locks.size, 2, "the first transaction owns every target before its first publish");
  const acquire = execCalls.find((command) => command.includes("umask 077") && command.includes("mkdir --"));
  const expectedLocks = [auth, config]
    .sort()
    .map((remote) => `/home/lo/.514forge-locks/${createHash("sha256").update(remote).digest("hex")}`);
  assert.deepEqual([...acquire.matchAll(/mkdir -- '([^']+)'/g)].map((match) => match[1]), expectedLocks);

  allowPublish.resolve();
  await first;
  assert.equal(locks.size, 0);
});

test("provider locks and rehashes changed and unchanged outputs before its first publish", async () => {
  const config = "/home/lo/.codex/config.toml";
  const auth = "/home/lo/.codex/auth.json";
  const projectedAuth = "new-token=secret-material\npath=~/.codex/auth.json\n";
  const ssh = sshFixture({ files: { [config]: "old-config", [auth]: projectedAuth } });
  const service = createRemoteConfigService(ssh, projectedStore(["~/.codex/config.toml", "~/.codex/auth.json"]));
  const plan = await service.planProvider("host-1", "codex", "provider-1");
  assert.deepEqual(plan.files.map((file) => [file.remote, file.changed]).sort(), [[auth, false], [config, true]]);

  await service.applyProvider("host-1", "codex", "provider-1", { planRevision: plan.planRevision });

  const acquireIndex = ssh.execCalls.findIndex((entry) => entry.command.includes("umask 077") && entry.command.includes("mkdir --"));
  const snapshotIndex = ssh.execCalls.findIndex((entry) => entry.command.startsWith("set -eu") && entry.command.includes("actual_0=") && entry.command.includes("actual_1="));
  const publishIndex = ssh.execCalls.findIndex((entry) => entry.command.includes("staged=") && entry.command.includes("mv -f --"));
  assert.ok(acquireIndex >= 0 && acquireIndex < snapshotIndex && snapshotIndex < publishIndex);
  const acquire = ssh.execCalls[acquireIndex].command;
  for (const remote of [auth, config]) {
    assert.match(acquire, new RegExp(createHash("sha256").update(remote).digest("hex")));
    assert.match(ssh.execCalls[snapshotIndex].command, new RegExp(remote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.deepEqual(ssh.writes.map((entry) => entry.remote.replace(/\.514forge-[\w-]+\.tmp$/, "")), [config]);
});

test("provider reconcile discovers owned metadata and releases only after a published digest resolution", async () => {
  const ssh = recoverySsh();
  const service = createRemoteConfigService(ssh, projectedStore([]));

  const result = await service.reconcileProvider("host-1", RECOVERY_TX);

  assert.deepEqual(result, {
    kind: "provider",
    transactionId: RECOVERY_TX,
    recoveryRequired: false,
    released: [{ remote: "/home/lo/.codex/config.toml", resolution: "published" }],
  });
  const command = ssh.execCalls.find((entry) => entry.includes("transaction_status="));
  assert.match(command, /acquire:running/);
  assert.match(command, /reconcile_actual_0/);
  assert.match(command, /rm -f -- .*\.tmp/);
  assert.match(command, /rmdir -- .*\.514forge-locks/);
});

test("provider reconcile keeps locks fail-closed for running work, digest drift, and reconcile timeout", async () => {
  for (const scenario of [
    { reconcileCode: 84, expected: "REMOTE_RECOVERY_PENDING" },
    { reconcileCode: 85, expected: "REMOTE_RECOVERY_DRIFT" },
    { reconcileTimeout: true, expected: "REMOTE_RECOVERY_RECONCILE_UNKNOWN" },
  ]) {
    const ssh = recoverySsh(scenario);
    const service = createRemoteConfigService(ssh, projectedStore([]));
    const error = await service.reconcileProvider("host-1", RECOVERY_TX).catch((caught) => caught);
    assert.equal(error.code, scenario.expected);
    assert.equal(error.recoveryRequired, true);
    assert.equal(error.retryable, false);
    assert.deepEqual(error.recovery, { kind: "provider", transactionId: RECOVERY_TX });
    assert.deepEqual(error.locks, [`/home/lo/.514forge-locks/${createHash("sha256").update("/home/lo/.codex/config.toml").digest("hex")}`]);
    assert.equal(ssh.execCalls.filter((entry) => entry.includes("transaction_status=")).length, 1);
  }
});

test("provider reconcile rejects target hash and scope metadata tampering before remote release", async () => {
  const cases = [
    { discovery: recoveryDiscovery({ name: "0".repeat(64) }) },
    {
      discovery: recoveryDiscovery({ remote: "/home/lo/alias/config.toml" }),
      resolvePath: (path) => path === "/home/lo/alias" ? "/home/lo/real" : path,
    },
    { discovery: recoveryDiscovery({ scope: "/client/injection" }) },
  ];
  for (const scenario of cases) {
    const ssh = recoverySsh(scenario);
    const service = createRemoteConfigService(ssh, projectedStore([]));
    const error = await service.reconcileProvider("host-1", RECOVERY_TX).catch((caught) => caught);
    assert.equal(error.code, "REMOTE_RECOVERY_METADATA_MISMATCH");
    assert.equal(error.recoveryRequired, true);
    assert.equal(ssh.execCalls.some((entry) => entry.includes("transaction_status=")), false);
  }
});

test("provider reconcile is idempotently complete when all locks were released before state cleanup", async () => {
  const ssh = recoverySsh({ discovery: recoveryStateOnly("acquire:0") });
  const service = createRemoteConfigService(ssh, projectedStore([]));
  const result = await service.reconcileProvider("host-1", RECOVERY_TX);
  assert.deepEqual(result, { kind: "provider", transactionId: RECOVERY_TX, recoveryRequired: false, released: [] });
  assert.ok(ssh.execCalls.some((command) => command.startsWith("rm -f --") && command.includes(`transaction-${RECOVERY_TX}.status`)));
  assert.equal(ssh.execCalls.some((command) => command.includes("transaction_status=")), false);
});

test("provider reconcile does not treat running or absent state without locks as released", async () => {
  const pending = createRemoteConfigService(recoverySsh({ discovery: recoveryStateOnly("acquire:running") }), projectedStore([]));
  const pendingError = await pending.reconcileProvider("host-1", RECOVERY_TX).catch((caught) => caught);
  assert.equal(pendingError.code, "REMOTE_RECOVERY_PENDING");
  assert.equal(pendingError.recoveryRequired, true);

  const absent = createRemoteConfigService(recoverySsh({ discovery: "TX64|" }), projectedStore([]));
  await assert.rejects(() => absent.reconcileProvider("host-1", RECOVERY_TX), { code: "REMOTE_RECOVERY_NOT_FOUND", httpStatus: 404 });
});

test("remote provider apply is bound to the confirmed plan revision", async () => {
  const remote = "/home/lo/.codex/config.toml";
  const ssh = sshFixture({ files: { [remote]: "old=true\n" } });
  const providers = projectedStore(["~/.codex/config.toml"]);
  const service = createRemoteConfigService(ssh, providers);
  const plan = await service.planProvider("host-1", "codex", "provider-1");

  await assert.rejects(() => service.applyProvider("host-1", "codex", "provider-1"), {
    code: "REMOTE_PROVIDER_PLAN_STALE",
    httpStatus: 409,
  });
  providers.previewSwitch = async (app, draft, options) => ({
    app,
    provider: { id: draft.id, name: "Remote provider", apps: { [app]: true } },
    files: [{ path: "~/.codex/config.toml", content: options.baseFiles["~/.codex/config.toml"] == null ? "changed=true\n" : "changed=true\n" }],
  });
  await assert.rejects(() => service.applyProvider("host-1", "codex", "provider-1", { planRevision: plan.planRevision }), {
    code: "REMOTE_PROVIDER_PLAN_STALE",
    httpStatus: 409,
  });
  assert.equal(ssh.writes.length, 0);
});

test("remote projects place Claude and Codex project config in the project while keeping Codex auth in HOME", async () => {
  const ssh = sshFixture();
  const claude = createRemoteConfigService(ssh, projectedStore(["~/.claude/settings.json"]));
  const codex = createRemoteConfigService(ssh, projectedStore(["~/.codex/config.toml", "~/.codex/auth.json"]));

  const claudePlan = await claude.planProvider("host-1", "claude", "provider-1", { projectPath: "/srv/app" });
  const codexPlan = await codex.planProvider("host-1", "codex", "provider-1", { projectPath: "/srv/app" });

  assert.deepEqual(claudePlan.files.map((file) => file.remote), ["/srv/app/.claude/settings.json"]);
  assert.deepEqual(codexPlan.files.map((file) => file.remote), ["/srv/app/.codex/config.toml", "/home/lo/.codex/auth.json"]);
});

test("Claude Desktop is explicitly unsupported on a headless remote target", async () => {
  const service = createRemoteConfigService(sshFixture(), projectedStore([]));
  await assert.rejects(() => service.planProvider("host-1", "claude-desktop", "provider-1"), {
    code: "REMOTE_PROVIDER_APP_UNSUPPORTED",
    httpStatus: 422,
  });
});

test("ProviderStore baseFiles overrides local live files without modifying them", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-remote-config-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = join(root, "data");
  const runtimeHome = join(root, "home");
  await mkdir(join(runtimeHome, ".codex"), { recursive: true });
  const localConfig = 'sandbox_mode = "read-only"\nlocal_only = true\n';
  const localAuth = '{"LOCAL_ONLY":"yes","OPENAI_API_KEY":"local-old"}\n';
  await writeFile(join(runtimeHome, ".codex", "config.toml"), localConfig);
  await writeFile(join(runtimeHome, ".codex", "auth.json"), localAuth);
  const store = await new ProviderStore({ dataRoot, runtimeHome }).init();
  const provider = await store.create({
    name: "Remote Codex",
    baseUrl: "https://remote.example.com/v1",
    apiKey: "sk-remote-provider-secret",
    apps: { codex: true },
    models: { codex: { model: "gpt-5.6-sol" } },
  });

  const preview = await store.previewSwitch("codex", { id: provider.id }, {
    reveal: true,
    baseFiles: {
      "~/.codex/config.toml": 'sandbox_mode = "workspace-write"\nremote_only = true\n',
      "~/.codex/auth.json": '{"REMOTE_ONLY":"yes","OPENAI_API_KEY":"remote-old"}\n',
    },
  });
  const projectedConfig = preview.files.find((file) => file.path.endsWith("config.toml")).content;
  const projectedAuth = preview.files.find((file) => file.path.endsWith("auth.json")).content;
  assert.match(projectedConfig, /remote_only = true/);
  assert.doesNotMatch(projectedConfig, /local_only = true/);
  assert.equal(JSON.parse(projectedAuth).OPENAI_API_KEY, "sk-remote-provider-secret");
  assert.equal(JSON.parse(projectedAuth).LOCAL_ONLY, undefined);
  assert.equal(await readFile(join(runtimeHome, ".codex", "config.toml"), "utf8"), localConfig);
  assert.equal(await readFile(join(runtimeHome, ".codex", "auth.json"), "utf8"), localAuth);
});

function routeCollector() {
  const routes = [];
  return {
    routes,
    router: {
      get: (prefix, handler) => routes.push({ method: "GET", prefix, handler }),
      post: (prefix, handler) => routes.push({ method: "POST", prefix, handler }),
      delete: (prefix, handler) => routes.push({ method: "DELETE", prefix, handler }),
    },
    async dispatch(method, path, ctx) {
      const url = new URL(path, "http://localhost");
      for (const route of routes) {
        if (route.method !== method || !url.pathname.startsWith(route.prefix)) continue;
        const response = {};
        if (await route.handler({}, response, url, ctx)) return response;
      }
      return null;
    },
  };
}

function routeContext(granted, body = {}, { dataRoot } = {}) {
  let nextBody = body;
  return {
    state: { dataRoot, providers: {}, eventStore: null },
    setBody(value) { nextBody = value; },
    remoteGates: {
      registerImplementation() {},
      assert(gate) {
        if (!granted.has(gate)) {
          throw Object.assign(new Error(`blocked: ${gate}`), { code: "REMOTE_GATE_BLOCKED", httpStatus: 501 });
        }
      },
    },
    json(response, status, payload) { response.status = status; response.payload = payload; },
    async body() { return nextBody; },
  };
}

async function readRecoveryLedger(dataRoot) {
  const ledger = JSON.parse(await readFile(join(dataRoot, "remote-recoveries.json"), "utf8"));
  assert.equal(ledger.schema, "514cc.remote-recoveries/v1");
  assert.ok(Array.isArray(ledger.records));
  return ledger.records;
}

async function assertRegisteredTransaction(dataRoot, { hostId, projectId = null, kind, transactionId }) {
  assert.match(transactionId, TRANSACTION_ID_PATTERN);
  const records = await readRecoveryLedger(dataRoot);
  assert.equal(records.length, 1);
  assert.equal(records[0].hostId, hostId);
  assert.equal(records[0].projectId, projectId);
  assert.equal(records[0].kind, kind);
  assert.equal(records[0].transactionId, transactionId);
  return records[0];
}

test("host provider, graph, and sync routes bind one durable transaction and recover before the next write", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-remote-config-host-routes-"));
  const granted = new Set();
  const calls = [];
  let recoveryMode = false;
  let removeCalls = 0;
  let trustCalls = 0;
  let enabledCalls = 0;
  let updateCalls = 0;
  let sftpWriteCalls = 0;
  let execCalls = 0;
  const ssh = {
    list: () => [],
    async trust() { trustCalls += 1; return {}; },
    async setEnabled() { enabledCalls += 1; return {}; },
    async update() { updateCalls += 1; return {}; },
    async sftpWrite() { sftpWriteCalls += 1; return { ok: true }; },
    async exec() { execCalls += 1; return { code: 0, stdout: "", stderr: "" }; },
    async remove() { removeCalls += 1; return true; },
  };
  setSshServiceForTest(ssh);
  setRemoteConfigForTest({
    async planProvider(hostId, app, providerId) {
      calls.push(["plan", hostId, app, providerId]);
      if (app === "claude-desktop") {
        throw Object.assign(new Error("headless"), { code: "REMOTE_PROVIDER_APP_UNSUPPORTED", httpStatus: 422 });
      }
      return { app, provider: { id: providerId }, files: [] };
    },
    async applyProvider(hostId, app, providerId, options) {
      calls.push(["apply", hostId, app, providerId, options]);
      await assertRegisteredTransaction(dataRoot, {
        hostId,
        kind: "provider",
        transactionId: options.transactionId,
      });
      if (recoveryMode) {
        throw Object.assign(new Error("manual recovery required; automated retry is blocked"), {
          code: "REMOTE_CONFIG_COMMIT_UNKNOWN",
          httpStatus: 503,
          recoveryRequired: true,
          retryable: true,
          transactionId: options.transactionId,
          recovery: { kind: "provider", transactionId: options.transactionId },
          applied: [{ remote: "/a", backup: "/a.bak" }],
          uncertain: [{ remote: "/b", backup: "/b.bak" }],
          backups: [{ remote: "/a", backup: "/a.bak" }, { remote: "/b", backup: "/b.bak" }],
          locks: ["/locks/a", "/locks/b"],
        });
      }
      return { app, provider: { id: providerId }, files: [], applied: [] };
    },
    async reconcileProvider(hostId, transactionId) {
      calls.push(["reconcile-provider", hostId, transactionId]);
      return { kind: "provider", transactionId, recoveryRequired: false, released: [] };
    },
  });
  setRemoteGraphForTest({
    async writeSource(hostId, file, content, digest, options) {
      calls.push(["write-source", hostId, file, content, digest, options]);
      await assertRegisteredTransaction(dataRoot, {
        hostId,
        kind: "graph",
        transactionId: options.transactionId,
      });
      return { id: file, remote: "/home/lo/AGENTS.md", bytes: content.length, digest: "new" };
    },
  });
  setRemoteOpsForTest({
    async installCli(hostId, toolId, options) {
      calls.push(["install", hostId, toolId, options]);
      return { installed: true };
    },
    async syncConfig(hostId, files, options) {
      calls.push(["sync", hostId, files, options]);
      await assertRegisteredTransaction(dataRoot, {
        hostId,
        kind: "sync",
        transactionId: options.transactionId,
      });
      return { home: "/home/lo", results: [] };
    },
  });
  t.after(async () => {
    setRemoteConfigForTest(null);
    setRemoteGraphForTest(null);
    setRemoteOpsForTest(null);
    setSshServiceForTest(null);
    await rm(dataRoot, { recursive: true, force: true });
  });
  const harness = routeCollector();
  const ctx = routeContext(granted, { app: "codex", providerId: "p1", planRevision: "a".repeat(64) }, { dataRoot });
  registerSshRoutes(harness.router, ctx);

  let response = await harness.dispatch("GET", "/api/ssh/hosts/h1/provider-plan?app=codex&providerId=p1", ctx);
  assert.equal(response.status, 501);
  granted.add("ssh");
  response = await harness.dispatch("GET", "/api/ssh/hosts/h1/provider-plan?app=codex&providerId=p1", ctx);
  assert.equal(response.status, 501);
  granted.add("sftp");
  response = await harness.dispatch("GET", "/api/ssh/hosts/h1/provider-plan?app=codex&providerId=p1", ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), ["plan", "h1", "codex", "p1"]);
  response = await harness.dispatch("POST", "/api/ssh/hosts/h1/provider-apply", ctx);
  assert.equal(response.status, 200);
  const firstProvider = calls.at(-1);
  assert.deepEqual(firstProvider.slice(0, 4), ["apply", "h1", "codex", "p1"]);
  assert.equal(firstProvider[4].planRevision, "a".repeat(64));
  assert.match(firstProvider[4].transactionId, TRANSACTION_ID_PATTERN);
  assert.deepEqual(await readRecoveryLedger(dataRoot), []);

  ctx.setBody({ file: "project-agents", content: "updated", digest: "old" });
  response = await harness.dispatch("POST", "/api/ssh/hosts/h1/graph/source", ctx);
  assert.equal(response.status, 200);
  const graphCall = calls.at(-1);
  assert.deepEqual(graphCall.slice(0, 5), ["write-source", "h1", "project-agents", "updated", "old"]);
  assert.deepEqual(Object.keys(graphCall[5]), ["transactionId"]);
  assert.match(graphCall[5].transactionId, TRANSACTION_ID_PATTERN);
  assert.deepEqual(await readRecoveryLedger(dataRoot), []);

  ctx.setBody({ files: [{ id: "codex-config", digest: "0".repeat(64) }] });
  response = await harness.dispatch("POST", "/api/ssh/hosts/h1/env-sync", ctx);
  assert.equal(response.status, 200);
  const syncCall = calls.at(-1);
  assert.deepEqual(syncCall.slice(0, 3), ["sync", "h1", [{ id: "codex-config", digest: "0".repeat(64) }]]);
  assert.deepEqual(Object.keys(syncCall[3]), ["transactionId"]);
  assert.match(syncCall[3].transactionId, TRANSACTION_ID_PATTERN);
  assert.deepEqual(await readRecoveryLedger(dataRoot), []);

  ctx.setBody({ app: "codex", providerId: "p1", planRevision: "a".repeat(64) });
  recoveryMode = true;
  response = await harness.dispatch("POST", "/api/ssh/hosts/h1/provider-apply", ctx);
  assert.equal(response.status, 503);
  assert.match(response.payload.transactionId, TRANSACTION_ID_PATTERN);
  assert.deepEqual(response.payload.recovery, { kind: "provider", transactionId: response.payload.transactionId });
  assert.equal(response.payload.retryable, false);
  assert.deepEqual(response.payload.uncertain, [{ remote: "/b", backup: "/b.bak" }]);
  assert.deepEqual(response.payload.locks, ["/locks/a", "/locks/b"]);
  const pendingTransactionId = response.payload.transactionId;
  assert.equal(calls.at(-1)[4].transactionId, pendingTransactionId);
  const persisted = await assertRegisteredTransaction(dataRoot, {
    hostId: "h1",
    kind: "provider",
    transactionId: pendingTransactionId,
  });
  assert.equal(persisted.targetKey, "host:h1");
  assert.equal(persisted.uncertainCount, 1);

  response = await harness.dispatch("GET", "/api/ssh/hosts/recoveries", ctx);
  assert.equal(response.status, 200);
  assert.equal(response.payload.recoveries.length, 1);
  assert.equal(response.payload.recoveries[0].transactionId, pendingTransactionId);

  const applyCallsBeforeBlock = calls.filter(([type]) => type === "apply").length;
  response = await harness.dispatch("POST", "/api/ssh/hosts/h1/provider-apply", ctx);
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, "REMOTE_RECOVERY_BLOCKED");
  assert.deepEqual(response.payload.pending, [{ kind: "provider", transactionId: pendingTransactionId, targetKey: "host:h1" }]);
  assert.equal(calls.filter(([type]) => type === "apply").length, applyCallsBeforeBlock);

  ctx.setBody({ toolId: "codex", platform: "linux" });
  response = await harness.dispatch("POST", "/api/ssh/hosts/h1/install-cli", ctx);
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, "REMOTE_RECOVERY_BLOCKED");
  assert.equal(calls.some(([type]) => type === "install"), false);

  ctx.setBody({ fingerprint: "SHA256:blocked" });
  response = await harness.dispatch("POST", "/api/ssh/hosts/h1/trust", ctx);
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, "REMOTE_RECOVERY_BLOCKED");
  assert.equal(trustCalls, 0);

  ctx.setBody({ enabled: false });
  response = await harness.dispatch("POST", "/api/ssh/hosts/h1/enabled", ctx);
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, "REMOTE_RECOVERY_BLOCKED");
  assert.equal(enabledCalls, 0);

  ctx.setBody({});
  response = await harness.dispatch("POST", "/api/ssh/hosts/h1/sync-config", ctx);
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, "REMOTE_RECOVERY_BLOCKED");
  assert.equal(updateCalls, 0);

  ctx.setBody({ path: "/home/lo/blocked.txt", content: "blocked" });
  response = await harness.dispatch("POST", "/api/ssh/hosts/h1/sftp/write", ctx);
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, "REMOTE_RECOVERY_BLOCKED");
  assert.equal(sftpWriteCalls, 0);

  ctx.setBody({ command: "true" });
  response = await harness.dispatch("POST", "/api/ssh/hosts/h1/exec", ctx);
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, "REMOTE_RECOVERY_BLOCKED");
  assert.equal(execCalls, 0);

  response = await harness.dispatch("DELETE", "/api/ssh/hosts/h1", ctx);
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, "REMOTE_RECOVERY_BLOCKED");
  assert.equal(removeCalls, 0);

  ctx.setBody({ kind: "provider", transactionId: pendingTransactionId });
  response = await harness.dispatch("POST", "/api/ssh/hosts/h1/recovery/reconcile", ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), ["reconcile-provider", "h1", pendingTransactionId]);
  assert.deepEqual(await readRecoveryLedger(dataRoot), []);

  recoveryMode = false;
  ctx.setBody({ app: "codex", providerId: "p1", planRevision: "a".repeat(64) });
  response = await harness.dispatch("POST", "/api/ssh/hosts/h1/provider-apply", ctx);
  assert.equal(response.status, 200);
  assert.match(calls.at(-1)[4].transactionId, TRANSACTION_ID_PATTERN);
  assert.notEqual(calls.at(-1)[4].transactionId, pendingTransactionId);
  assert.deepEqual(await readRecoveryLedger(dataRoot), []);

  response = await harness.dispatch("GET", "/api/ssh/hosts/h1/provider-plan?app=claude-desktop&providerId=p1", ctx);
  assert.equal(response.status, 422);
  assert.equal(response.payload.code, "REMOTE_PROVIDER_APP_UNSUPPORTED");
});

test("project provider routes bind the ledger host/path and reject missing or disabled hosts", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-remote-config-project-routes-"));
  const granted = new Set(["ssh", "sftp"]);
  const calls = [];
  let recoveryMode = false;
  let removeCalls = 0;
  setSshServiceForTest({ list: () => [] });
  setRemoteProjectsServiceForTest({
    async get(id) {
      if (id === "rp-ok") return { id, hostId: "h1", path: "/srv/app", hostMissing: false, host: { id: "h1", name: "server", enabled: true } };
      if (id === "rp-missing-host") return { id, hostId: "gone", path: "/srv/app", hostMissing: true, host: null };
      if (id === "rp-disabled") return { id, hostId: "h2", path: "/srv/app", hostMissing: false, host: { id: "h2", name: "off", enabled: false } };
      return null;
    },
    async remove(id) { removeCalls += 1; return id === "rp-ok"; },
  });
  setRemoteProjectConfigForTest({
    async planProvider(hostId, app, providerId, options) {
      calls.push(["plan", hostId, app, providerId, options]);
      return { app, provider: { id: providerId }, target: options, files: [] };
    },
    async applyProvider(hostId, app, providerId, options) {
      calls.push(["apply", hostId, app, providerId, options]);
      assert.equal(options.projectPath, "/srv/app");
      await assertRegisteredTransaction(dataRoot, {
        hostId,
        projectId: "rp-ok",
        kind: "provider",
        transactionId: options.transactionId,
      });
      if (recoveryMode) {
        throw Object.assign(new Error("manual recovery required; automated retry is blocked"), {
          code: "REMOTE_CONFIG_ROLLBACK_INCOMPLETE",
          httpStatus: 409,
          recoveryRequired: true,
          transactionId: options.transactionId,
          recovery: { kind: "provider", transactionId: options.transactionId },
          applied: [{ remote: "/srv/app/a", backup: "/srv/app/a.bak" }],
          uncertain: [{ remote: "/srv/app/a", backup: "/srv/app/a.bak" }],
          backups: [{ remote: "/srv/app/a", backup: "/srv/app/a.bak" }],
          locks: ["/home/lo/.514forge-locks/a"],
          rollbackErrors: ["/srv/app/a: 73"],
        });
      }
      return { app, provider: { id: providerId }, target: options, files: [], applied: [] };
    },
    async reconcileProvider(hostId, transactionId, options) {
      calls.push(["reconcile-provider", hostId, transactionId, options]);
      return { kind: "provider", transactionId, recoveryRequired: false, released: [] };
    },
  });
  setRemoteProjectGraphForTest({
    async writeSource(hostId, file, content, digest, options) {
      calls.push(["write-source", hostId, file, content, digest, options]);
      assert.equal(options.projectPath, "/srv/app");
      await assertRegisteredTransaction(dataRoot, {
        hostId,
        projectId: "rp-ok",
        kind: "graph",
        transactionId: options.transactionId,
      });
      return { id: file, remote: "/srv/app/AGENTS.md", bytes: content.length, digest: "new", backup: "/srv/app/AGENTS.md.backup" };
    },
  });
  setRemoteProjectOpsForTest({
    async reconcileSync(hostId, transactionId) {
      calls.push(["reconcile-sync", hostId, transactionId]);
      return { kind: "sync", transactionId, recoveryRequired: false, released: [] };
    },
  });
  t.after(async () => {
    setRemoteProjectConfigForTest(null);
    setRemoteProjectGraphForTest(null);
    setRemoteProjectOpsForTest(null);
    setRemoteProjectsServiceForTest(null);
    setSshServiceForTest(null);
    await rm(dataRoot, { recursive: true, force: true });
  });
  const harness = routeCollector();
  const ctx = routeContext(granted, { app: "claude", providerId: "p1", planRevision: "b".repeat(64), projectPath: "/client/injection" }, { dataRoot });
  registerRemoteProjectRoutes(harness.router, ctx);

  let response = await harness.dispatch("GET", "/api/remote-projects/rp-ok/provider-plan?app=claude&providerId=p1", ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), ["plan", "h1", "claude", "p1", { projectPath: "/srv/app" }]);
  response = await harness.dispatch("POST", "/api/remote-projects/rp-ok/provider-apply", ctx);
  assert.equal(response.status, 200);
  const firstApply = calls.at(-1);
  assert.deepEqual(firstApply.slice(0, 4), ["apply", "h1", "claude", "p1"]);
  assert.equal(firstApply[4].projectPath, "/srv/app");
  assert.equal(firstApply[4].planRevision, "b".repeat(64));
  assert.match(firstApply[4].transactionId, TRANSACTION_ID_PATTERN);
  assert.deepEqual(await readRecoveryLedger(dataRoot), []);

  recoveryMode = true;
  response = await harness.dispatch("POST", "/api/remote-projects/rp-ok/provider-apply", ctx);
  assert.equal(response.status, 409);
  assert.match(response.payload.transactionId, TRANSACTION_ID_PATTERN);
  assert.deepEqual(response.payload.recovery, { kind: "provider", transactionId: response.payload.transactionId });
  assert.equal(response.payload.retryable, false);
  assert.deepEqual(response.payload.rollbackErrors, ["/srv/app/a: 73"]);
  assert.deepEqual(response.payload.backups, [{ remote: "/srv/app/a", backup: "/srv/app/a.bak" }]);
  const pendingTransactionId = response.payload.transactionId;
  const persisted = await assertRegisteredTransaction(dataRoot, {
    hostId: "h1",
    projectId: "rp-ok",
    kind: "provider",
    transactionId: pendingTransactionId,
  });
  assert.equal(persisted.targetKey, "project:rp-ok");

  ctx.setBody({ file: "project-agents", content: "updated", digest: "old", projectPath: "/client/injection" });
  response = await harness.dispatch("POST", "/api/remote-projects/rp-ok/graph/source", ctx);
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, "REMOTE_RECOVERY_BLOCKED");
  assert.deepEqual(response.payload.pending, [{ kind: "provider", transactionId: pendingTransactionId, targetKey: "project:rp-ok" }]);
  assert.equal(calls.some(([type]) => type === "write-source"), false);

  response = await harness.dispatch("DELETE", "/api/remote-projects/rp-ok", ctx);
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, "REMOTE_RECOVERY_BLOCKED");
  assert.equal(removeCalls, 0);

  ctx.setBody({ kind: "provider", transactionId: pendingTransactionId });
  response = await harness.dispatch("POST", "/api/remote-projects/rp-ok/recovery/reconcile", ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), ["reconcile-provider", "h1", pendingTransactionId, { projectPath: "/srv/app" }]);
  assert.deepEqual(await readRecoveryLedger(dataRoot), []);

  recoveryMode = false;
  ctx.setBody({ file: "project-agents", content: "updated", digest: "old", projectPath: "/client/injection" });
  response = await harness.dispatch("POST", "/api/remote-projects/rp-ok/graph/source", ctx);
  assert.equal(response.status, 200);
  const graphCall = calls.at(-1);
  assert.deepEqual(graphCall.slice(0, 5), ["write-source", "h1", "project-agents", "updated", "old"]);
  assert.equal(graphCall[5].projectPath, "/srv/app");
  assert.match(graphCall[5].transactionId, TRANSACTION_ID_PATTERN);
  assert.deepEqual(await readRecoveryLedger(dataRoot), []);

  await ctx.state.remoteRecoveryLedger.record({
    hostId: "h1",
    kind: "sync",
    transactionId: RECOVERY_TX,
    causeCode: "REMOTE_SYNC_COMMIT_UNKNOWN",
  });
  ctx.setBody({ kind: "sync", transactionId: RECOVERY_TX });
  response = await harness.dispatch("POST", "/api/remote-projects/rp-ok/recovery/reconcile", ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), ["reconcile-sync", "h1", RECOVERY_TX]);
  assert.deepEqual(await readRecoveryLedger(dataRoot), []);

  response = await harness.dispatch("GET", "/api/remote-projects/unknown/provider-plan?app=claude&providerId=p1", ctx);
  assert.equal(response.status, 404);
  response = await harness.dispatch("GET", "/api/remote-projects/rp-missing-host/provider-plan?app=claude&providerId=p1", ctx);
  assert.equal(response.status, 409);
  response = await harness.dispatch("POST", "/api/remote-projects/rp-disabled/provider-apply", ctx);
  assert.equal(response.status, 409);
});

test("remote proxy diagnosis parser redacts proxy credentials and keeps bounded status evidence", () => {
  const result = parseProxyProbeOutput([
    "ENV|https_proxy|http://user:password@127.0.0.1:7897",
    "ENV|NO_PROXY|localhost,127.0.0.1",
    "LISTEN|LISTEN 0 128 127.0.0.1:7897 users:((\"mihomo\",pid=12,fd=8))",
    "OUT|https://api.openai.com|401|0.125|0",
    "OUT|https://api.anthropic.com|000|8.000|28",
  ].join("\n"));
  assert.equal(result.environment.length, 2);
  assert.equal(JSON.stringify(result).includes("password"), false);
  assert.match(result.environment[0].value, /redacted/);
  assert.equal(result.listeners.length, 1);
  assert.deepEqual(result.outbound.map((entry) => [entry.status, entry.timeMs, entry.ok]), [
    [401, 125, true],
    [0, 8000, false],
  ]);
});
