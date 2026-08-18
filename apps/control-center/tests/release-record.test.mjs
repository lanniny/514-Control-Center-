import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUTO_GIT_ACTIONS,
  RELEASE_RECORD_SCHEMA,
  classifyReleaseGate,
  collectReleaseRecord,
  createReleaseCommandEvidenceStore,
  normalizeCommandEvidence,
  summarizeServerObservedValidation,
  synthesizeReleaseRecord,
} from "../src/release-record.mjs";

const RUNTIME = Object.freeze({
  pid: 4242,
  generation: 4,
  startedAt: "2026-08-18T00:00:00.000Z",
});

const ACTIVE_TRUTH = Object.freeze({
  sourceCommit: "abc123",
  diffDigest: "digest",
  dirty: false,
  consistency: "consistent",
  runtimeGeneration: RUNTIME.generation,
  pid: RUNTIME.pid,
  cwd: "I:/514claude/514cc",
  startedAt: RUNTIME.startedAt,
  activation: { claimed: true, text: "已对账 abc123 generation=4" },
});

const PASSED_COMMANDS = Object.freeze({
  validate: { status: "passed", exitCode: 0, durationMs: 10, sourceCommit: "abc123", diffDigest: "digest", workspaceClean: true, checkedAt: "2026-08-18T01:00:00.000Z", provenance: "server-observed", runtimePid: RUNTIME.pid, runtimeGeneration: RUNTIME.generation, runtimeStartedAt: RUNTIME.startedAt },
  focusedTests: { status: "passed", exitCode: 0, durationMs: 20, sourceCommit: "abc123", diffDigest: "digest", workspaceClean: true, checkedAt: "2026-08-18T01:00:00.000Z", provenance: "server-observed", runtimePid: RUNTIME.pid, runtimeGeneration: RUNTIME.generation, runtimeStartedAt: RUNTIME.startedAt },
  fullTests: { status: "passed", exitCode: 0, durationMs: 30, sourceCommit: "abc123", diffDigest: "digest", workspaceClean: true, checkedAt: "2026-08-18T01:00:00.000Z", provenance: "server-observed", runtimePid: RUNTIME.pid, runtimeGeneration: RUNTIME.generation, runtimeStartedAt: RUNTIME.startedAt },
  browserQa: { status: "passed", exitCode: 0, durationMs: 40, sourceCommit: "abc123", diffDigest: "digest", workspaceClean: true, checkedAt: "2026-08-18T01:00:00.000Z", provenance: "server-observed", runtimePid: RUNTIME.pid, runtimeGeneration: RUNTIME.generation, runtimeStartedAt: RUNTIME.startedAt },
});

test("normalizeCommandEvidence refuses to keep passed without commit/time", () => {
  const [validate] = normalizeCommandEvidence({
    validate: { status: "passed", exitCode: 0 },
  }, { sourceCommit: "abc123", diffDigest: "digest", runtime: RUNTIME });
  assert.equal(validate.status, "unknown");
  assert.equal(validate.matchesSource, false);
});

test("release gate stays blocked on undeclared sources and never auto-gits", () => {
  const record = synthesizeReleaseRecord({
    deliveryManifest: {
      clean: false,
      strictFailure: true,
      ownership: {
        cut: { id: "v42", formalRelease: false },
        undeclaredSourceOrTests: ["apps/control-center/src/new.mjs"],
      },
    },
    releaseTruth: ACTIVE_TRUTH,
    commands: PASSED_COMMANDS,
  });
  assert.equal(record.schema, RELEASE_RECORD_SCHEMA);
  assert.equal(record.verdict, "blocked");
  assert.equal(record.publishable, false);
  assert.deepEqual(record.autoGit, AUTO_GIT_ACTIONS);
  assert.ok(record.unfinished.some((item) => item.id === "undeclared-source" && item.status === "blocked"));
});

