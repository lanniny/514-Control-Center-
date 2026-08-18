import test from "node:test";
import assert from "node:assert/strict";
import {
  activationClaim,
  classifyReleaseConsistency,
  collectReleaseTruth,
  RELEASE_TRUTH_SCHEMA,
} from "../src/release-truth.mjs";
import { closeStaleWorkflow, isWorkflowStale } from "../src/workflow-state.mjs";

const CLEAN_DIGEST = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

test("releaseTruth stays unknown without current-round validation evidence", () => {
  const snapshot = {
    sourceCommit: "abc123",
    dirty: false,
    runtimeGeneration: 2,
    validationEvidence: { status: "unknown" },
  };
  assert.equal(classifyReleaseConsistency(snapshot, { pidAlive: true }), "unknown");
  assert.equal(activationClaim({ ...snapshot, consistency: "unknown" }).claimed, false);
});

test("releaseTruth is consistent only when pid, commit and validation agree", () => {
  const snapshot = {
    sourceCommit: "abc123",
    dirty: false,
    runtimeGeneration: 3,
    validationEvidence: {
      status: "passed",
      sourceCommit: "abc123",
      matchesSource: true,
      matchesWorkspace: true,
      matchesRuntime: true,
      complete: true,
      provenance: "server-observed",
      evidenceTrust: "independent",
    },
  };
  assert.equal(classifyReleaseConsistency(snapshot, { pidAlive: true }), "consistent");
  assert.equal(classifyReleaseConsistency({
    ...snapshot,
    validationEvidence: { status: "passed" },
  }, { pidAlive: true }), "unknown");
  assert.equal(classifyReleaseConsistency({ ...snapshot, dirty: true }, { pidAlive: true }), "stale");
  assert.equal(classifyReleaseConsistency({
    ...snapshot,
    validationEvidence: { ...snapshot.validationEvidence, status: "failed" },
  }, { pidAlive: true }), "degraded");
  assert.equal(activationClaim({
    ...snapshot,
    consistency: "consistent",
    sourceCommit: "abc123def456",
    runtimeGeneration: 3,
  }).claimed, true);
});

test("collectReleaseTruth records digest metadata and refuses to claim activation from history", async () => {
  const truth = await collectReleaseTruth({
    repoRoot: "C:/repo",
    runtime: { pid: process.pid, generation: 1, cwd: "C:/repo", startedAt: "2026-08-18T00:00:00.000Z" },
    runner: async (command, args) => {
      if (args.includes("rev-parse")) return { code: 0, stdout: "deadbeef\n", stderr: "" };
      return { code: 0, stdout: " M apps/control-center/src/app.mjs\n", stderr: "" };
    },
  });
  assert.equal(truth.schema, RELEASE_TRUTH_SCHEMA);
  assert.equal(truth.sourceCommit, "deadbeef");
  assert.equal(truth.dirty, true);
  assert.equal(truth.consistency, "stale");
  assert.equal(truth.activation.claimed, false);
  assert.match(truth.activation.text, /未激活|未知/);
});

test("collectReleaseTruth rejects validation evidence from a previous runtime instance", async () => {
  const truth = await collectReleaseTruth({
    repoRoot: "C:/repo",
    runtime: {
      pid: process.pid,
      generation: 2,
      cwd: "C:/repo",
      startedAt: "2026-08-18T02:00:00.000Z",
    },
    validationEvidence: {
      status: "passed",
      sourceCommit: "deadbeef",
      commands: ["validate", "focusedTests", "fullTests", "browserQa"],
      checkedAt: "2026-08-18T02:01:00.000Z",
      diffDigest: CLEAN_DIGEST,
      workspaceClean: true,
      complete: true,
      provenance: "server-observed",
      evidenceTrust: "independent",
      runtimePid: process.pid,
      runtimeGeneration: 1,
      runtimeStartedAt: "2026-08-18T01:00:00.000Z",
    },
    runner: async (_command, args) => args.includes("rev-parse")
      ? { code: 0, stdout: "deadbeef\n", stderr: "" }
      : { code: 0, stdout: "", stderr: "" },
  });
  assert.equal(truth.validationEvidence.matchesSource, true);
  assert.equal(truth.validationEvidence.matchesRuntime, false);
  assert.equal(truth.consistency, "unknown");
  assert.equal(truth.activation.claimed, false);
});

test("collectReleaseTruth does not trust a caller-supplied partial passed claim", async () => {
  const runtime = {
    pid: process.pid,
    generation: 2,
    cwd: "C:/repo",
    startedAt: "2026-08-18T02:00:00.000Z",
  };
  const truth = await collectReleaseTruth({
    repoRoot: "C:/repo",
    runtime,
    validationEvidence: {
      status: "passed",
      sourceCommit: "deadbeef",
      commands: ["validate"],
      checkedAt: "2026-08-18T02:01:00.000Z",
      runtimePid: runtime.pid,
      runtimeGeneration: runtime.generation,
      runtimeStartedAt: runtime.startedAt,
    },
    runner: async (_command, args) => args.includes("rev-parse")
      ? { code: 0, stdout: "deadbeef\n", stderr: "" }
      : { code: 0, stdout: "", stderr: "" },
  });
  assert.equal(truth.validationEvidence.matchesSource, true);
  assert.equal(truth.validationEvidence.matchesRuntime, true);
  assert.equal(truth.validationEvidence.complete, false);
  assert.equal(truth.consistency, "unknown");
  assert.equal(truth.activation.claimed, false);
});

test("collectReleaseTruth treats a non-zero git probe as unknown, never clean", async () => {
  const truth = await collectReleaseTruth({
    repoRoot: "C:/repo",
    runtime: { pid: process.pid, generation: 1, cwd: "C:/repo" },
    validationEvidence: {
      status: "passed",
      sourceCommit: "deadbeef",
      commands: ["validate"],
      checkedAt: "2026-08-18T00:00:00.000Z",
      diffDigest: CLEAN_DIGEST,
      workspaceClean: true,
      complete: true,
      provenance: "server-observed",
      evidenceTrust: "independent",
      runtimePid: process.pid,
      runtimeGeneration: 1,
      runtimeStartedAt: "2026-08-18T00:00:00.000Z",
    },
    runner: async (_command, args) => args.includes("rev-parse")
      ? { code: 0, stdout: "deadbeef\n", stderr: "" }
      : { code: 128, stdout: "", stderr: "fatal" },
  });
  assert.equal(truth.sourceCommit, "deadbeef");
  assert.equal(truth.diffDigest, null);
  assert.match(truth.gitError, /git status exited 128/);
  assert.equal(truth.consistency, "unknown");
  assert.equal(truth.activation.claimed, false);
});

test("stale workflow packets close to superseded instead of hanging in_progress", () => {
  const hanging = {
    status: "executing",
    updated_at: "2026-08-15T22:00:00+08:00",
    packets: [
      { id: "01", status: "in_progress" },
      { id: "02", status: "pending" },
      { id: "03", status: "complete" },
    ],
    verification: { status: "pending", checks: [] },
  };
  assert.equal(isWorkflowStale(hanging, { now: Date.parse("2026-08-18T06:44:00+08:00") }), true);
  const closed = closeStaleWorkflow(hanging, {
    reason: "superseded by r0-trusted-baseline-20260818",
    successor: "r0-trusted-baseline-20260818",
    now: "2026-08-18T06:44:00+08:00",
  });
  assert.equal(closed.status, "superseded");
  assert.deepEqual(closed.packets.map((packet) => packet.status), ["superseded", "superseded", "complete"]);
  assert.equal(closed.verification.status, "superseded");
});
