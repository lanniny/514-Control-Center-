import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createRemoteRecoveryLedger,
  ensureRemoteRecoveryLedger,
  reconcileRegisteredRemoteRecovery,
  runRegisteredRemoteWrite,
  runTrackedRemoteWrite,
  trackRemoteRecovery,
} from "../src/ssh/recovery-ledger.mjs";

const TX1 = "11111111-1111-4111-8111-111111111111";
const TX2 = "22222222-2222-4222-8222-222222222222";

function recovery(kind, transactionId, extra = {}) {
  return {
    status: "recovery_required",
    recoveryRequired: true,
    kind,
    transactionId,
    applied: [{ remote: "/remote/a" }],
    uncertain: [{ remote: "/remote/b" }],
    causeCode: "SSH_EXEC_TIMEOUT",
    ...extra,
  };
}

function runChild(source, { cwd, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("remote recovery ledger: concurrent records persist independently and restart replays", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-recovery-ledger-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const ledger = await createRemoteRecoveryLedger({ dataRoot }).init();

  await Promise.all([
    ledger.record({ hostId: "h1", projectId: "p1", ...recovery("provider", TX1), appliedCount: 1, uncertainCount: 1 }),
    ledger.record({ hostId: "h1", projectId: "p1", ...recovery("graph", TX2), appliedCount: 1, uncertainCount: 1 }),
  ]);

  assert.deepEqual((await ledger.list({ hostId: "h1" })).map((entry) => entry.kind).sort(), ["graph", "provider"]);
  const onDisk = JSON.parse(await readFile(join(dataRoot, "remote-recoveries.json"), "utf8"));
  assert.equal(onDisk.schema, "514cc.remote-recoveries/v1");
  assert.equal(onDisk.records.length, 2);
  assert.equal(JSON.stringify(onDisk).includes("/remote/a"), false);

  const restarted = await createRemoteRecoveryLedger({ dataRoot }).init();
  assert.equal((await restarted.list({ projectId: "p1" })).length, 2);
  await assert.rejects(() => restarted.assertHostWritable("h1"), { code: "REMOTE_RECOVERY_BLOCKED", httpStatus: 409 });
  await assert.rejects(() => restarted.assertProjectRemovable("p1"), { code: "REMOTE_RECOVERY_BLOCKED", httpStatus: 409 });

  assert.equal(await restarted.resolve({ hostId: "h1", kind: "provider", transactionId: TX1 }), true);
  assert.equal(await restarted.resolve({ hostId: "h1", kind: "provider", transactionId: TX1 }), false);
  assert.deepEqual((await restarted.list({ hostId: "h1" })).map((entry) => entry.kind), ["graph"]);
});

test("remote recovery ledger: sync is always host scoped and tracked from HTTP 200 result", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-recovery-ledger-sync-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const ledger = await createRemoteRecoveryLedger({ dataRoot }).init();
  const result = await runTrackedRemoteWrite(ledger, { hostId: "h1", projectId: "p1" }, "sync", async () => recovery("sync", TX1));

  assert.equal(result.recoveryRegistryPersisted, true);
  assert.deepEqual((await ledger.list()).map(({ hostId, projectId, targetKey, kind }) => ({ hostId, projectId, targetKey, kind })), [{
    hostId: "h1",
    projectId: null,
    targetKey: "host:h1",
    kind: "sync",
  }]);
});

test("remote recovery ledger: thrown recovery errors are tracked without masking original error", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-recovery-ledger-error-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const ledger = await createRemoteRecoveryLedger({ dataRoot }).init();
  const original = Object.assign(new Error("publish timed out"), recovery("provider", TX1));

  await assert.rejects(
    () => runTrackedRemoteWrite(ledger, { hostId: "h1", projectId: "p1" }, "provider", async () => { throw original; }),
    (error) => error === original && error.recoveryRegistryPersisted === true,
  );
  assert.equal((await ledger.list({ hostId: "h1" }))[0].transactionId, TX1);
});

test("remote recovery ledger: atomic persistence failure becomes sticky fail-closed", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-recovery-ledger-failure-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  let failRename = true;
  const ledger = await createRemoteRecoveryLedger({
    dataRoot,
    fileSystem: {
      async rename(source, target) {
        if (failRename) {
          failRename = false;
          throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
        }
        return rename(source, target);
      },
    },
  }).init();
  const result = recovery("sync", TX1);

  await trackRemoteRecovery(ledger, result, { hostId: "h1", fallbackKind: "sync" });
  assert.equal(result.recoveryRegistryPersisted, false);
  assert.equal(result.recoveryRegistryError, "REMOTE_RECOVERY_LEDGER_WRITE_FAILED");
  await assert.rejects(() => ledger.list(), { code: "REMOTE_RECOVERY_LEDGER_WRITE_FAILED" });
  await assert.rejects(() => ledger.assertHostWritable("h1"), { code: "REMOTE_RECOVERY_LEDGER_WRITE_FAILED" });
});