test("engineering ready can be true while formal release stays partial", () => {
  const record = synthesizeReleaseRecord({
    deliveryManifest: {
      clean: true,
      strictFailure: false,
      ownership: { cut: { id: "v42", formalRelease: false }, undeclaredSourceOrTests: [] },
      missingSourceOrTests: [],
    },
    releaseTruth: ACTIVE_TRUTH,
    commands: PASSED_COMMANDS,
  });
  assert.equal(record.verdict, "ready");
  assert.equal(record.publishable, false);
  assert.ok(record.unfinished.some((item) => item.id === "formal-release" && item.status === "partial"));
  assert.equal(record.nextAction.id, "formal-release");
});

test("publishable requires formalRelease plus activated consistent runtime", () => {
  const record = synthesizeReleaseRecord({
    deliveryManifest: {
      clean: true,
      strictFailure: false,
      ownership: { cut: { id: "v42", formalRelease: true }, undeclaredSourceOrTests: [] },
      missingSourceOrTests: [],
    },
    releaseTruth: ACTIVE_TRUTH,
    commands: PASSED_COMMANDS,
  });
  assert.equal(record.verdict, "ready");
  assert.equal(record.publishable, true);
  assert.equal(record.nextAction.id, "publishable");
});

test("unknown consistency cannot be forged ready by a claimed activation", () => {
  const record = synthesizeReleaseRecord({
    deliveryManifest: {
      clean: true,
      strictFailure: false,
      ownership: { cut: { id: "v42", formalRelease: true }, undeclaredSourceOrTests: [] },
      missingSourceOrTests: [],
    },
    releaseTruth: { ...ACTIVE_TRUTH, consistency: "unknown", activation: { claimed: true, text: "client claim" } },
    commands: PASSED_COMMANDS,
  });
  assert.equal(record.verdict, "unknown");
  assert.equal(record.publishable, false);
  assert.equal(record.runtime.activated, false);
  assert.equal(record.activation.claimed, false);
  assert.equal(record.nextAction.id, "runtime-consistency");
});

test("operator-attested command rows keep the engineering gate partial", () => {
  const commands = Object.fromEntries(Object.entries(PASSED_COMMANDS).map(([id, value]) => [
    id,
    { ...value, provenance: "operator-attested" },
  ]));
  const record = synthesizeReleaseRecord({
    deliveryManifest: {
      clean: true,
      strictFailure: false,
      ownership: { cut: { id: "v42", formalRelease: true }, undeclaredSourceOrTests: [] },
      missingSourceOrTests: [],
    },
    releaseTruth: ACTIVE_TRUTH,
    commands,
  });
  assert.equal(record.verdict, "partial");
  assert.equal(record.publishable, false);
  assert.match(record.nextAction.text, /操作者自述/);
});

test("command evidence commit mismatch keeps gate partial", () => {
  const commands = normalizeCommandEvidence({
    ...PASSED_COMMANDS,
    validate: { ...PASSED_COMMANDS.validate, sourceCommit: "other" },
  }, { sourceCommit: "abc123", diffDigest: "digest", runtime: RUNTIME });
  assert.equal(classifyReleaseGate({
    commands,
    unfinished: [],
    releaseTruth: ACTIVE_TRUTH,
  }), "partial");
});

test("server-observed evidence without the current clean-worktree digest cannot open the gate", () => {
  const commands = normalizeCommandEvidence({
    ...PASSED_COMMANDS,
    validate: { ...PASSED_COMMANDS.validate, diffDigest: "stale-digest" },
  }, { sourceCommit: "abc123", diffDigest: "digest", runtime: RUNTIME });
  assert.equal(commands[0].matchesSource, true);
  assert.equal(commands[0].matchesWorkspace, false);
  assert.equal(classifyReleaseGate({
    commands,
    unfinished: [],
    releaseTruth: ACTIVE_TRUTH,
  }), "partial");
});

test("server-observed commands aggregate only for the current runtime instance", () => {
  const summary = summarizeServerObservedValidation(PASSED_COMMANDS, { runtime: RUNTIME });
  assert.equal(summary.status, "passed");
  assert.equal(summary.sourceCommit, "abc123");
  assert.deepEqual(summary.commands, ["validate", "focusedTests", "fullTests", "browserQa"]);
  assert.equal(summary.runtimePid, RUNTIME.pid);
  assert.equal(summary.complete, true);

  assert.equal(summarizeServerObservedValidation(PASSED_COMMANDS, {
    runtime: { ...RUNTIME, startedAt: "2026-08-18T00:00:01.000Z" },
  }), null);
  assert.equal(summarizeServerObservedValidation({
    ...PASSED_COMMANDS,
    fullTests: { ...PASSED_COMMANDS.fullTests, provenance: "operator-attested" },
  }, { runtime: RUNTIME }), null);
});

