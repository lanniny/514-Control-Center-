import test from "node:test";
import assert from "node:assert/strict";
import {
  GitActionBroker,
  parseGitStatus,
  projectAgentActivity,
} from "../src/workbench-environment.mjs";
import { normalizeRunSources, promptWithRunSources } from "../src/orchestrator.mjs";

test("parseGitStatus projects branch divergence and layered change counts", () => {
  const value = parseGitStatus([
    "# branch.oid 0123456789abcdef",
    "# branch.head feature/environment",
    "# branch.upstream origin/feature/environment",
    "# branch.ab +3 -2",
    "1 M. N... 100644 100644 100644 a b staged.js",
    "1 .M N... 100644 100644 100644 a b unstaged.js",
    "1 MM N... 100644 100644 100644 a b both.js",
    "u UU N... 100644 100644 100644 100644 a b c conflict.js",
    "? new file.txt",
  ].join("\n"));

  assert.equal(value.branch, "feature/environment");
  assert.equal(value.upstream, "origin/feature/environment");
  assert.equal(value.ahead, 3);
  assert.equal(value.behind, 2);
  assert.equal(value.total, 5);
  assert.equal(value.staged, 3);
  assert.equal(value.unstaged, 3);
  assert.equal(value.untracked, 1);
  assert.equal(value.conflicts, 1);
});

test("projectAgentActivity keeps run ownership and latest attempt state", () => {
  const run = {
    id: "run-1",
    status: "waiting_agent",
    inflightTurns: { codex: "attempt-2" },
    turnAttempts: [
      { attemptId: "attempt-1", agentId: "codex", phase: "completed", updatedAt: "2026-08-07T00:00:00Z" },
      { attemptId: "attempt-2", agentId: "codex", phase: "submitted", updatedAt: "2026-08-07T00:01:00Z" },
      { attemptId: "attempt-3", agentId: "kimi", phase: "completed", updatedAt: "2026-08-07T00:02:00Z" },
    ],
  };
  const result = projectAgentActivity(run, []);
  assert.equal(result.running, 1);
  assert.equal(result.completed, 1);
  assert.deepEqual(result.items.map((item) => [item.agentId, item.status]), [
    ["codex", "running"],
    ["kimi", "completed"],
  ]);
});

test("normalizeRunSources accepts bounded absolute file sources and deduplicates them", () => {
  const first = process.platform === "win32" ? "C:\\workspace\\spec.md" : "/workspace/spec.md";
  const second = process.platform === "win32" ? "C:\\workspace\\image.png" : "/workspace/image.png";
  assert.deepEqual(normalizeRunSources([first, { path: first }, second]), [
    { kind: "file", path: first, name: "spec.md" },
    { kind: "file", path: second, name: "image.png" },
  ]);
  assert.throws(() => normalizeRunSources(["relative.md"]), { code: "VALIDATION_FAILED" });
  assert.throws(() => normalizeRunSources(Array.from({ length: 17 }, (_, index) => `${first}-${index}`)), { code: "VALIDATION_FAILED" });
});

test("source paths are injected only into the adapter-bound prompt", () => {
  const sourcePath = process.platform === "win32" ? "C:\\workspace\\private-spec.md" : "/workspace/private-spec.md";
  const prompt = promptWithRunSources("review this", [{ kind: "file", path: sourcePath, name: "private-spec.md" }]);
  assert.match(prompt, /review this/);
  assert.ok(prompt.includes(sourcePath));
  assert.match(prompt, /private-spec\.md/);
});

