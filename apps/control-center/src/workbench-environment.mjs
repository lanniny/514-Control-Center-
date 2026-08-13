import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, isAbsolute, resolve, win32 } from "node:path";
import { scrub } from "./redaction.mjs";
import { runProcess } from "./process-runner.mjs";

export const WORKBENCH_ENVIRONMENT_SCHEMA = "514cc.workbench.environment/v1";
export const GIT_ACTION_PLAN_TTL_MS = 5 * 60_000;

const ACTIVE_ATTEMPT_PHASES = new Set(["prepared", "session_ready", "submitting", "submitted"]);
const TERMINAL_RUN_STATES = new Set(["succeeded", "failed", "cancelled"]);

function validationError(message, code = "VALIDATION_FAILED") {
  return Object.assign(new Error(message), { code });
}

function short(value, limit = 240) {
  return scrub(String(value ?? "")).replace(/[\r\n\t]+/g, " ").trim().slice(0, limit);
}

function totalNumstat(raw) {
  let additions = 0;
  let deletions = 0;
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    if (!line) continue;
    const [added, removed] = line.split("\t", 3);
    if (/^\d+$/.test(added)) additions += Number(added);
    if (/^\d+$/.test(removed)) deletions += Number(removed);
  }
  return { additions, deletions };
}

function rawDiffRecordCount(raw) {
  const fields = String(raw ?? "").split("\0");
  let index = 0;
  let count = 0;
  while (index < fields.length && fields[index]) {
    const header = fields[index++];
    const match = /^:[0-7]{6} [0-7]{6} [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/i.exec(header);
    if (!match) return null;
    const pathCount = /[RC]/i.test(match[1]) ? 2 : 1;
    for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
      if (index >= fields.length || !fields[index]) return null;
      index += 1;
    }
    count += 1;
  }
  return fields.slice(index).every((field) => field === "") ? count : null;
}

export function parseGitStatus(raw) {
  const summary = {
    branch: null,
    detached: false,
    head: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
    total: 0,
  };
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    if (line.startsWith("# branch.oid ")) summary.head = line.slice(13).trim() || null;
    else if (line.startsWith("# branch.head ")) {
      const head = line.slice(14).trim();
      summary.detached = head === "(detached)";
      summary.branch = summary.detached ? null : head || null;
    } else if (line.startsWith("# branch.upstream ")) summary.upstream = line.slice(18).trim() || null;
    else if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        summary.ahead = Number(match[1]);
        summary.behind = Number(match[2]);
      }
    } else if (/^[12u] /.test(line)) {
      const xy = line.split(" ", 3)[1] || "..";
      summary.total += 1;
      if (line.startsWith("u ")) summary.conflicts += 1;
      if (xy[0] && xy[0] !== ".") summary.staged += 1;
      if (xy[1] && xy[1] !== ".") summary.unstaged += 1;
    } else if (line.startsWith("? ")) {
      summary.total += 1;
      summary.untracked += 1;
    }
  }
  return summary;
}

export function gitActionAvailability(git) {
  if (!git?.available) {
    return {
      commit: { enabled: false, reason: "当前任务目录不是可用 Git 仓库" },
      push: { enabled: false, reason: "当前任务目录不是可用 Git 仓库" },
    };
  }
  if (git.detached) {
    const reason = "隔离工作树使用 detached HEAD；请通过任务产物收口，协作台不会直接提交或推送";
    return {
      commit: { enabled: false, reason },
      push: { enabled: false, reason },
    };
  }
  return {
    commit: {
      enabled: Number(git.changes?.staged) > 0,
      reason: Number(git.changes?.staged) > 0 ? "仅提交已暂存内容" : "没有已暂存内容",
    },
    push: {
      enabled: Boolean(git.upstream) && Number(git.ahead) > 0,
      reason: !git.upstream
        ? "没有既有 upstream"
        : Number(git.ahead) > 0 ? "只推送签名提交到既有 upstream" : "当前分支没有待推送提交",
    },
  };
}

function gitArgs(cwd, args) {
  return ["-C", cwd, ...args];
}

async function runGit(cwd, args, options = {}, runner = runProcess) {
  return runner("git", gitArgs(cwd, args), {
    timeoutMs: 12_000,
    maxOutputBytes: 4 * 1024 * 1024,
    ...options,
  });
}

