import test from "node:test";
import assert from "node:assert/strict";
import { projectRunReplay, replayActionability } from "../src/run-replay.mjs";

const runId = "11111111-1111-4111-8111-111111111111";

test("replay is read-only and blocks auto replay for submitting/ambiguous", () => {
  assert.equal(replayActionability({ status: "submitting" }).replayable, false);
  assert.equal(replayActionability({ status: "submitted" }).canContinue, false);
  assert.equal(replayActionability({ status: "ambiguous" }).replayable, false);
  const recovery = replayActionability({ status: "recovery_required" });
  assert.equal(recovery.replayable, false);
  assert.equal(recovery.canContinue, true);
  assert.match(recovery.continueVia, /acknowledgeRecovery/);
});

test("replay timeline stitches events, bus, attempts, approvals and recovery notes", () => {
  const snapshot = projectRunReplay({
    run: {
      id: runId,
      status: "recovery_required",
      recoveryNote: "Inspect before continue",
      resumeClaim: { itemId: "item-1", claimedAt: "2026-08-18T01:00:00.000Z" },
      turnAttempts: [{ attemptId: "a1", agentId: "codex-technical", phase: "completed", createdAt: "2026-08-18T00:59:00.000Z" }],
      taskGraph: { tasks: [{ id: "t1" }], delegations: [{ id: "d1" }] },
    },
    events: [{ eventId: "e1", sequence: 1, type: "run.started", timestamp: "2026-08-18T00:58:00.000Z", runId, agentId: "claude-fable" }],
    busMessages: [{ id: "m1", kind: "ask", ts: "2026-08-18T00:58:30.000Z", from: "claude-fable" }],
    approvals: [{ id: "ap1", status: "pending", createdAt: "2026-08-18T00:59:30.000Z" }],
  });
  assert.equal(snapshot.schema, "514cc.run-replay/v1");
  assert.equal(snapshot.actionability.replayable, false);
  assert.ok(snapshot.timeline.some((item) => item.source === "event-store"));
  assert.ok(snapshot.timeline.some((item) => item.source === "bus"));
  assert.ok(snapshot.timeline.some((item) => item.source === "attempt"));
  assert.ok(snapshot.timeline.some((item) => item.source === "approval"));
  assert.ok(snapshot.timeline.some((item) => item.type === "recovery-note"));
  assert.equal(snapshot.taskGraph.source, "persisted");
  assert.doesNotMatch(JSON.stringify(snapshot), /Inspect before continue.{0,0}provider request created/);
});

test("native replay identities stay stable when older window entries are prepended", () => {
  const current = {
    run: {
      id: runId,
      status: "succeeded",
      turnAttempts: [{ attemptId: "attempt-stable", phase: "completed", createdAt: "2026-08-18T01:03:00.000Z" }],
    },
    events: [{ sequence: 42, type: "run.completed", timestamp: "2026-08-18T01:00:00.000Z" }],
    busMessages: [{ id: "message-stable", kind: "say", ts: "2026-08-18T01:01:00.000Z" }],
    approvals: [{ id: "approval-stable", status: "approved", createdAt: "2026-08-18T01:02:00.000Z" }],
  };
  const before = projectRunReplay(current);
  const after = projectRunReplay({
    ...current,
    run: {
      ...current.run,
      turnAttempts: [{ attemptId: "attempt-old", phase: "completed", createdAt: "2026-08-17T23:03:00.000Z" }, ...current.run.turnAttempts],
    },
    events: [{ sequence: 1, type: "run.created", timestamp: "2026-08-17T23:00:00.000Z" }, ...current.events],
    busMessages: [{ id: "message-old", kind: "say", ts: "2026-08-17T23:01:00.000Z" }, ...current.busMessages],
    approvals: [{ id: "approval-old", status: "approved", createdAt: "2026-08-17T23:02:00.000Z" }, ...current.approvals],
  });
  for (const nativeId of ["42", "message-stable", "attempt-stable", "approval-stable"]) {
    const field = nativeId === "42" ? "sequence"
      : nativeId.startsWith("message") ? "messageId"
        : nativeId.startsWith("attempt") ? "attemptId"
          : "approvalId";
    const expected = before.timeline.find((item) => String(item[field]) === nativeId);
    const actual = after.timeline.find((item) => String(item[field]) === nativeId);
    assert.ok(expected && actual, `${nativeId} should remain in both windows`);
    assert.equal(actual.id, expected.id);
  }
});