function gitRunner({
  stagedRaw = ":100644 100644 a b M\0file.js\0",
  ahead = 1,
  detached = false,
  pushUrls = ["git@github.com:514cc/demo.git"],
} = {}) {
  const calls = [];
  const records = [];
  let raw = stagedRaw;
  let currentPushUrls = pushUrls;
  let pushFailure = null;
  let currentDetached = detached;
  const headOid = "abcdef0123456789abcdef0123456789abcdef01";
  const runner = async (command, args, options = {}) => {
    calls.push([command, ...args]);
    records.push({ command, args, options });
    const gitArgs = args.slice(2);
    const key = gitArgs.join(" ");
    if (key === "rev-parse --show-toplevel") return { code: 0, stdout: "C:/repo\n", stderr: "" };
    if (key === "status --porcelain=v2 --branch --untracked-files=all") return {
      code: 0,
      stdout: [
        `# branch.oid ${headOid}`,
        `# branch.head ${currentDetached ? "(detached)" : "main"}`,
        currentDetached ? null : "# branch.upstream origin/main",
        currentDetached ? null : `# branch.ab +${ahead} -0`,
        "1 M. N... 100644 100644 100644 a b file.js",
      ].filter(Boolean).join("\n"),
      stderr: "",
    };
    if (key === "diff --numstat --no-ext-diff") return { code: 0, stdout: "", stderr: "" };
    if (key === "diff --cached --numstat --no-ext-diff") return { code: 0, stdout: "2\t1\tfile.js\n", stderr: "" };
    if (key === "remote get-url origin") return { code: 0, stdout: "git@github.com:514cc/demo.git\n", stderr: "" };
    if (key === "rev-parse --verify HEAD^{commit}") return { code: 0, stdout: `${headOid}\n`, stderr: "" };
    if (key === "diff --cached --raw -z --no-ext-diff") return { code: 0, stdout: raw, stderr: "" };
    if (key === "symbolic-ref --quiet --short HEAD") return currentDetached
      ? { code: 1, stdout: "", stderr: "" }
      : { code: 0, stdout: "main\n", stderr: "" };
    if (key === "for-each-ref --format=%(upstream:remotename)%00%(upstream:remoteref) --count=1 -- refs/heads/main") {
      return { code: 0, stdout: "origin\0refs/heads/main\n", stderr: "" };
    }
    if (key === "remote get-url --push --all origin") {
      return { code: 0, stdout: `${currentPushUrls.join("\n")}\n`, stderr: "" };
    }
    if (key === "config --get-all remote.origin.pushurl") return { code: 1, stdout: "", stderr: "" };
    if (key === "config --get-all remote.origin.url") {
      return { code: 0, stdout: `${currentPushUrls[0]}\n`, stderr: "" };
    }
    if (gitArgs[0] === "commit") return { code: 0, stdout: "[main 1234567] test\n", stderr: "" };
    if (gitArgs[0] === "push") return pushFailure
      ? { code: 1, stdout: "", stderr: pushFailure }
      : { code: 0, stdout: "", stderr: "pushed\n" };
    throw new Error(`unexpected git call: ${key}`);
  };
  return {
    runner,
    calls,
    records,
    headOid,
    changeStage(next) { raw = next; },
    changePushUrls(next) { currentPushUrls = next; },
    setDetached(value) { currentDetached = Boolean(value); },
    failPush(message) { pushFailure = message; },
  };
}

test("GitActionBroker executes only the signed staged commit after exact confirmation", async () => {
  const git = gitRunner();
  const broker = new GitActionBroker({ runner: git.runner, now: () => 1_000 });
  const plan = await broker.plan({ cwd: "C:/repo", action: "commit", message: "test commit" });
  assert.equal(plan.confirmation, "COMMIT");
  await assert.rejects(
    () => broker.execute({ planId: plan.planId, confirmation: "yes" }),
    { code: "CONFIRMATION_REQUIRED" },
  );
  const result = await broker.execute({ planId: plan.planId, confirmation: "COMMIT" });
  assert.equal(result.ok, true);
  const commit = git.calls.find((call) => call.includes("commit"));
  assert.deepEqual(commit.slice(-3), ["commit", "-m", "test commit"]);
  assert.equal(git.calls.some((call) => call.includes("add") || call.includes("--force")), false);
});