function remoteProvider(remote) {
  const value = String(remote ?? "").toLowerCase();
  if (/(?:^|[\/@:])github\.com(?:[\/:]|$)/.test(value)) return "github";
  if (/(?:^|[\/@:])gitlab\.com(?:[\/:]|$)/.test(value)) return "gitlab";
  return value ? "other" : null;
}

export async function collectGitSummary(cwd, { signal, runner = runProcess } = {}) {
  const options = { signal };
  let results;
  try {
    results = await Promise.all([
      runGit(cwd, ["rev-parse", "--show-toplevel"], options, runner),
      runGit(cwd, ["status", "--porcelain=v2", "--branch", "--untracked-files=all"], options, runner),
      runGit(cwd, ["diff", "--numstat", "--no-ext-diff"], options, runner),
      runGit(cwd, ["diff", "--cached", "--numstat", "--no-ext-diff"], options, runner),
      runGit(cwd, ["remote", "get-url", "origin"], options, runner),
    ]);
  } catch (error) {
    return {
      available: false,
      root: null,
      name: basename(cwd),
      reason: error?.code === "ENOENT" ? "git-unavailable" : "git-probe-failed",
    };
  }
  const [rootResult, statusResult, worktreeDiff, stagedDiff, remoteResult] = results;
  if (rootResult.code !== 0 || statusResult.code !== 0) {
    return { available: false, root: null, name: basename(cwd), reason: "not-a-repository" };
  }
  const status = parseGitStatus(statusResult.stdout);
  const unstaged = totalNumstat(worktreeDiff.code === 0 ? worktreeDiff.stdout : "");
  const staged = totalNumstat(stagedDiff.code === 0 ? stagedDiff.stdout : "");
  const root = rootResult.stdout.trim();
  return {
    available: true,
    root,
    name: basename(root),
    branch: status.branch,
    detached: status.detached,
    head: status.head && status.head !== "(initial)" ? status.head.slice(0, 12) : null,
    upstream: status.upstream,
    ahead: status.ahead,
    behind: status.behind,
    changes: {
      total: status.total,
      staged: status.staged,
      unstaged: status.unstaged,
      untracked: status.untracked,
      conflicts: status.conflicts,
      additions: staged.additions + unstaged.additions,
      deletions: staged.deletions + unstaged.deletions,
    },
    remoteProvider: remoteResult.code === 0 ? remoteProvider(remoteResult.stdout.trim()) : null,
  };
}

export async function collectPullRequest(git, { signal } = {}) {
  if (!git?.available || git.remoteProvider !== "github" || git.detached) {
    return { available: false, provider: git?.remoteProvider ?? null, status: "unsupported" };
  }
  try {
    const result = await runProcess("gh", [
      "pr", "view",
      "--json", "number,title,state,url,isDraft,headRefName,baseRefName,reviewDecision,statusCheckRollup",
    ], {
      cwd: git.root,
      signal,
      timeoutMs: 5_000,
      maxOutputBytes: 256 * 1024,
      provider: null,
    });
    if (result.code !== 0) {
      const detail = short(result.stderr || result.stdout, 160);
      const none = /no pull requests found|could not resolve to a pull request/i.test(detail);
      return { available: true, provider: "github", status: none ? "none" : "unavailable", detail };
    }
    const value = JSON.parse(result.stdout);
    const checks = Array.isArray(value.statusCheckRollup) ? value.statusCheckRollup : [];
    return {
      available: true,
      provider: "github",
      status: "found",
      number: Number(value.number) || null,
      title: short(value.title, 180),
      state: short(value.state, 32).toLowerCase(),
      url: /^https:\/\/github\.com\//i.test(String(value.url ?? "")) ? String(value.url) : null,
      draft: value.isDraft === true,
      head: short(value.headRefName, 120),
      base: short(value.baseRefName, 120),
      reviewDecision: short(value.reviewDecision, 80).toLowerCase() || null,
      checks: {
        total: checks.length,
        passing: checks.filter((item) => /success|neutral|skipped/i.test(String(item?.conclusion ?? item?.state ?? ""))).length,
        failing: checks.filter((item) => /failure|error|cancelled|timed_out|action_required/i.test(String(item?.conclusion ?? item?.state ?? ""))).length,
        pending: checks.filter((item) => /pending|queued|in_progress|expected/i.test(String(item?.status ?? item?.state ?? ""))).length,
      },
    };
  } catch (error) {
    return {
      available: false,
      provider: "github",
      status: error?.code === "ENOENT" ? "cli-unavailable" : "unavailable",
      detail: short(error?.message, 160),
    };
  }
}

