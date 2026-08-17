import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REMOTE_GATE_IDS,
  assertRemoteGate,
  createRemoteGateService,
  listRemoteGates,
  remoteGateSnapshot,
} from "../src/security/remote-gates.mjs";

test("remote gates are fail-closed and enumerable", () => {
  const gates = listRemoteGates();
  assert.ok(gates.length >= 8);
  assert.ok(gates.every((gate) => gate.enabled === false));
  assert.ok(gates.every((gate) => gate.openable === false));
  assert.ok(REMOTE_GATE_IDS.includes("channels"));
  assert.ok(REMOTE_GATE_IDS.includes("gateway"));
});

test("assertRemoteGate blocks unauthorized surfaces with 501 semantics", () => {
  assert.throws(() => assertRemoteGate("channels"), { code: "REMOTE_GATE_BLOCKED" });
  assert.throws(() => assertRemoteGate("gateway"), { code: "REMOTE_GATE_BLOCKED" });
  assert.throws(() => assertRemoteGate("office"), { code: "REMOTE_GATE_BLOCKED" });
  assert.throws(() => assertRemoteGate("pty"), { code: "REMOTE_GATE_BLOCKED" });
  assert.throws(() => assertRemoteGate("ssh"), { code: "REMOTE_GATE_BLOCKED" });
  try {
    assertRemoteGate("channels");
  } catch (error) {
    assert.equal(error.httpStatus, 501);
  }
});

test("authorized but unimplemented gates still refuse (no silent enable)", () => {
  assert.throws(
    () => assertRemoteGate("channels", { authorized: ["channels"] }),
    { code: "REMOTE_GATE_NOT_IMPLEMENTED" },
  );
});

test("authorized + implemented gates open via pure assertion", () => {
  assert.doesNotThrow(() => assertRemoteGate("pty", { authorized: ["pty"], implemented: ["pty"] }));
  const gate = listRemoteGates({ authorized: ["pty"], implemented: ["pty"] }).find((g) => g.id === "pty");
  assert.equal(gate.status, "open");
  assert.equal(gate.enabled, true);
  assert.equal(gate.openable, true);
});

test("unknown gates are rejected distinctly", () => {
  assert.throws(() => assertRemoteGate("nope"), { code: "REMOTE_GATE_UNKNOWN" });
});

test("snapshot is structured for Configure/Security UI", () => {
  const snap = remoteGateSnapshot();
  assert.equal(snap.policy, "fail-closed");
  assert.equal(snap.schema, "514cc.remote-gates/v2");
  assert.equal(snap.revocationSemantics.mode, "block-future-dispatches");
  assert.equal(snap.revocationSemantics.activeRemoteExecutions, "not-automatically-cancelled");
  assert.ok(Array.isArray(snap.gates));
});

test("gate service persists grants to an auditable ledger and survives reload", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-gates-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const events = [];
  const eventStore = { append: async (event) => { events.push(event); } };

  const service = await createRemoteGateService({ dataRoot: dir, eventStore }).init();
  assert.equal(service.list().find((g) => g.id === "pty").status, "blocked");
  assert.throws(() => service.assert("pty"), { code: "REMOTE_GATE_BLOCKED" });

  await service.grant("pty", { source: "LO conversation 2026-07-25", note: "wave g" });
  assert.equal(service.list().find((g) => g.id === "pty").status, "granted");
  assert.throws(() => service.assert("pty"), { code: "REMOTE_GATE_NOT_IMPLEMENTED" });

  service.registerImplementation("pty");
  assert.doesNotThrow(() => service.assert("pty"));
  assert.equal(service.isOpen("pty"), true);

  const ledger = JSON.parse(await readFile(join(dir, "remote-gates.grants.json"), "utf8"));
  assert.equal(ledger.schema, "514cc.remote-gates.grants/v1");
  assert.equal(ledger.grants.length, 1);
  assert.equal(ledger.grants[0].gate, "pty");
  assert.equal(ledger.grants[0].source, "LO conversation 2026-07-25");
  assert.ok(events.some((event) => event.type === "remote_gate.grant" && event.gate === "pty"));

  // 重启（新实例同一 dataRoot）后 grant 仍在
  const revived = await createRemoteGateService({ dataRoot: dir }).init();
  assert.equal(revived.list().find((g) => g.id === "pty").status, "granted");

  await service.revoke("pty");
  assert.equal(service.list().find((g) => g.id === "pty").status, "blocked");
  assert.ok(events.some((event) => event.type === "remote_gate.revoke" && event.gate === "pty"));
});