test("remote recovery ledger: eager initialization failure is owned and remains fail-closed", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-recovery-ledger-init-failure-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  await writeFile(join(dataRoot, "remote-recoveries.json"), "{broken", "utf8");
  const cwd = new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1");
  const source = `
    import { ensureRemoteRecoveryLedger } from "./src/ssh/recovery-ledger.mjs";
    const ledger = ensureRemoteRecoveryLedger({ dataRoot: process.env.DATA_ROOT });
    setTimeout(async () => {
      try {
        await ledger.list();
        process.exitCode = 2;
      } catch (error) {
        console.log(JSON.stringify({ code: error.code, initCode: ledger._initError?.code }));
      }
    }, 25);
  `;
  const child = await runChild(source, { cwd, env: { DATA_ROOT: dataRoot } });

  assert.equal(child.code, 0, child.stderr);
  assert.equal(child.signal, null);
  assert.deepEqual(JSON.parse(child.stdout.trim()), {
    code: "REMOTE_RECOVERY_LEDGER_INVALID",
    initCode: "REMOTE_RECOVERY_LEDGER_INVALID",
  });
  assert.doesNotMatch(child.stderr, /unhandledRejection|triggerUncaughtException/);

  const local = ensureRemoteRecoveryLedger({ dataRoot });
  await assert.rejects(() => local.list(), { code: "REMOTE_RECOVERY_LEDGER_INVALID" });
  await assert.rejects(() => local.assertHostWritable("h1"), { code: "REMOTE_RECOVERY_LEDGER_INVALID" });
});

test("registered write: injects transaction id, resolves definite completion, and retains uncertainty", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-registered-write-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const ledger = await createRemoteRecoveryLedger({ dataRoot }).init();
  let definiteTransactionId = null;

  const completed = await runRegisteredRemoteWrite(ledger, { hostId: "h1" }, "sync", async (transactionId) => {
    definiteTransactionId = transactionId;
    return { complete: true, status: "committed", transactionId };
  });
  assert.equal(completed.transactionId, definiteTransactionId);
  assert.match(definiteTransactionId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(await ledger.list(), []);

  const uncertain = await runRegisteredRemoteWrite(ledger, { hostId: "h1", projectId: "p1" }, "provider", async (transactionId) => (
    recovery("provider", transactionId)
  ));
  assert.equal(uncertain.recoveryRegistryPersisted, true);
  assert.equal((await ledger.list())[0].transactionId, uncertain.transactionId);
});

test("registered write: host single-flight blocks a second transaction", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-registered-single-flight-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const ledger = await createRemoteRecoveryLedger({ dataRoot }).init();
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let firstEntered;
  const entered = new Promise((resolve) => { firstEntered = resolve; });
  const first = runRegisteredRemoteWrite(ledger, { hostId: "h1" }, "sync", async (transactionId) => {
    firstEntered();
    await firstGate;
    return { complete: true, status: "committed", transactionId };
  });
  await entered;

  await assert.rejects(
    () => runRegisteredRemoteWrite(ledger, { hostId: "h1", projectId: "p1" }, "graph", async () => ({})),
    { code: "REMOTE_RECOVERY_BLOCKED", httpStatus: 409 },
  );
  releaseFirst();
  await first;
});

test("registered reconcile: an active write cannot be released before its remote lock exists", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-registered-active-reconcile-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const ledger = await createRemoteRecoveryLedger({ dataRoot }).init();
  let releaseWrite;
  const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
  let enteredWrite;
  const entered = new Promise((resolve) => { enteredWrite = resolve; });
  let transactionId;
  let remoteReconcileCalls = 0;
  const write = runRegisteredRemoteWrite(ledger, { hostId: "h1" }, "sync", async (nextTransactionId) => {
    transactionId = nextTransactionId;
    enteredWrite();
    await writeGate;
    return { complete: true, status: "committed", transactionId: nextTransactionId };
  });
  await entered;

  await assert.rejects(
    () => reconcileRegisteredRemoteRecovery(
      ledger,
      { hostId: "h1" },
      { kind: "sync", transactionId },
      async () => {
        remoteReconcileCalls += 1;
        throw Object.assign(new Error("no lock"), { code: "REMOTE_RECOVERY_NOT_FOUND", httpStatus: 404 });
      },
    ),
    { code: "REMOTE_RECOVERY_PENDING", httpStatus: 409, recoveryRequired: true },
  );
  assert.equal(remoteReconcileCalls, 0);
  assert.equal((await ledger.list()).length, 1);

  releaseWrite();
  await write;
  assert.deepEqual(await ledger.list(), []);
});