export function projectAgentActivity(run, runs = []) {
  const sourceRuns = run ? [run] : runs.filter((item) => !TERMINAL_RUN_STATES.has(item?.status));
  const latest = new Map();
  for (const source of sourceRuns) {
    for (const attempt of source?.turnAttempts ?? []) {
      const key = `${source.id}:${attempt.agentId}`;
      const previous = latest.get(key);
      if (!previous || String(attempt.updatedAt ?? attempt.createdAt ?? "") >= String(previous.updatedAt ?? previous.createdAt ?? "")) {
        latest.set(key, { ...attempt, runId: source.id, runStatus: source.status });
      }
    }
    for (const agentId of Object.keys(source?.inflightTurns ?? {})) {
      const key = `${source.id}:${agentId}`;
      if (!latest.has(key)) latest.set(key, { agentId, runId: source.id, runStatus: source.status, phase: "submitted" });
    }
  }
  const items = [...latest.values()].slice(-32).map((item) => ({
    agentId: String(item.agentId || "agent"),
    runId: String(item.runId || ""),
    phase: String(item.phase || item.runStatus || "unknown"),
    status: item.phase === "completed"
      ? "completed"
      : item.phase === "ambiguous"
        ? "attention"
        : ACTIVE_ATTEMPT_PHASES.has(item.phase) ? "running" : "idle",
    updatedAt: item.updatedAt ?? item.createdAt ?? null,
    delegated: Boolean(item.sourceWorkItemId || item.sourceBusMessageId),
  }));
  return {
    running: items.filter((item) => item.status === "running").length,
    completed: items.filter((item) => item.status === "completed").length,
    attention: items.filter((item) => item.status === "attention").length,
    delegated: items.filter((item) => item.delegated).length,
    delegatedRunning: items.filter((item) => item.delegated && item.status === "running").length,
    items,
  };
}

export async function collectWorkbenchEnvironment({
  cwd,
  run = null,
  runs = [],
  processes = [],
  signal,
  workspaceSource = run ? "run" : "control-center",
} = {}) {
  const git = await collectGitSummary(cwd, { signal });
  const pullRequest = await collectPullRequest(git, { signal });
  const projectedGit = { ...git, actions: gitActionAvailability(git) };
  return {
    schema: WORKBENCH_ENVIRONMENT_SCHEMA,
    capturedAt: new Date().toISOString(),
    runId: run?.id ?? null,
    workspace: {
      name: git.name || basename(cwd),
      source: workspaceSource,
      isRepository: git.available === true,
    },
    git: projectedGit,
    pullRequest,
    agents: projectAgentActivity(run, runs),
    processes: {
      running: processes.length,
      items: processes.slice(0, 32).map((item) => ({
        pid: Number(item.pid) || null,
        image: short(item.image, 120) || "process",
        startedAt: item.startedAt || null,
      })),
    },
    sources: {
      total: Array.isArray(run?.sources) ? run.sources.length : 0,
      items: (Array.isArray(run?.sources) ? run.sources : []).slice(0, 16).map((item) => ({
        kind: String(item?.kind || "file"),
        name: short(item?.name, 180) || basename(String(item?.path || "source")),
      })),
    },
  };
}