test("GitActionBroker rejects a stale index and never runs commit", async () => {
  const git = gitRunner();
  const broker = new GitActionBroker({ runner: git.runner });
  const plan = await broker.plan({ cwd: "C:/repo", action: "commit", message: "stale" });
  git.changeStage(":100644 100644 c d M\0file.js\0");
  await assert.rejects(
    () => broker.execute({ planId: plan.planId, confirmation: "COMMIT" }),
    { code: "PLAN_STALE" },
  );
  assert.equal(git.calls.some((call) => call.includes("commit")), false);
});

test("GitActionBroker push pins the signed upstream remote and refspec without force", async () => {
  const git = gitRunner({ ahead: 2 });
  const broker = new GitActionBroker({ runner: git.runner });
  const plan = await broker.plan({ cwd: "C:/repo", action: "push" });
  const result = await broker.execute({ planId: plan.planId, confirmation: "PUSH" });
  assert.equal(result.action, "push");
  const push = git.calls.find((call) => call.includes("push"));
  assert.deepEqual(push.slice(1, 7), ["-C", "C:/repo", "push", "--no-follow-tags", "--recurse-submodules=no", "--"]);
  assert.match(push.at(-2), /^cc-exec-[a-f0-9-]+$/i);
  assert.equal(push.at(-1), `${git.headOid}:refs/heads/main`);
  assert.equal(push.some((value) => value.includes("github.com")), false, "signed URL must not leak into argv");
  assert.equal(push.includes("--force"), false);
  const pushRecord = git.records.find((record) => record.args.includes("push"));
  assert.equal(pushRecord.options.provider, null);
  assert.equal(pushRecord.options.allowGitConfigEnv, true);
  assert.equal(pushRecord.options.env.GIT_TERMINAL_PROMPT, "0");
  assert.ok(Object.keys(pushRecord.options.env).some((key) => key.startsWith("GIT_CONFIG_KEY_")));
  assert.ok(Object.values(pushRecord.options.env).includes("core.hooksPath"));
  assert.ok(Object.values(pushRecord.options.env).includes(`url.git@github.com:514cc/demo.git.insteadOf`));
  assert.ok(Object.values(pushRecord.options.env).includes("false"));
  assert.ok(Object.values(pushRecord.options.env).includes("no"));
  assert.ok(Object.values(pushRecord.options.env).includes("git@github.com:514cc/demo.git"));
});

test("GitActionBroker rejects multiple push destinations instead of widening the confirmed write set", async () => {
  const git = gitRunner({ pushUrls: [
    "git@github.com:514cc/demo.git",
    "git@gitlab.com:514cc/demo.git",
  ] });
  const broker = new GitActionBroker({ runner: git.runner });
  await assert.rejects(
    () => broker.plan({ cwd: "C:/repo", action: "push" }),
    { code: "MULTIPLE_PUSH_TARGETS" },
  );
  assert.equal(git.calls.some((call) => call.includes("push")), false);
});

test("GitActionBroker rejects an index that changes while the confirmation preview is counted", async () => {
  const git = gitRunner();
  let rawReads = 0;
  const runner = async (...args) => {
    const commandArgs = args[1]?.slice(2) ?? [];
    if (commandArgs.join(" ") === "diff --cached --raw -z --no-ext-diff") {
      rawReads += 1;
      if (rawReads === 2) git.changeStage(":100644 100644 c d M\0file.js\0");
    }
    return git.runner(...args);
  };
  const broker = new GitActionBroker({ runner });
  await assert.rejects(
    () => broker.plan({ cwd: "C:/repo", action: "commit", message: "raced preview" }),
    { code: "GIT_STATE_UNAVAILABLE" },
  );
  assert.equal(git.calls.some((call) => call.includes("commit")), false);
});

test("GitActionBroker derives the confirmation staged count from the signed raw index", async () => {
  const git = gitRunner({
    stagedRaw: [
      ":100644 100644 a b M\0first.js\0",
      ":100644 100644 c d A\0second.js\0",
    ].join(""),
  });
  const broker = new GitActionBroker({ runner: git.runner });
  const plan = await broker.plan({ cwd: "C:/repo", action: "commit", message: "two files" });
  assert.equal(plan.changes.staged, 2);
  assert.equal(plan.changes.total, 2);
  assert.equal(plan.changes.unstaged, 0);
  assert.equal(plan.changes.untracked, 0);
});