test("current immutable inputs may reuse successful command evidence across run ids", () => {
  const commands = Object.fromEntries(Object.entries(PASSED_COMMANDS).map(([id, value]) => [
    id,
    { ...value, runId: `run-${id}` },
  ]));
  const summary = summarizeServerObservedValidation(commands, { runtime: RUNTIME });
  assert.equal(summary.status, "passed");
  assert.deepEqual(summary.commands, ["validate", "focusedTests", "fullTests", "browserQa"]);
});

test("server-observed evidence from a previous runtime cannot open the engineering gate", () => {
  const commands = Object.fromEntries(Object.entries(PASSED_COMMANDS).map(([id, value]) => [
    id,
    { ...value, runtimeGeneration: RUNTIME.generation - 1 },
  ]));
  const record = synthesizeReleaseRecord({
    deliveryManifest: {
      clean: true,
      strictFailure: false,
      ownership: { cut: { id: "v42", formalRelease: false }, undeclaredSourceOrTests: [] },
      missingSourceOrTests: [],
    },
    releaseTruth: ACTIVE_TRUTH,
    commands,
  });
  assert.equal(record.verdict, "partial");
  assert.equal(record.publishable, false);
  assert.match(record.nextAction.text, /当前运行实例/);
});

test("collectReleaseRecord refuses to execute QA commands", async () => {
  await assert.rejects(
    () => collectReleaseRecord({ repoRoot: process.cwd(), executeCommands: true }),
    (error) => error.code === "RELEASE_RECORD_NO_EXECUTE",
  );
});

test("release command evidence store treats HTTP-facing saves as operator attestations", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "cc-release-"));
  try {
    const store = createReleaseCommandEvidenceStore({ dataRoot });
    await assert.rejects(
      () => store.save({ validate: { status: "passed", exitCode: 0, durationMs: 1 } }),
      (error) => error.code === "RELEASE_COMMAND_EVIDENCE_INCOMPLETE",
    );
    await store.save({
      validate: {
        status: "passed",
        exitCode: 0,
        durationMs: 12,
        sourceCommit: "abc123",
        checkedAt: "2026-08-18T02:00:00.000Z",
        provenance: "server-observed",
      },
    });
    const snapshot = await store.snapshot();
    assert.equal(snapshot.validate.status, "passed");
    assert.equal(snapshot.validate.sourceCommit, "abc123");
    assert.equal(snapshot.validate.provenance, "operator-attested");
    assert.equal(snapshot.validate.evidenceTrust, "operator-attested");
    const onDisk = JSON.parse(await readFile(join(dataRoot, "release-command-evidence.json"), "utf8"));
    assert.equal(onDisk.schema, "514cc.release-command-evidence/v1");
    assert.equal(onDisk.commands.validate.exitCode, 0);
    assert.equal(onDisk.commands.validate.provenance, "operator-attested");

    await assert.rejects(
      () => store.saveObserved({
        validate: { status: "passed", exitCode: 0, durationMs: 8, sourceCommit: "abc123" },
      }),
      (error) => error.code === "RELEASE_COMMAND_EVIDENCE_INCOMPLETE",
    );
    await store.saveObserved({
      validate: {
        status: "passed",
        exitCode: 0,
        durationMs: 8,
        sourceCommit: "abc123",
        diffDigest: "digest",
        workspaceClean: true,
        runtimePid: RUNTIME.pid,
        runtimeGeneration: RUNTIME.generation,
        runtimeStartedAt: RUNTIME.startedAt,
      },
    });
    const observed = await store.snapshot();
    assert.equal(observed.validate.provenance, "server-observed");
    assert.equal(observed.validate.evidenceTrust, "independent");
    assert.equal(observed.validate.diffDigest, "digest");
    assert.equal(observed.validate.workspaceClean, true);
    assert.equal(observed.validate.runtimePid, RUNTIME.pid);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