async function resolvePushTarget(cwd, runner, branchName) {
  const upstream = await runner("git", gitArgs(cwd, [
    "for-each-ref",
    "--format=%(upstream:remotename)%00%(upstream:remoteref)",
    "--count=1",
    "--",
    `refs/heads/${branchName}`,
  ]), {
    timeoutMs: 12_000,
    maxOutputBytes: 256 * 1024,
  });
  const [remote = "", remoteRef = "", ...extra] = upstream.code === 0
    ? upstream.stdout.trimEnd().split("\0")
    : [];
  if (!remote || !remoteRef.startsWith("refs/heads/") || extra.length || /[\0\r\n]/.test(`${remote}${remoteRef}`)) {
    throw validationError("当前分支没有可解析的上游；协作台不会隐式选择 push remote", "NO_UPSTREAM");
  }
  if (remote.startsWith("-") || remote.length > 240) {
    throw validationError("当前分支的 upstream remote 名称不安全", "NO_UPSTREAM");
  }
  const urlsResult = await runner("git", gitArgs(cwd, ["remote", "get-url", "--push", "--all", remote]), {
    timeoutMs: 12_000,
    maxOutputBytes: 256 * 1024,
    provider: null,
  });
  const pushUrls = urlsResult.code === 0 ? urlsResult.stdout.trimEnd().split(/\r?\n/) : [];
  if (pushUrls.length !== 1) {
    throw validationError("当前 upstream 必须只有一个 push URL；协作台不会一次写入多个远端", "MULTIPLE_PUSH_TARGETS");
  }
  if (!safePushUrl(pushUrls[0])) {
    throw validationError("当前 upstream 的 push URL 不可解析", "GIT_STATE_UNAVAILABLE");
  }
  const rawPushUrl = await runner("git", gitArgs(cwd, ["config", "--get-all", `remote.${remote}.pushurl`]), {
    timeoutMs: 12_000,
    maxOutputBytes: 256 * 1024,
    provider: null,
  });
  const rawRemoteUrl = rawPushUrl.code === 0 && rawPushUrl.stdout.trim()
    ? rawPushUrl
    : await runner("git", gitArgs(cwd, ["config", "--get-all", `remote.${remote}.url`]), {
      timeoutMs: 12_000,
      maxOutputBytes: 256 * 1024,
      provider: null,
    });
  const configuredUrls = rawRemoteUrl.code === 0 ? rawRemoteUrl.stdout.trimEnd().split(/\r?\n/) : [];
  if (configuredUrls.length !== 1 || configuredUrls[0] !== pushUrls[0]) {
    throw validationError(
      "upstream push URL 被 url.* 重写或不是单一显式地址；请先把远端改为直接 URL",
      "PUSH_URL_REWRITE",
    );
  }
  return { remote, remoteRef, pushUrls };
}

function safePushUrl(value) {
  const url = String(value ?? "");
  if (!url || url.length > 4_096 || /[\0\r\n]/.test(url)) return false;
  if (/^(?:https?|ssh|git|file):\/\//i.test(url)) return true;
  if (isAbsolute(url) || win32.isAbsolute(url)) return true;
  return /^[A-Za-z0-9._~-]+@(?:\[[^\]]+\]|[A-Za-z0-9.-]+):[^\0\r\n]+$/.test(url);
}

