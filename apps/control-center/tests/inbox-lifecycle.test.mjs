import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyInboxTransition,
  createInboxLifecycleStore,
  inferInboxLifecycle,
  inboxRecordKey,
} from "../src/inbox-lifecycle.mjs";

test("inbox state machine is CAS + idempotent and ACK is not provider success", async () => {
  assert.equal(inferInboxLifecycle({ kind: "ask", runId: "r1", id: "a1" }), "delivered");
  const first = applyInboxTransition(null, { action: "answer", text: "采用方案", idempotencyKey: "k1" });
  assert.equal(first.state, "answered");
  assert.equal(first.ackMeansProviderSuccess, false);
  const replay = applyInboxTransition(first, { action: "answer", text: "采用方案", idempotencyKey: "k1" });
  assert.equal(replay.replayed, true);
  assert.equal(replay.revision, first.revision);
  const acked = applyInboxTransition(first, { action: "acknowledge", expectedRevision: first.revision });
  assert.equal(acked.state, "acknowledged");
  assert.throws(
    () => applyInboxTransition(first, { action: "acknowledge", expectedRevision: 99 }),
    (error) => error.code === "INBOX_CAS_CONFLICT",
  );
  assert.throws(
    () => applyInboxTransition(null, { action: "approve" }),
    (error) => error.code === "INBOX_HIGH_IMPACT_FORBIDDEN",
  );
  assert.throws(
    () => applyInboxTransition(null, { action: "answer", text: "   " }),
    (error) => error.code === "VALIDATION_FAILED",
  );
});

test("inbox store survives restart and keeps a single terminal state", async () => {
  const root = await mkdtemp(join(tmpdir(), "514cc-inbox-"));
  try {
    const store = createInboxLifecycleStore({ dataRoot: root });
    const first = await store.apply({
      runId: "run-a",
      messageId: "ask-1",
      action: "answer",
      text: "继续",
      idempotencyKey: "once",
    });
    const again = await store.apply({
      runId: "run-a",
      messageId: "ask-1",
      action: "answer",
      text: "继续",
      idempotencyKey: "once",
    });
    assert.equal(again.revision, first.revision);
    const restarted = createInboxLifecycleStore({ dataRoot: root });
    const snap = await restarted.snapshot();
    assert.equal(snap[inboxRecordKey("run-a", "ask-1")].state, "answered");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
