import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  buildIsolatedServerEnv,
  createIsolatedQaRepo,
  withDisposableQaRoot,
} from "../scripts/qa-team-workspace.mjs";
import { spawnTestServer, stopTestServer, waitForUrl } from "./server-fixture.mjs";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

async function authorizedJson(origin, token, pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("authorization", `Bearer ${token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${origin}${pathname}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json();
  return { response, payload };
}

test("workbench environment HTTP surface is authenticated, run-scoped and persistent", { timeout: 120_000 }, async () => {
  await withDisposableQaRoot(async (qaRoot) => {
    const token = randomBytes(32).toString("base64url");
    const repoRoot = await createIsolatedQaRepo(qaRoot);
    const remoteRoot = join(qaRoot, "origin.git");
    const redirectedRemoteRoot = join(qaRoot, "redirected.git");
    const rewriteConfigKey = `url.${redirectedRemoteRoot}.insteadOf`;
    const sourcePath = join(repoRoot, "lo-reference.png");
    const secondSourcePath = join(repoRoot, "follow-up.md");
    const runId = "77777777-7777-4777-8777-777777777777";
    const buildRunId = "77777777-7777-4777-8777-777777777778";
    const pendingBuildRunId = "77777777-7777-4777-8777-777777777779";
    const cancelRunId = "77777777-7777-4777-8777-777777777780";
    const cancelAutomationId = "automation-cancel-source-projection";
    const worktreePath = join(qaRoot, `${basename(repoRoot)}-wt-20260807101500-deadbeef`);
    const env = buildIsolatedServerEnv({ qaRoot, token, testRepoRoot: repoRoot });

    git(repoRoot, ["init", "-b", "main"]);
    git(repoRoot, ["config", "user.name", "514cc QA"]);
    git(repoRoot, ["config", "user.email", "qa@514cc.local"]);
    git(repoRoot, ["add", "."]);
    git(repoRoot, ["commit", "-m", "qa baseline"]);
    git(qaRoot, ["init", "--bare", remoteRoot]);
    git(qaRoot, ["init", "--bare", redirectedRemoteRoot]);
    git(repoRoot, ["remote", "add", "origin", remoteRoot]);
    git(repoRoot, ["push", "-u", "origin", "main"]);
    await writeFile(join(repoRoot, "ahead.txt"), "ahead\n", "utf8");
    git(repoRoot, ["add", "ahead.txt"]);
    git(repoRoot, ["commit", "-m", "qa ahead"]);
    await writeFile(join(repoRoot, "staged.txt"), "staged\n", "utf8");
    git(repoRoot, ["add", "staged.txt"]);
    git(repoRoot, ["tag", "-a", "qa-follow-tag", "-m", "must not be pushed implicitly"]);
    git(repoRoot, ["config", "push.followTags", "true"]);
    git(repoRoot, ["config", rewriteConfigKey, remoteRoot]);
    const hookMarker = join(qaRoot, "pre-push-hook-ran.txt");
    await writeFile(join(repoRoot, ".git", "hooks", "pre-push"), `#!/bin/sh\nprintf hook-ran > '${hookMarker.replaceAll("\\", "/")}'\nexit 0\n`, "utf8");
    await chmod(join(repoRoot, ".git", "hooks", "pre-push"), 0o755);
    git(repoRoot, ["worktree", "add", "--detach", worktreePath]);
    await writeFile(join(worktreePath, "worktree-only.txt"), "isolated change\n", "utf8");
    git(worktreePath, ["add", "worktree-only.txt"]);
    await Promise.all([
      writeFile(sourcePath, "png fixture\n", "utf8"),
      writeFile(secondSourcePath, "follow up\n", "utf8"),
      mkdir(join(env.CONTROL_CENTER_DATA_DIR, "runs"), { recursive: true }),
      mkdir(env.CONTROL_CENTER_RUNTIME_HOME, { recursive: true }),
      mkdir(env.APPDATA, { recursive: true }),
      mkdir(env.LOCALAPPDATA, { recursive: true }),
      mkdir(env.XDG_CONFIG_HOME, { recursive: true }),
      mkdir(env.XDG_DATA_HOME, { recursive: true }),
      mkdir(env.XDG_CACHE_HOME, { recursive: true }),
    ]);

    const run = {
      id: runId,
      prompt: `验证环境舱\n\n[附件资料]\n- ${sourcePath}`,
      status: "succeeded",
      taskType: "coding",
      orchestrationMode: "social",
      permissionMode: "plan",
      coordinatorId: "claude-fable",
      startAgentId: "codex-technical",
      executionOwnerId: "codex-technical",
      teamId: "team-514cc",
      teamMembers: ["claude-fable", "codex-technical"],
      requestedAgentIds: [],
      cwd: repoRoot,
      sources: [{ kind: "file", path: sourcePath, name: "lo-reference.png" }],
      turns: [],
      turnAttempts: [{
        attemptId: "attempt-environment-http",
        agentId: "codex-technical",
        phase: "completed",
        sourceWorkItemId: "delegated-work-item",
        createdAt: "2026-08-07T00:00:00.000Z",
        updatedAt: "2026-08-07T00:01:00.000Z",
      }],
      inflightTurns: {},
      round: 1,
      maxRounds: 4,
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:01:00.000Z",
      result: "环境舱 QA 完成",
      error: null,
    };
    await writeFile(
      join(env.CONTROL_CENTER_DATA_DIR, "runs", `${runId}.json`),
      `${JSON.stringify(run, null, 2)}\n`,
      "utf8",
    );
    const pendingBuildRun = {
      ...run,
      id: pendingBuildRunId,
      prompt: "等待审批且尚未创建隔离工作树",
      permissionMode: "build",
      execute: true,
      status: "waiting_approval",
      buildApproval: { status: "pending" },
    };
    await writeFile(
      join(env.CONTROL_CENTER_DATA_DIR, "runs", `${pendingBuildRunId}.json`),
      `${JSON.stringify(pendingBuildRun, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(env.CONTROL_CENTER_DATA_DIR, "runs", `${cancelRunId}.json`),
      `${JSON.stringify({
        ...run,
        id: cancelRunId,
        prompt: "等待取消投影验证",
        status: "waiting_agent",
        pausedForInput: true,
        pendingAsk: { id: "cancel-projection-ask", from: "codex-technical", text: "等待操作员" },
      }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(env.CONTROL_CENTER_DATA_DIR, "events.jsonl"), `${JSON.stringify({
      schemaVersion: 1,
      eventId: "event-source-path",
      sequence: 1,
      timestamp: "2026-08-07T00:00:30.000Z",
      type: "user.message",
      runId,
      data: { text: `请读取 ${sourcePath}` },
    })}\n`, "utf8");
    const buildRun = {
      ...run,
      id: buildRunId,
      prompt: "验证隔离工作树环境舱",
      permissionMode: "build",
      worktreePath,
      worktreeBase: repoRoot,
    };
    await writeFile(
      join(env.CONTROL_CENTER_DATA_DIR, "runs", `${buildRunId}.json`),
      `${JSON.stringify(buildRun, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(env.CONTROL_CENTER_DATA_DIR, "automations.json"), `${JSON.stringify({
      version: 1,
      automations: [{
        id: cancelAutomationId,
        name: "取消响应来源投影",
        prompt: "取消等待审批任务",
        schedule: "manual",
        enabled: true,
        permissionMode: "build",
        sources: [{ kind: "file", path: sourcePath, name: "lo-reference.png" }],
        lastRunId: cancelRunId,
        lastRunAt: "2026-08-07T00:00:00.000Z",
        runHistory: [{ runId: cancelRunId, at: "2026-08-07T00:00:00.000Z", source: "manual", status: "waiting_agent" }],
        createdAt: "2026-08-07T00:00:00.000Z",
      }],
    }, null, 2)}\n`, "utf8");

    let child = spawnTestServer({ env });
    let origin = new URL(await waitForUrl(child, { timeoutMs: 30_000 })).origin;
    try {
      const unauthorized = await fetch(`${origin}/api/workbench/environment?runId=${runId}`);
      assert.equal(unauthorized.status, 401);

      const initial = await authorizedJson(origin, token, `/api/workbench/environment?runId=${runId}`);
      assert.equal(initial.response.status, 200);
      assert.equal(initial.payload.schema, "514cc.workbench.environment/v1");
      assert.equal(initial.payload.projectBridge?.schema, "514cc.project-bridge/v1");
      assert.match(String(initial.payload.projectBridge?.anchorId || ""), /^[0-9a-f]{32}$/);
      assert.notEqual(initial.payload.projectBridge?.consistency, "consistent");
      const ignoredCwd = await authorizedJson(origin, token, "/api/project-bridge?cwd=C:/definitely-not-a-project");
      assert.equal(ignoredCwd.response.status, 200);
      assert.equal(ignoredCwd.payload.schema, "514cc.project-bridge/v1");
      assert.doesNotMatch(String(ignoredCwd.payload.canonicalCwd || ""), /definitely-not-a-project/i);
      assert.equal(initial.payload.runId, runId);
      assert.equal(initial.payload.workspace.source, "run");
      assert.equal(initial.payload.git.available, true);
      assert.equal(initial.payload.git.branch, "main");
      assert.equal(initial.payload.git.upstream, "origin/main");
      assert.equal(initial.payload.git.ahead, 1);
      assert.equal(initial.payload.git.changes.staged, 1);
      assert.equal(initial.payload.git.changes.untracked, 2);
      assert.equal(initial.payload.agents.delegated, 1);
      assert.deepEqual(initial.payload.sources.items, [{ kind: "file", name: "lo-reference.png" }]);

      const publicRun = await authorizedJson(origin, token, `/api/runs/${runId}`);
      assert.equal(publicRun.response.status, 200);
      assert.deepEqual(publicRun.payload.sources, [{ kind: "file", name: "lo-reference.png" }]);
      assert.equal(JSON.stringify(publicRun.payload).includes(sourcePath), false);
      assert.match(publicRun.payload.prompt, /\[附件:lo-reference\.png\]/);

      const bootstrap = await authorizedJson(origin, token, "/api/bootstrap");
      assert.equal(bootstrap.response.status, 200);
      const bootstrapRun = bootstrap.payload.runs.find((item) => item.id === runId);
      assert.deepEqual(bootstrapRun.sources, [{ kind: "file", name: "lo-reference.png" }]);
      assert.equal(JSON.stringify(bootstrapRun).includes(sourcePath), false);

      const publicEvents = await authorizedJson(origin, token, `/api/runs/${runId}/events`);
      assert.equal(publicEvents.response.status, 200);
      assert.equal(JSON.stringify(publicEvents.payload).includes(sourcePath), false);
      assert.match(JSON.stringify(publicEvents.payload), /\[附件:lo-reference\.png\]/);

      const buildEnvironment = await authorizedJson(origin, token, `/api/workbench/environment?runId=${buildRunId}`);
      assert.equal(buildEnvironment.response.status, 200);
      assert.equal(buildEnvironment.payload.workspace.source, "worktree");
      assert.equal(buildEnvironment.payload.git.detached, true);
      assert.equal(buildEnvironment.payload.git.changes.staged, 1);
      assert.equal(buildEnvironment.payload.git.actions.commit.enabled, false);
      assert.equal(buildEnvironment.payload.git.actions.push.enabled, false);
      for (const action of ["commit", "push"]) {
        const blocked = await authorizedJson(origin, token, "/api/workbench/git/plan", {
          method: "POST",
          body: { runId: buildRunId, action, message: action === "commit" ? "blocked" : "" },
        });
        assert.equal(blocked.response.status, 422);
        assert.equal(blocked.payload.error.code, "DETACHED_HEAD");
      }

      const pendingEnvironment = await authorizedJson(origin, token, `/api/workbench/environment?runId=${pendingBuildRunId}`);
      assert.equal(pendingEnvironment.response.status, 422);
      assert.equal(pendingEnvironment.payload.error.code, "WORKTREE_NOT_READY");
      const pendingPlan = await authorizedJson(origin, token, "/api/workbench/git/plan", {
        method: "POST",
        body: { runId: pendingBuildRunId, action: "commit", message: "must not touch the source repo" },
      });
      assert.equal(pendingPlan.response.status, 422);
      assert.equal(pendingPlan.payload.error.code, "WORKTREE_NOT_READY");

      const cancelledAutomation = await authorizedJson(origin, token, `/api/automations/${cancelAutomationId}/cancel`, {
        method: "POST",
        body: {},
      });
      assert.equal(cancelledAutomation.response.status, 200, JSON.stringify(cancelledAutomation.payload));
      assert.deepEqual(cancelledAutomation.payload.sources, [{ kind: "file", name: "lo-reference.png" }]);
      assert.equal(JSON.stringify(cancelledAutomation.payload).includes(sourcePath), false);

      const missing = await authorizedJson(origin, token, "/api/workbench/environment?runId=missing-run");
      assert.equal(missing.response.status, 404);
      assert.equal(missing.payload.error.code, "RUN_NOT_FOUND");

      const sourceWrite = await authorizedJson(origin, token, `/api/runs/${runId}/sources`, {
        method: "POST",
        body: { sources: [secondSourcePath, sourcePath] },
      });
      assert.equal(sourceWrite.response.status, 200);
      assert.deepEqual(sourceWrite.payload.sources.map((item) => item.name), ["lo-reference.png", "follow-up.md"]);
      assert.equal(sourceWrite.payload.sources.some((item) => "path" in item), false);

      const commitPlan = await authorizedJson(origin, token, "/api/workbench/git/plan", {
        method: "POST",
        body: { runId, action: "commit", message: "qa commit preview" },
      });
      assert.equal(commitPlan.response.status, 200);
      assert.equal(commitPlan.payload.confirmation, "COMMIT");
      const headBefore = git(repoRoot, ["rev-parse", "HEAD"]);
      const rejectedExecute = await authorizedJson(origin, token, "/api/workbench/git/execute", {
        method: "POST",
        body: { planId: commitPlan.payload.planId, confirmation: "yes" },
      });
      assert.equal(rejectedExecute.response.status, 403);
      assert.equal(rejectedExecute.payload.error.code, "CONFIRMATION_REQUIRED");
      assert.equal(git(repoRoot, ["rev-parse", "HEAD"]), headBefore);

      const rewrittenPushPlan = await authorizedJson(origin, token, "/api/workbench/git/plan", {
        method: "POST",
        body: { runId, action: "push" },
      });
      assert.equal(rewrittenPushPlan.response.status, 422);
      assert.equal(rewrittenPushPlan.payload.error.code, "PUSH_URL_REWRITE");
      git(repoRoot, ["config", "--unset-all", rewriteConfigKey]);

      const pushPlan = await authorizedJson(origin, token, "/api/workbench/git/plan", {
        method: "POST",
        body: { runId, action: "push" },
      });
      assert.equal(pushPlan.response.status, 200);
      assert.equal(pushPlan.payload.confirmation, "PUSH");
      const pushExecute = await authorizedJson(origin, token, "/api/workbench/git/execute", {
        method: "POST",
        body: { planId: pushPlan.payload.planId, confirmation: "PUSH" },
      });
      assert.equal(pushExecute.response.status, 200, JSON.stringify(pushExecute.payload));
      assert.equal(pushExecute.payload.action, "push");
      assert.equal(pushExecute.payload.summary.includes(remoteRoot), false);
      assert.equal(git(remoteRoot, ["rev-parse", "refs/heads/main"]), git(repoRoot, ["rev-parse", "HEAD"]));
      assert.throws(() => git(redirectedRemoteRoot, ["show-ref", "--verify", "refs/heads/main"]));
      assert.throws(() => git(remoteRoot, ["show-ref", "--verify", "refs/tags/qa-follow-tag"]));
      await assert.rejects(() => import("node:fs/promises").then(({ access }) => access(hookMarker)));

      await stopTestServer(child, { token, timeoutMs: 8_000 });
      child = null;
      child = spawnTestServer({ env });
      origin = new URL(await waitForUrl(child, { timeoutMs: 30_000 })).origin;
      const restored = await authorizedJson(origin, token, `/api/workbench/environment?runId=${runId}`);
      assert.equal(restored.response.status, 200);
      assert.deepEqual(restored.payload.sources.items.map((item) => item.name), ["lo-reference.png", "follow-up.md"]);

      const automation = await authorizedJson(origin, token, "/api/automations", {
        method: "POST",
        body: { name: "附件自动化", prompt: "读取附件", sources: [sourcePath], schedule: "manual" },
      });
      assert.equal(automation.response.status, 201);
      assert.deepEqual(automation.payload.sources, [{ kind: "file", name: "lo-reference.png" }]);
      assert.equal(JSON.stringify(automation.payload).includes(sourcePath), false);
      const automationList = await authorizedJson(origin, token, "/api/automations");
      assert.equal(JSON.stringify(automationList.payload).includes(sourcePath), false);

      const cleared = await authorizedJson(origin, token, "/api/runs/clear-finished", { method: "POST", body: {} });
      assert.ok(cleared.payload.runIds.includes(runId));
      const controller = new AbortController();
      const stream = await fetch(`${origin}/api/events?after=0`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      const reader = stream.body.getReader();
      const decoder = new TextDecoder();
      let streamText = "";
      try {
        while (!streamText.includes("event-source-path")) {
          const { done, value } = await reader.read();
          if (done) break;
          streamText += decoder.decode(value, { stream: true });
        }
      } finally {
        controller.abort();
        await reader.cancel().catch(() => {});
      }
      assert.match(streamText, /event-source-path/);
      assert.equal(streamText.includes(sourcePath), false);
      assert.match(streamText, /\[本地路径\]/);
    } finally {
      if (child) await stopTestServer(child, { token, timeoutMs: 8_000 });
    }
  });
});