test("grant of unknown gate is rejected", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-gates-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = await createRemoteGateService({ dataRoot: dir }).init();
  await assert.rejects(() => service.grant("nope"), { code: "REMOTE_GATE_UNKNOWN" });
});

test("grant persistence failure stays blocked and the mutation queue can retry", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-gates-failure-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let failRename = true;
  const storage = {
    mkdir,
    readFile,
    writeFile,
    rename: async (...args) => {
      if (failRename) throw Object.assign(new Error("rename failed"), { code: "EIO" });
      return rename(...args);
    },
  };
  const service = await createRemoteGateService({ dataRoot: dir, storage }).init();
  service.registerImplementation("ssh");
  await assert.rejects(
    () => service.grant("ssh"),
    (error) => error.code === "REMOTE_GATE_PERSISTENCE_FAILED" && error.httpStatus === 503 && error.causeCode === "EIO",
  );
  assert.equal(service.list().find((gate) => gate.id === "ssh").status, "blocked");
  assert.throws(() => service.assert("ssh"), { code: "REMOTE_GATE_BLOCKED" });

  failRename = false;
  await service.grant("ssh");
  assert.equal(service.list().find((gate) => gate.id === "ssh").status, "open");
  assert.doesNotThrow(() => service.assert("ssh"));
});

test("failed revoke blocks immediately and remains retryable until the ledger is closed", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-gates-revoke-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let failRename = false;
  const storage = {
    mkdir,
    readFile,
    writeFile,
    rename: async (...args) => {
      if (failRename) throw Object.assign(new Error("rename failed"), { code: "EIO" });
      return rename(...args);
    },
  };
  const service = await createRemoteGateService({ dataRoot: dir, storage }).init();
  service.registerImplementation("ssh");
  await service.grant("ssh");
  failRename = true;
  await assert.rejects(
    () => service.revoke("ssh"),
    (error) => error.code === "REMOTE_GATE_PERSISTENCE_FAILED" && error.httpStatus === 503 && error.causeCode === "EIO",
  );
  assert.equal(service.list().find((gate) => gate.id === "ssh").status, "blocked");
  assert.throws(() => service.assert("ssh"), { code: "REMOTE_GATE_BLOCKED" });
  const staleLedger = JSON.parse(await readFile(join(dir, "remote-gates.grants.json"), "utf8"));
  assert.equal(staleLedger.grants.some((entry) => entry.gate === "ssh"), true, "fixture must prove disk write really failed");

  // 关键重启边界：revoke 的 rename 失败留下 tombstone 临时文件时，新实例也不能从旧 grant 回生。
  const revivedWhileRevokePending = await createRemoteGateService({ dataRoot: dir }).init();
  revivedWhileRevokePending.registerImplementation("ssh");
  assert.equal(revivedWhileRevokePending.list().find((gate) => gate.id === "ssh").status, "blocked");
  assert.throws(() => revivedWhileRevokePending.assert("ssh"), { code: "REMOTE_GATE_BLOCKED" });

  failRename = false;
  await service.revoke("ssh");
  const closedLedger = JSON.parse(await readFile(join(dir, "remote-gates.grants.json"), "utf8"));
  assert.equal(closedLedger.grants.some((entry) => entry.gate === "ssh"), false);
  const revocationLedger = JSON.parse(await readFile(join(dir, "remote-gates.revocations.json"), "utf8"));
  assert.equal(revocationLedger.revocations.some((entry) => entry.gate === "ssh"), true);
  assert.equal(service.list().find((gate) => gate.id === "ssh").status, "blocked");
});

test("explicit grant clears a durable revoke only after the grant snapshot is written", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-gates-reauthorize-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = await createRemoteGateService({ dataRoot: dir }).init();
  service.registerImplementation("ssh");
  await service.grant("ssh");
  await service.revoke("ssh");

  await service.grant("ssh", { source: "explicit reauthorization" });
  const tombstones = JSON.parse(await readFile(join(dir, "remote-gates.revocations.json"), "utf8"));
  assert.equal(tombstones.revocations.some((entry) => entry.gate === "ssh"), false);
  assert.equal(service.list().find((gate) => gate.id === "ssh").status, "open");

  const revived = await createRemoteGateService({ dataRoot: dir }).init();
  revived.registerImplementation("ssh");
  assert.equal(revived.list().find((gate) => gate.id === "ssh").status, "open");
});
