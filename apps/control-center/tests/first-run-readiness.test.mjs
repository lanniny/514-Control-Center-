import test from "node:test";
import assert from "node:assert/strict";
import { collectFirstRunReadiness } from "../src/first-run-readiness.mjs";

test("first-run checklist covers empty, missing seat, gated and ready states", () => {
  const empty = collectFirstRunReadiness({});
  assert.equal(empty.ready, false);
  assert.equal(empty.steps.find((item) => item.id === "project-anchor").status, "blocked");
  assert.equal(empty.steps.find((item) => item.id === "default-team").status, "blocked");

  const gated = collectFirstRunReadiness({
    projectBridge: { anchorId: "abc", consistency: "stale", diagnosis: "源码搬家后待确认" },
    teams: [{ id: "team-514cc", name: "514cc" }],
    runtimeCatalog: [{ id: "claude-fable", enabled: true, command: "claude" }],
    health: [{ id: "claude-fable", status: "online" }],
    healthMeta: { available: true, stale: false, capturedAt: "2026-08-18T10:00:00.000Z" },
    remoteGates: [{ id: "ssh", status: "blocked" }],
  });
  assert.equal(gated.steps.find((item) => item.id === "capability-gate").status, "gated");
  assert.match(gated.steps.find((item) => item.id === "capability-gate").nextStep, /门闸授权/);

  const ready = collectFirstRunReadiness({
    projectBridge: { anchorId: "abc", consistency: "consistent", diagnosis: "四面齐" },
    teams: [{ id: "team-514cc", name: "514cc" }],
    runtimeCatalog: [{ id: "claude-fable", enabled: true, adapter: "claude-stream-json" }],
    health: [{ id: "claude-fable", status: "online" }],
    healthMeta: { available: true, stale: false, capturedAt: "2026-08-18T10:00:00.000Z" },
  });
  assert.equal(ready.ready, true);
  assert.match(ready.nextAction.text, /当轮 readback/);

  const unpaidUnknown = collectFirstRunReadiness({
    projectBridge: { anchorId: "abc", consistency: "consistent", diagnosis: "四面齐" },
    teams: [{ id: "team-514cc", name: "514cc" }],
    runtimeCatalog: [{ id: "claude-fable", enabled: true, adapter: "claude-stream-json" }],
  });
  assert.equal(unpaidUnknown.ready, false);
  assert.equal(unpaidUnknown.steps.find((item) => item.id === "unpaid-validation").status, "attention");

  const staleHealth = collectFirstRunReadiness({
    projectBridge: { anchorId: "abc", consistency: "consistent", diagnosis: "四面齐" },
    teams: [{ id: "team-514cc", name: "514cc" }],
    runtimeCatalog: [{ id: "claude-fable", enabled: true, adapter: "claude-stream-json" }],
    health: [{ id: "claude-fable", status: "online" }],
    healthMeta: { available: true, stale: true, capturedAt: "2026-08-18T09:00:00.000Z" },
  });
  assert.equal(staleHealth.steps.find((item) => item.id === "unpaid-validation").status, "attention");

  const staleEvidence = collectFirstRunReadiness({
    projectBridge: { anchorId: "abc", consistency: "consistent", diagnosis: "四面齐" },
    teams: [{ id: "team-514cc", name: "514cc" }],
    runtimeCatalog: [{ id: "claude-fable", enabled: true, adapter: "claude-stream-json" }],
    releaseTruth: {
      consistency: "stale",
      validationEvidence: { status: "passed", sourceCommit: "old", matchesSource: false },
    },
  });
  const staleStep = staleEvidence.steps.find((item) => item.id === "unpaid-validation");
  assert.equal(staleStep.status, "attention");
  assert.match(staleStep.detail, /历史验证记录|未与当前提交/);

  const alignedEvidence = collectFirstRunReadiness({
    projectBridge: { anchorId: "abc", consistency: "consistent", diagnosis: "四面齐" },
    teams: [{ id: "team-514cc", name: "514cc" }],
    runtimeCatalog: [{ id: "claude-fable", enabled: true, adapter: "claude-stream-json" }],
    releaseTruth: {
      consistency: "consistent",
      validationEvidence: { status: "passed", sourceCommit: "abc", matchesSource: true },
    },
  });
  assert.equal(alignedEvidence.steps.find((item) => item.id === "unpaid-validation").status, "ready");
});