async function actionIdentity(cwd, action, runner) {
  const branch = await runner("git", gitArgs(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]), {
    timeoutMs: 12_000,
    maxOutputBytes: 256 * 1024,
    provider: null,
  });
  const branchName = branch.code === 0 ? branch.stdout.trim() : "";
  if (!branchName || /[\0\r\n]/.test(branchName)) {
    throw validationError("当前 HEAD 未附着到可操作分支", "DETACHED_HEAD");
  }
  const head = await runner("git", gitArgs(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]), {
    timeoutMs: 12_000,
    maxOutputBytes: 256 * 1024,
    provider: null,
  });
  const headOid = head.code === 0 ? head.stdout.trim() : "";
  if (!/^[0-9a-f]{40,64}$/i.test(headOid)) throw validationError("Git HEAD 不可读取", "GIT_STATE_UNAVAILABLE");
  if (action === "commit") {
    const stagedBefore = await runner("git", gitArgs(cwd, ["diff", "--cached", "--raw", "-z", "--no-ext-diff"]), {
      timeoutMs: 12_000,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    const stagedNumstat = await runner("git", gitArgs(cwd, ["diff", "--cached", "--numstat", "--no-ext-diff"]), {
      timeoutMs: 12_000,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    const stagedAfter = await runner("git", gitArgs(cwd, ["diff", "--cached", "--raw", "-z", "--no-ext-diff"]), {
      timeoutMs: 12_000,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    if (stagedBefore.code !== 0 || stagedNumstat.code !== 0 || stagedAfter.code !== 0) {
      throw validationError("暂存区不可读取", "GIT_STATE_UNAVAILABLE");
    }
    if (stagedBefore.stdout !== stagedAfter.stdout) {
      throw validationError("暂存区在预览期间发生变化，请重试", "GIT_STATE_UNAVAILABLE");
    }
    if (!stagedAfter.stdout) throw validationError("没有已暂存的变更；协作台不会擅自执行 git add", "NOTHING_STAGED");
    const numstat = totalNumstat(stagedNumstat.stdout);
    const stagedCount = rawDiffRecordCount(stagedAfter.stdout);
    if (!stagedCount) throw validationError("暂存区差异格式不可解析", "GIT_STATE_UNAVAILABLE");
    return {
      signature: createHash("sha256")
        .update(`commit\0${branchName}\0${headOid}\0${stagedAfter.stdout}\0${stagedNumstat.stdout}`)
        .digest("hex"),
      headOid,
      branchName,
      previewChanges: { total: stagedCount, staged: stagedCount, additions: numstat.additions, deletions: numstat.deletions },
      pushTarget: null,
    };
  }
  const pushTarget = await resolvePushTarget(cwd, runner, branchName);
  return {
    signature: createHash("sha256")
      .update(`push\0${branchName}\0${headOid}\0${pushTarget.remote}\0${pushTarget.remoteRef}\0${JSON.stringify(pushTarget.pushUrls)}`)
      .digest("hex"),
    headOid,
    branchName,
    previewChanges: null,
    pushTarget,
  };
}

async function actionState(cwd, action, runner) {
  // Bracket the public preview with two identical action identities. The counts returned to the
  // confirmation dialog therefore describe the same HEAD/index/upstream state that is signed.
  const before = await actionIdentity(cwd, action, runner);
  const git = await collectGitSummary(cwd, { runner });
  const after = await actionIdentity(cwd, action, runner);
  if (before.signature !== after.signature) {
    throw validationError("Git 状态在预览期间发生变化，请重试", "GIT_STATE_UNAVAILABLE");
  }
  if (!git.available) throw validationError("当前任务目录不是可用 Git 仓库", "GIT_STATE_UNAVAILABLE");
  if (git.detached || git.branch !== after.branchName) {
    throw validationError(
      "当前任务使用 detached HEAD 隔离工作树；请通过任务产物收口，协作台不会直接提交或推送",
      "DETACHED_HEAD",
    );
  }
  if (git.head && git.head.toLowerCase() !== after.headOid.slice(0, 12).toLowerCase()) {
    throw validationError("Git HEAD 在预览期间发生变化，请重试", "GIT_STATE_UNAVAILABLE");
  }
  if (action === "push" && git.ahead < 1) {
    throw validationError("当前分支没有待推送提交", "NOTHING_TO_PUSH");
  }
  return { ...after, git };
}

function disabledHooksPath() {
  return resolve(tmpdir(), `514cc-hooks-disabled-${process.pid}-${randomUUID()}`);
}

function sameFilesystemPath(left, right) {
  const a = resolve(String(left || ""));
  const b = resolve(String(right || ""));
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function constrainedGitEnv(entries = []) {
  const values = [
    ["core.hooksPath", disabledHooksPath()],
    ["core.fsmonitor", "false"],
    ["commit.gpgSign", "false"],
    ...entries,
  ];
  const env = {
    GIT_CONFIG_COUNT: String(values.length),
    GIT_TERMINAL_PROMPT: "0",
  };
  values.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

function signedPushTransport(pushTarget) {
  const remote = `cc-exec-${randomUUID().replace(/[^a-z0-9-]/gi, "")}`;
  const entries = [
    [`remote.${remote}.url`, pushTarget.pushUrls[0]],
    ...pushTarget.pushUrls.map((url) => [`remote.${remote}.pushurl`, url]),
    [`remote.${remote}.mirror`, "false"],
    ["push.followTags", "false"],
    ["push.recurseSubmodules", "no"],
    // An exact identity rewrite is the longest possible insteadOf match and prevents repository
    // config from redirecting the already-confirmed URL to a different transport destination.
    [`url.${pushTarget.pushUrls[0]}.insteadOf`, pushTarget.pushUrls[0]],
  ];
  return { remote, env: constrainedGitEnv(entries) };
}

export class GitActionBroker {
  constructor({ runner = runProcess, now = () => Date.now(), ttlMs = GIT_ACTION_PLAN_TTL_MS } = {}) {
    this.runner = runner;
    this.now = now;
    this.ttlMs = ttlMs;
    this.plans = new Map();
  }

  #prune() {
    const now = this.now();
    for (const [id, plan] of this.plans) if (plan.expiresAtMs <= now) this.plans.delete(id);
  }

  async plan({ cwd, action, message = "", revalidateWorkspace = null } = {}) {
    this.#prune();
    if (!cwd) throw validationError("Git 工作目录缺失");
    if (!new Set(["commit", "push"]).has(action)) throw validationError("Git 动作只允许 commit 或 push");
    const normalizedMessage = String(message ?? "").trim();
    if (action === "commit" && (!normalizedMessage || normalizedMessage.length > 2_000 || normalizedMessage.includes("\0"))) {
      throw validationError("提交说明必须为 1-2000 个字符");
    }
    const actionStateValue = await actionState(cwd, action, this.runner);
    const git = actionStateValue.git;
    const id = randomUUID();
    const createdAtMs = this.now();
    const plan = {
      id,
      action,
      cwd: git.root,
      message: normalizedMessage,
      signature: actionStateValue.signature,
      revalidateWorkspace: typeof revalidateWorkspace === "function" ? revalidateWorkspace : null,
      createdAtMs,
      expiresAtMs: createdAtMs + this.ttlMs,
    };
    this.plans.set(id, plan);
    return {
      schema: "514cc.git-action.plan/v1",
      planId: id,
      action,
      repository: git.name,
      branch: git.branch,
      upstream: git.upstream,
      changes: action === "commit"
        ? {
          ...git.changes,
          total: actionStateValue.previewChanges.total,
          staged: actionStateValue.previewChanges.staged,
          unstaged: 0,
          untracked: 0,
          additions: actionStateValue.previewChanges.additions,
          deletions: actionStateValue.previewChanges.deletions,
        }
        : git.changes,
      confirmation: action.toUpperCase(),
      expiresAt: new Date(plan.expiresAtMs).toISOString(),
    };
  }

  async execute({ planId, confirmation } = {}) {
    this.#prune();
    const plan = this.plans.get(String(planId ?? ""));
    if (!plan) throw validationError("Git 动作计划不存在或已过期", "PLAN_EXPIRED");
    if (confirmation !== plan.action.toUpperCase()) throw validationError(`请输入 ${plan.action.toUpperCase()} 确认`, "CONFIRMATION_REQUIRED");
    // A valid confirmation atomically consumes the plan before the first await.
    // Stale/failed executions require a fresh preview and concurrent replay cannot double-run hooks.
    this.plans.delete(plan.id);
    if (plan.revalidateWorkspace) {
      const workspace = await plan.revalidateWorkspace();
      if (!sameFilesystemPath(workspace?.path ?? workspace, plan.cwd)) {
        throw validationError("任务工作树身份在确认后发生变化，请重新预览", "WORKTREE_INVALID");
      }
    }
    const currentState = await actionState(plan.cwd, plan.action, this.runner);
    if (currentState.signature !== plan.signature) {
      throw validationError("Git 状态已变化，请重新预览", "PLAN_STALE");
    }
    const pushTransport = plan.action === "push" ? signedPushTransport(currentState.pushTarget) : null;
    const executionEnv = pushTransport?.env ?? constrainedGitEnv();
    const args = plan.action === "commit"
      ? gitArgs(plan.cwd, ["commit", "-m", plan.message])
      : gitArgs(plan.cwd, [
        "push",
        "--no-follow-tags",
        "--recurse-submodules=no",
        "--",
        pushTransport.remote,
        `${currentState.headOid}:${currentState.pushTarget.remoteRef}`,
      ]);
    const result = await this.runner("git", args, {
      timeoutMs: plan.action === "push" ? 60_000 : 30_000,
      maxOutputBytes: 2 * 1024 * 1024,
      env: executionEnv,
      provider: null,
      allowGitConfigEnv: true,
    });
    if (result.code !== 0) {
      const message = plan.action === "push"
        ? "git push 失败；请检查既有 upstream 凭据与远端状态"
        : short(result.stderr || result.stdout, 500) || "git commit 失败";
      throw validationError(message, "GIT_ACTION_FAILED");
    }
    return {
      ok: true,
      action: plan.action,
      summary: plan.action === "push"
        ? `已推送签名提交到 ${currentState.pushTarget.remoteRef}`
        : short(result.stdout || result.stderr, 500) || "git commit 完成",
    };
  }
}
