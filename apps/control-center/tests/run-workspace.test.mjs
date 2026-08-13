import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { withDisposableQaRoot } from "../scripts/qa-team-workspace.mjs";
import { attestRunWorkspace, resolveRunWorkspace } from "../src/run-workspace.mjs";

const base = resolve("C:/qa/demo-repo");
const worktree = resolve("C:/qa/demo-repo-wt-20260807101500-deadbeef");

test("run workspace prefers an attested sibling worktree over the original cwd", () => {
  assert.deepEqual(resolveRunWorkspace({
    cwd: base,
    worktreePath: worktree,
    worktreeBase: base,
  }), {
    path: worktree,
    base,
    kind: "worktree",
  });
});

test("run workspace rejects incomplete or redirected worktree records", () => {
  assert.throws(
    () => resolveRunWorkspace({ worktreePath: worktree }),
    { code: "VALIDATION_FAILED" },
  );
  assert.throws(
    () => resolveRunWorkspace({
      worktreePath: resolve("C:/elsewhere/demo-repo-wt-20260807101500-deadbeef"),
      worktreeBase: base,
    }),
    { code: "VALIDATION_FAILED" },
  );
  assert.throws(
    () => resolveRunWorkspace({
      worktreePath: resolve("C:/qa/unrelated-wt-20260807101500-deadbeef"),
      worktreeBase: base,
    }),
    { code: "VALIDATION_FAILED" },
  );
});

test("run workspace falls back only when the run has no own directory", () => {
  assert.deepEqual(resolveRunWorkspace(null, { fallbackPath: base }), {
    path: base,
    base: null,
    kind: "control-center",
  });
  assert.deepEqual(resolveRunWorkspace({ cwd: base }, { fallbackPath: resolve("C:/other") }), {
    path: base,
    base: null,
    kind: "workspace",
  });
  assert.throws(
    () => resolveRunWorkspace({ cwd: base, permissionMode: "build", execute: true }, { fallbackPath: resolve("C:/other") }),
    { code: "WORKTREE_NOT_READY" },
  );
});

test("run workspace rejects a lookalike directory that is not a registered Git worktree", async () => {
  await withDisposableQaRoot(async (qaRoot) => {
    const repo = join(qaRoot, "repo");
    const lookalike = join(qaRoot, `${basename(repo)}-wt-20260807101500-deadbeef`);
    await Promise.all([mkdir(repo), mkdir(lookalike)]);
    await assert.rejects(
      () => attestRunWorkspace({ cwd: repo, worktreeBase: repo, worktreePath: lookalike }),
      { code: "WORKTREE_INVALID" },
    );
  });
});