test("GitActionBroker does not count a colon-prefixed path as a second raw index record", async () => {
  const git = gitRunner({ stagedRaw: ":100644 100644 a b M\0:colon-name.js\0" });
  const broker = new GitActionBroker({ runner: git.runner });
  const plan = await broker.plan({ cwd: "C:/repo", action: "commit", message: "colon path" });
  assert.equal(plan.changes.staged, 1);
  assert.equal(plan.changes.total, 1);
});

test("GitActionBroker revalidates an isolated workspace after confirmation and before Git execution", async () => {
  const git = gitRunner();
  const broker = new GitActionBroker({ runner: git.runner });
  const plan = await broker.plan({
    cwd: "C:/repo",
    action: "commit",
    message: "attested",
    revalidateWorkspace: async () => ({ path: "C:/replaced" }),
  });
  await assert.rejects(
    () => broker.execute({ planId: plan.planId, confirmation: "COMMIT" }),
    { code: "WORKTREE_INVALID" },
  );
  assert.equal(git.calls.some((call) => call.includes("commit")), false);
});

test("GitActionBroker rejects push URL drift before execution", async () => {
  const git = gitRunner({ ahead: 1 });
  const broker = new GitActionBroker({ runner: git.runner });
  const plan = await broker.plan({ cwd: "C:/repo", action: "push" });
  git.changePushUrls(["https://example.invalid/redirected.git"]);
  await assert.rejects(
    () => broker.execute({ planId: plan.planId, confirmation: "PUSH" }),
    { code: "PLAN_STALE" },
  );
  assert.equal(git.calls.some((call) => call.includes("push")), false);
});

test("GitActionBroker does not return a signed push URL in failure details", async () => {
  const git = gitRunner({ pushUrls: ["https://signed-secret@example.invalid/repo.git"] });
  const broker = new GitActionBroker({ runner: git.runner });
  const plan = await broker.plan({ cwd: "C:/repo", action: "push" });
  git.failPush("fatal: https://signed-secret@example.invalid/repo.git rejected the update");
  await assert.rejects(
    () => broker.execute({ planId: plan.planId, confirmation: "PUSH" }),
    (error) => error.code === "GIT_ACTION_FAILED"
      && !error.message.includes("signed-secret")
      && !error.message.includes("example.invalid"),
  );
});

test("GitActionBroker blocks commit and push from detached worktrees", async () => {
  for (const action of ["commit", "push"]) {
    const git = gitRunner({ detached: true });
    const broker = new GitActionBroker({ runner: git.runner });
    await assert.rejects(
      () => broker.plan({ cwd: "C:/repo", action, message: action === "commit" ? "detached" : "" }),
      { code: "DETACHED_HEAD" },
    );
    assert.equal(git.calls.some((call) => call.includes(action)), false);
  }
});

test("GitActionBroker rechecks attached HEAD after planning a commit", async () => {
  const git = gitRunner();
  const broker = new GitActionBroker({ runner: git.runner });
  const plan = await broker.plan({ cwd: "C:/repo", action: "commit", message: "stay attached" });
  git.setDetached(true);
  await assert.rejects(
    () => broker.execute({ planId: plan.planId, confirmation: "COMMIT" }),
    { code: "DETACHED_HEAD" },
  );
  assert.equal(git.calls.some((call) => call.includes("commit")), false);
});

test("GitActionBroker consumes one confirmed plan before concurrent revalidation", async () => {
  const git = gitRunner();
  const broker = new GitActionBroker({ runner: git.runner });
  const plan = await broker.plan({ cwd: "C:/repo", action: "push" });
  const first = broker.execute({ planId: plan.planId, confirmation: "PUSH" });
  await assert.rejects(
    () => broker.execute({ planId: plan.planId, confirmation: "PUSH" }),
    { code: "PLAN_EXPIRED" },
  );
  await first;
  assert.equal(git.calls.filter((call) => call.includes("push")).length, 1);
});
