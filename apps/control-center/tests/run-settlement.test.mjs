import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_LANDING_ACTIONS,
  RUN_SETTLEMENT_SCHEMA,
  collectRunSettlement,
  synthesizeRunSettlement,
} from "../src/run-settlement.mjs";

const WORKTREE_RUN = Object.freeze({
  id: "run-settlement-1",
  status: "succeeded",
  worktreePath: "I:/tmp/demo-repo-wt-20260818153000-abcd1234",
  worktreeBase: "I:/tmp/demo-repo",
});

test("remote runs stay remote-unsupported and never auto-land", () => {
  const record = synthesizeRunSettlement({
    run: { id: "run-remote", status: "succeeded", remote: { hostId: "box", path: "/opt/app" } },
  });
  assert.equal(record.schema, RUN_SETTLEMENT_SCHEMA);
  assert.equal(record.verdict, "remote-unsupported");
  assert.equal(record.isolation, "remote-unsupported");
  assert.deepEqual(record.autoLanding, AUTO_LANDING_ACTIONS);
  assert.equal(record.diff.endpoint, null);
  assert.equal(record.nextAction.id, "remote-unsupported");
});

test("dirty terminal worktree is reviewable, still refuses merge", () => {
  const record = synthesizeRunSettlement({
    run: WORKTREE_RUN,
    diffSummary: { available: true, dirty: true, filesChanged: 2, additions: 4, deletions: 1 },
  });
  assert.equal(record.verdict, "reviewable");
  assert.equal(record.autoLanding.merge, false);
  assert.equal(record.diff.dirty, true);
  assert.equal(record.nextAction.id, "review-diff");
  assert.match(record.nextAction.reason, /不会自动 merge/);
});

test("recovery required blocks landing even with a dirty worktree", () => {
  const record = synthesizeRunSettlement({
    run: { ...WORKTREE_RUN, status: "recovery_required", recoveryRequired: true },
    diffSummary: { available: true, dirty: true },
  });
  assert.equal(record.verdict, "blocked");
  assert.ok(record.risks.some((item) => item.id === "recovery"));
});

test("missing worktree stays partial and does not invent a diff endpoint", () => {
  const record = synthesizeRunSettlement({
    run: { id: "run-plan", status: "succeeded", cwd: "I:/tmp/demo-repo" },
  });
  assert.equal(record.verdict, "partial");
  assert.equal(record.diff.endpoint, null);
  assert.ok(record.risks.some((item) => item.id === "no-worktree"));
});

test("collectRunSettlement probes diff only when asked and never merges", async () => {
  let probed = 0;
  const record = await collectRunSettlement({
    run: WORKTREE_RUN,
    includeDiff: true,
    summarizeDiff: async () => {
      probed += 1;
      return { available: true, dirty: true, filesChanged: 1, additions: 3, deletions: 0 };
    },
  });
  assert.equal(probed, 1);
  assert.equal(record.verdict, "reviewable");
  const skipped = await collectRunSettlement({
    run: WORKTREE_RUN,
    includeDiff: false,
    summarizeDiff: async () => {
      probed += 1;
      return { available: true, dirty: true };
    },
  });
  assert.equal(probed, 1);
  assert.equal(skipped.verdict, "partial");
  assert.ok(skipped.risks.some((item) => item.id === "diff-unprobed"));
});