test("registered reconcile: a restarted pre-registration with no remote lock releases idempotently", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-registered-reconcile-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const writerLedger = await createRemoteRecoveryLedger({ dataRoot }).init();
  const pending = await writerLedger.begin({ hostId: "h1", kind: "sync" });
  const ledger = await createRemoteRecoveryLedger({ dataRoot }).init();
  const missing = Object.assign(new Error("no lock"), { code: "REMOTE_RECOVERY_NOT_FOUND", httpStatus: 404 });

  const result = await reconcileRegisteredRemoteRecovery(
    ledger,
    { hostId: "h1" },
    { kind: "sync", transactionId: pending.transactionId },
    async () => { throw missing; },
  );
  assert.equal(result.recoveryRequired, false);
  assert.deepEqual(result.released, []);
  assert.deepEqual(await ledger.list(), []);
});

test("registered reconcile: an unregistered transaction never reaches the remote reconciler", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-registered-reconcile-absent-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const ledger = await createRemoteRecoveryLedger({ dataRoot }).init();
  let remoteReconcileCalls = 0;

  await assert.rejects(
    () => reconcileRegisteredRemoteRecovery(
      ledger,
      { hostId: "h1" },
      { kind: "sync", transactionId: TX1 },
      async () => { remoteReconcileCalls += 1; },
    ),
    { code: "REMOTE_RECOVERY_NOT_FOUND", httpStatus: 404 },
  );
  assert.equal(remoteReconcileCalls, 0);
});

test("registered write: alien recovery evidence cannot create a second transaction", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-registered-alien-evidence-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const ledger = await createRemoteRecoveryLedger({ dataRoot }).init();

  await assert.rejects(
    () => runRegisteredRemoteWrite(ledger, { hostId: "h1", projectId: "p1" }, "provider", async () => recovery("graph", TX2)),
    { code: "REMOTE_RECOVERY_IDENTITY_MISMATCH", httpStatus: 502, recoveryRequired: true },
  );
  const records = await ledger.list({ hostId: "h1" });
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, "provider");
  assert.notEqual(records[0].transactionId, TX2);
  assert.equal(records[0].phase, "recovery_required");
});

test("registered reconcile: target scope is exact and cannot drift between host and project", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-registered-scope-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const writer = await createRemoteRecoveryLedger({ dataRoot }).init();
  const record = await writer.record({ hostId: "h1", projectId: "p1", ...recovery("provider", TX1) });
  const ledger = await createRemoteRecoveryLedger({ dataRoot }).init();
  let remoteCalls = 0;

  await assert.rejects(
    () => reconcileRegisteredRemoteRecovery(
      ledger,
      { hostId: "h1", projectId: null },
      { kind: record.kind, transactionId: record.transactionId },
      async () => { remoteCalls += 1; },
    ),
    { code: "REMOTE_RECOVERY_SCOPE_MISMATCH", httpStatus: 409 },
  );
  assert.equal(remoteCalls, 0);
  assert.equal((await ledger.list())[0].targetKey, "project:p1");
});

test("registered reconcile: concurrent callers are single-flight and cannot resurrect a released record", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-registered-reconcile-single-flight-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const ledger = await createRemoteRecoveryLedger({ dataRoot }).init();
  await ledger.record({ hostId: "h1", ...recovery("sync", TX1) });
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  let enteredFirst;
  const entered = new Promise((resolve) => { enteredFirst = resolve; });
  const first = reconcileRegisteredRemoteRecovery(
    ledger,
    { hostId: "h1", projectId: null },
    { kind: "sync", transactionId: TX1 },
    async () => {
      enteredFirst();
      await gate;
      return { kind: "sync", transactionId: TX1, recoveryRequired: false, released: [] };
    },
  );
  await entered;

  await assert.rejects(
    () => reconcileRegisteredRemoteRecovery(
      ledger,
      { hostId: "h1", projectId: null },
      { kind: "sync", transactionId: TX1 },
      async () => recovery("sync", TX1),
    ),
    { code: "REMOTE_RECOVERY_RECONCILE_IN_PROGRESS", httpStatus: 409, recoveryRequired: true },
  );
  releaseFirst();
  await first;
  assert.deepEqual(await ledger.list(), []);
});

test("registered reconcile: missing remote metadata releases only provisional records", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "514cc-registered-phase-aware-not-found-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const ledger = await createRemoteRecoveryLedger({ dataRoot }).init();
  await ledger.record({ hostId: "h1", ...recovery("sync", TX1) });
  const missing = Object.assign(new Error("no lock"), { code: "REMOTE_RECOVERY_NOT_FOUND", httpStatus: 404 });

  await assert.rejects(
    () => reconcileRegisteredRemoteRecovery(
      ledger,
      { hostId: "h1", projectId: null },
      { kind: "sync", transactionId: TX1 },
      async () => { throw missing; },
    ),
    (error) => error === missing && error.recoveryRequired === true && error.transactionId === TX1,
  );
  assert.equal((await ledger.list())[0].phase, "recovery_required");
});
