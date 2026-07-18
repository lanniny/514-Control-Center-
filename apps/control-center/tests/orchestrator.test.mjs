import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Orchestrator } from "../src/orchestrator.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

function policy() {
  return {
    version: 1,
    modes: { plan: { approvalRequired: false }, build: { approvalRequired: true } },
    limits: { maxRounds: 6, maxBudgetUsdPerTurn: 2, turnTimeoutMs: 10_000 },
  };
}

function route() {
  return {
    taskType: "coding",
    risk: "high",
    selected: { id: "codex-technical", label: "Codex" },
    independent: { id: "claude-fable", label: "Fable" },
    independentRequired: true,
    reason: "test route",
  };
}

async function fixture({ approvalRequest } = {}) {
  const root = await mkdtemp(resolve(appRoot, ".test-orchestrator-"));
  const calls = [];
  const adapter = (id) => ({
    cwd: root,
    async send(input) {
      calls.push({ id, ...input });
      await input.onSessionStarted?.({ sessionId: `${id}-session`, protocol: `${id}-mock` });
      await input.onTurnSubmitting?.({ sessionId: `${id}-session`, protocol: `${id}-mock`, clientUserMessageId: `${id}-message-${calls.length}` });
      await input.onTurnAccepted?.({ sessionId: `${id}-session`, protocol: `${id}-mock`, clientUserMessageId: `${id}-message-${calls.length}`, turnId: `${id}-turn-${calls.length}` });
      return { sessionId: `${id}-session`, text: `${id}-round-${calls.length}`, protocol: `${id}-mock`, tokens: 1000 + calls.length, costUsd: 0.01 * calls.length };
    },
    async close() {},
  });
  const adapters = new Map([
    ["claude-fable", adapter("claude-fable")],
    ["codex-technical", adapter("codex-technical")],
    ["codex-technical-fallback", adapter("codex-fallback")],
  ]);
  const approvalBroker = {
    request: approvalRequest || (async () => ({ decision: "accept" })),
    denyRun() {},
  };
  const events = [];
  const orchestrator = await new Orchestrator({
    router: { preview: async () => route() },
    adapters,
    eventStore: { emit: async (type, data) => { events.push({ type, data }); } },
    dataRoot: root,
    policy: policy(),
    approvalBroker,
  }).init();
  return { root, calls, orchestrator, approvalBroker, events };
}

async function waitTerminal(orchestrator, id) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const run = orchestrator.get(id);
    if (["succeeded", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 10));
  }
  throw new Error("run did not finish");
}

test("high-risk execution performs planner, specialist and independent verifier rounds", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, maxRounds: 3, permissionMode: "plan" });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.status, "succeeded");
  assert.deepEqual(fx.calls.map((call) => call.id), ["claude-fable", "codex-technical", "claude-fable"]);
  assert.equal(completed.result.final, completed.result.critique);
  assert.equal(completed.turnAttempts.length, 3);
  assert.ok(completed.turnAttempts.every((attempt) => attempt.phase === "completed" && attempt.sessionId));
});

test("round budget cannot bypass mandatory independent verification", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  await assert.rejects(
    () => fx.orchestrator.create({ prompt: "implement", execute: true, maxRounds: 1, permissionMode: "plan" }),
    { code: "INSUFFICIENT_ROUNDS" },
  );
});

test("build execution waits for approval and binds workspace-write to the selected executor", async (t) => {
  let decide;
  const decision = new Promise((resolveDecision) => { decide = resolveDecision; });
  const fx = await fixture({ approvalRequest: async () => decision });
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, maxRounds: 3, permissionMode: "build" });
  assert.equal(created.status, "waiting_approval");
  await assert.rejects(() => fx.orchestrator.continue(created.id, { prompt: "bypass", agentId: "codex-technical" }), { code: "APPROVAL_REQUIRED" });
  assert.equal(fx.calls.length, 0);
  decide({ decision: "accept" });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.buildApproval.status, "approved");
  assert.equal(fx.calls.find((call) => call.id === "codex-technical").permissionMode, "workspace-write");
  assert.ok(fx.calls.filter((call) => call.id === "claude-fable").every((call) => call.permissionMode === "plan"));
  assert.equal(fx.orchestrator.buildApprovalIsValid(completed), true);
  completed.route.selected.id = "claude-fable";
  assert.equal(fx.orchestrator.buildApprovalIsValid(completed), false);
});

test("dry-run build metadata cannot grant workspace-write through continue", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "build" });
  await fx.orchestrator.continue(created.id, { prompt: "inspect", agentId: "codex-technical" });
  assert.equal(fx.calls.length, 1);
  assert.equal(fx.calls[0].permissionMode, "read-only");
});

test("an approved build grant is not reused by a later manual continuation", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, maxRounds: 3, permissionMode: "build" });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.status, "succeeded");
  // 等收尾窗口关闭（terminal 置位后 controller 释放前 continue 会按设计排队而非直接执行）
  while (fx.orchestrator.controllers.has(created.id)) {
    await new Promise((resolveTick) => setTimeout(resolveTick, 5));
  }
  const continued = await fx.orchestrator.continue(created.id, { prompt: "inspect the result", agentId: "codex-technical" });
  assert.equal(continued.status, "succeeded");
  assert.equal(fx.calls.at(-1).permissionMode, "read-only");
});

test("an ambiguous Codex transport failure never replays the prompt through fallback", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  let fallbackCalls = 0;
  fx.orchestrator.adapters.get("codex-technical").send = async () => {
    throw Object.assign(new Error("transport closed after submit"), {
      code: "APP_SERVER_EXIT",
      safeToFallback: false,
      codexPhase: "turn-submitted-or-unknown",
      clientUserMessageId: "client-message-1",
    });
  };
  fx.orchestrator.adapters.get("codex-technical-fallback").send = async () => {
    fallbackCalls += 1;
    return { sessionId: "fallback", text: "duplicate", protocol: "fallback" };
  };
  const created = await fx.orchestrator.create({ prompt: "implement once", execute: true, maxRounds: 3, permissionMode: "plan" });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.status, "failed");
  assert.equal(fallbackCalls, 0);
  assert.match(completed.error, /transport closed/);
});

test("a pre-submit Codex setup failure may use the explicit read-only fallback", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  let fallbackCalls = 0;
  fx.orchestrator.adapters.get("codex-technical").send = async () => {
    throw Object.assign(new Error("app-server missing"), { code: "ENOENT", safeToFallback: true, codexPhase: "session-setup" });
  };
  fx.orchestrator.adapters.get("codex-technical-fallback").send = async () => {
    fallbackCalls += 1;
    return { sessionId: "fallback", text: "verified", protocol: "fallback" };
  };
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, maxRounds: 3, permissionMode: "plan" });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.status, "succeeded");
  assert.equal(fallbackCalls, 1);
});

test("a failed durable checkpoint prevents the adapter from submitting the prompt", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "route only", execute: false, permissionMode: "plan" });
  let submitted = false;
  fx.orchestrator.adapters.get("codex-technical").send = async (input) => {
    await input.onSessionStarted({ sessionId: "checkpoint-session", protocol: "mock" });
    await input.onTurnSubmitting({ sessionId: "checkpoint-session", protocol: "mock", clientUserMessageId: "checkpoint-message" });
    submitted = true;
    return { sessionId: "checkpoint-session", text: "should not happen", protocol: "mock" };
  };
  const save = fx.orchestrator.save.bind(fx.orchestrator);
  fx.orchestrator.save = async (run) => {
    if ((run.turnAttempts || []).some((attempt) => attempt.phase === "submitting")) throw new Error("checkpoint volume unavailable");
    return save(run);
  };
  await assert.rejects(
    () => fx.orchestrator.continue(created.id, { prompt: "inspect", agentId: "codex-technical" }),
    /checkpoint volume unavailable/,
  );
  assert.equal(submitted, false);
});

test("restart marks a submitted native turn as recovery-required and blocks blind continuation", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "route only", execute: false, permissionMode: "plan" });
  const run = fx.orchestrator.get(created.id);
  run.status = "waiting_agent";
  run.turnAttempts = [{ attemptId: "a1", round: 1, agentId: "codex-technical", phase: "submitted", sessionId: "thread-1" }];
  await fx.orchestrator.save(run);
  await fx.orchestrator.close();
  const restarted = await new Orchestrator({
    router: { preview: async () => route() },
    adapters: new Map(),
    eventStore: { emit: async () => {} },
    dataRoot: fx.root,
    policy: policy(),
    approvalBroker: { denyRun: async () => {} },
  }).init();
  assert.equal(restarted.get(created.id).status, "recovery_required");
  await assert.rejects(
    () => restarted.continue(created.id, { prompt: "replay", agentId: "codex-technical" }),
    { code: "RECOVERY_REQUIRED" },
  );
});

test("clearFinished removes terminal runs and their files but keeps active and recovery runs", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const mk = async (id, status) => fx.orchestrator.save({ id, status, prompt: "t", createdAt: new Date().toISOString(), route: route() });
  await mk("done-1", "succeeded");
  await mk("done-2", "failed");
  await mk("done-3", "cancelled");
  await mk("live-1", "waiting_agent");
  await mk("stuck-1", "recovery_required");
  const result = await fx.orchestrator.clearFinished();
  assert.equal(result.cleared, 3);
  const ids = fx.orchestrator.list().map((run) => run.id).sort();
  assert.deepEqual(ids, ["live-1", "stuck-1"], "active and recovery runs survive");
  const files = (await readdir(join(fx.root, "runs"))).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(files, ["live-1.json", "stuck-1.json"], "terminal run files removed from disk");
});

test("session cwd: rejects relative, missing and file paths; accepts a real directory", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  await assert.rejects(
    () => fx.orchestrator.create({ prompt: "p", execute: false, cwd: "relative/path" }),
    { code: "INVALID_CWD" },
  );
  await assert.rejects(
    () => fx.orchestrator.create({ prompt: "p", execute: false, cwd: resolve(fx.root, "does-not-exist") }),
    { code: "INVALID_CWD" },
  );
  const { writeFile: wf } = await import("node:fs/promises");
  const filePath = resolve(fx.root, "a-file.txt");
  await wf(filePath, "x", "utf8");
  await assert.rejects(
    () => fx.orchestrator.create({ prompt: "p", execute: false, cwd: filePath }),
    { code: "INVALID_CWD" },
  );
  const ok = await fx.orchestrator.create({ prompt: "p", execute: false, cwd: fx.root });
  assert.equal(ok.cwd, fx.root, "valid directory is persisted on the run");
  const none = await fx.orchestrator.create({ prompt: "p", execute: false });
  assert.equal(none.cwd, null, "omitted cwd stays null (repoRoot default)");
});

test("steer during an active execution queues and auto-injects at the next turn boundary", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  // 门闩阻塞主脑第一轮：run 保持活跃，期间的 continue 只能排队，不得打断子进程
  let releaseFirstTurn;
  const firstTurnGate = new Promise((resolveGate) => { releaseFirstTurn = resolveGate; });
  let markFirstTurnEntered;
  const firstTurnEntered = new Promise((resolveEnter) => { markFirstTurnEntered = resolveEnter; });
  const fable = fx.orchestrator.adapters.get("claude-fable");
  const originalSend = fable.send.bind(fable);
  let first = true;
  fable.send = async (input) => {
    if (first) {
      first = false;
      markFirstTurnEntered();
      await firstTurnGate;
    }
    return originalSend(input);
  };
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, maxRounds: 3, permissionMode: "plan" });
  await firstTurnEntered;
  const queued = await fx.orchestrator.continue(created.id, { prompt: "插话：记得保留证据" });
  assert.equal(queued.pendingSteer.length, 1, "活跃 run 的 continue 进队列而不是抛 RUN_ACTIVE");
  assert.equal(queued.pendingSteer[0].prompt, "插话：记得保留证据");
  assert.equal(fx.calls.length, 0, "排队不得打断进行中的第一轮（turn 原子性）");
  assert.equal(fx.events.filter((event) => event.type === "user.message").length, 0, "排队时不发 user.message——注入时才发，避免重复气泡");
  assert.ok(fx.events.some((event) => event.type === "run.steer_queued" && event.data.text === "插话：记得保留证据"));
  releaseFirstTurn();
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.status, "succeeded");
  assert.deepEqual(completed.pendingSteer, [], "注入后队列清空并持久化");
  // 拓扑：plan(fable) → specialist(codex) → critique(fable)；插话在第一个 turn 边界注入给主脑（自带一轮预算，不吃拓扑轮次）
  assert.equal(fx.calls.length, 4);
  assert.match(fx.calls[0].prompt, /规划阶段/);
  assert.equal(fx.calls[1].id, "claude-fable");
  assert.equal(fx.calls[1].prompt, "插话：记得保留证据");
  assert.equal(fx.calls[2].id, "codex-technical");
  const userMessages = fx.events.filter((event) => event.type === "user.message" && event.data.text === "插话：记得保留证据");
  assert.equal(userMessages.length, 1, "注入前先发一条 user.message 让前端可见");
});

test("steers queued during an active continuation drain in FIFO order after the turn", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "route only", execute: false, permissionMode: "plan" });
  // 门闩阻塞续聊那一轮：续聊活跃期间两条插话排队，本轮结束后后台 driver 逐条排干
  let releaseTurn;
  const gate = new Promise((resolveGate) => { releaseTurn = resolveGate; });
  let markEntered;
  const turnEntered = new Promise((resolveEnter) => { markEntered = resolveEnter; });
  const codex = fx.orchestrator.adapters.get("codex-technical");
  const originalSend = codex.send.bind(codex);
  let first = true;
  codex.send = async (input) => {
    if (first) {
      first = false;
      markEntered();
      await gate;
    }
    return originalSend(input);
  };
  const continuing = fx.orchestrator.continue(created.id, { prompt: "第一轮追问", agentId: "codex-technical" });
  await turnEntered;
  await fx.orchestrator.continue(created.id, { prompt: "插话一", agentId: "codex-technical" });
  await fx.orchestrator.continue(created.id, { prompt: "插话二", agentId: "codex-technical" });
  assert.deepEqual(
    fx.orchestrator.get(created.id).pendingSteer.map((steer) => steer.prompt),
    ["插话一", "插话二"],
    "两条插话按到达顺序排队",
  );
  releaseTurn();
  await continuing; // HTTP 语义：本请求只等自己那轮，不等排干
  // 排干是后台 driver：等到队列清空且 driver 释放 controller（收尾 save 完成）再断言终态
  const deadline = Date.now() + 5_000;
  let done = fx.orchestrator.get(created.id);
  while (Date.now() < deadline && ((done.pendingSteer || []).length || fx.orchestrator.controllers.has(created.id))) {
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 10));
    done = fx.orchestrator.get(created.id);
  }
  assert.deepEqual(done.pendingSteer, []);
  assert.equal(done.status, "succeeded");
  assert.deepEqual(fx.calls.map((call) => call.prompt), ["第一轮追问", "插话一", "插话二"], "FIFO 顺序自动排干");
});

test("continue on an inactive run is unchanged: immediate turn, no queue, no steer events", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "route only", execute: false, permissionMode: "plan" });
  const continued = await fx.orchestrator.continue(created.id, { prompt: "inspect", agentId: "codex-technical" });
  assert.equal(continued.status, "succeeded");
  assert.equal(fx.calls.length, 1);
  assert.equal(fx.calls[0].prompt, "inspect");
  assert.equal(continued.pendingSteer, undefined, "非活跃续聊不产生排队字段");
  assert.ok(!fx.events.some((event) => event.type === "run.steer_queued"));
  assert.equal(fx.events.filter((event) => event.type === "user.message").length, 1, "既有路径照旧先发 user.message");
});

test("steers that cannot fit the policy round cap are dropped with an audit event, not a failed run", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "route only", execute: false, permissionMode: "plan" });
  // 门闩阻塞续聊轮：policy 上限 6 轮，续聊占第 1 轮，排队 7 条 → 5 条注入、第 6 条封顶丢弃、第 7 条留队
  let releaseTurn;
  const gate = new Promise((resolveGate) => { releaseTurn = resolveGate; });
  let markEntered;
  const turnEntered = new Promise((resolveEnter) => { markEntered = resolveEnter; });
  const codex = fx.orchestrator.adapters.get("codex-technical");
  const originalSend = codex.send.bind(codex);
  let first = true;
  codex.send = async (input) => {
    if (first) {
      first = false;
      markEntered();
      await gate;
    }
    return originalSend(input);
  };
  const continuing = fx.orchestrator.continue(created.id, { prompt: "第一轮追问", agentId: "codex-technical" });
  await turnEntered;
  for (let index = 1; index <= 7; index += 1) {
    await fx.orchestrator.continue(created.id, { prompt: `插话${index}`, agentId: "codex-technical" });
  }
  releaseTurn();
  await continuing;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && fx.orchestrator.controllers.has(created.id)) {
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 10));
  }
  const done = fx.orchestrator.get(created.id);
  assert.equal(done.status, "succeeded", "封顶丢弃不把 run 打 failed");
  assert.equal(fx.calls.length, 6, "续聊 1 轮 + 排干 5 轮 = policy 上限 6 轮");
  assert.deepEqual(done.pendingSteer.map((steer) => steer.prompt), ["插话7"], "丢弃即停排，剩余追问留队如实可见");
  const dropped = fx.events.filter((event) => event.type === "run.steer_dropped");
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].data.text, "插话6");
  assert.equal(dropped[0].data.reason, "ROUND_LIMIT");
});

test("agent.turn_completed events carry adapter tokens and cost for message-level badges", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, maxRounds: 3, permissionMode: "plan" });
  await waitTerminal(fx.orchestrator, created.id);
  const turnEvents = fx.events.filter((event) => event.type === "agent.turn_completed");
  assert.ok(turnEvents.length >= 1, "至少一轮收尾事件");
  for (const event of turnEvents) {
    assert.equal(typeof event.data.tokens, "number", "tokens 计量随事件出仓（消息级徽标数据源）");
    assert.equal(typeof event.data.costUsd, "number", "costUsd 随事件出仓");
  }
});

test("save never clobbers concurrent steer mutations; memory and disk converge losslessly", async (t) => {
  // 竞态护栏（烛 wave2 P1）：旧实现"快照 → await 写盘 → 回写旧快照"会把写盘窗口内的
  // 并发 push 抹掉。交错风暴属非确定性触发（旧代码高概率红），新实现（同 tick 快照回写 +
  // per-run 写盘链）下必须恒绿。
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const run = fx.orchestrator.get(created.id);
  run.pendingSteer = [];
  const saves = [];
  for (let i = 0; i < 12; i += 1) {
    run.pendingSteer.push({ prompt: `插话${i}`, agentId: "claude-fable", queuedAt: new Date().toISOString() });
    saves.push(fx.orchestrator.save(run));
    await new Promise((resolveTick) => setImmediate(resolveTick)); // 打开写盘交错窗口
  }
  await Promise.all(saves);
  const latest = fx.orchestrator.get(created.id);
  assert.equal(latest.pendingSteer.length, 12, "内存不得丢失任何并发排队项");
  const disk = JSON.parse(await readFile(join(fx.root, "runs", `${created.id}.json`), "utf8"));
  assert.equal(disk.pendingSteer.length, 12, "磁盘最终态收敛到全部排队项");
  assert.deepEqual(
    disk.pendingSteer.map((steer) => steer.prompt),
    latest.pendingSteer.map((steer) => steer.prompt),
    "磁盘与内存逐项一致（无丢失、无重复、无回退）",
  );
});

test("clearFinished waits for in-flight save chains so cleared runs cannot resurrect", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const runPath = join(fx.root, "runs", `${created.id}.json`);
  // 门闩模拟迟到的写盘：释放后才把快照写回磁盘（旧实现 rm 不等链，该写回会让已清除 run 复活）
  let releaseSave;
  const gate = new Promise((resolveGate) => { releaseSave = resolveGate; });
  fx.orchestrator.saveChains.set(created.id, gate.then(async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(runPath, JSON.stringify(fx.orchestrator.get(created.id)), "utf8");
  }));
  const clearing = fx.orchestrator.clearFinished();
  releaseSave();
  const result = await clearing;
  assert.ok(result.runIds.includes(created.id), "终态 run 被清除");
  await assert.rejects(() => readFile(runPath, "utf8"), { code: "ENOENT" }, "在途写盘收敛后文件被删净，不复活");
});

test("close drains pending save chains before returning", async (t) => {
  const fx = await fixture();
  t.after(async () => { await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  let flushed = false;
  fx.orchestrator.saveChains.set(created.id, new Promise((resolveSlow) => setTimeout(resolveSlow, 120)).then(() => { flushed = true; }));
  await fx.orchestrator.close();
  assert.equal(flushed, true, "close 返回前全部在途写链已收敛（进程 exit 不截断写盘）");
});

test("recovery acknowledgement is not written when admission checks reject the continue", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const run = fx.orchestrator.get(created.id);
  run.status = "recovery_required";
  await assert.rejects(
    () => fx.orchestrator.continue(created.id, { prompt: "retry", agentId: "no-such-agent", acknowledgeRecovery: true }),
    { code: "ADAPTER_UNAVAILABLE" },
  );
  assert.equal(run.recoveryAcknowledgedAt, undefined, "校验拒绝时不留未持久化的孤儿确认字段");
});

test("restart-restated run statuses are persisted back to disk during init", async (t) => {
  const fx = await fixture();
  const root = fx.root;
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const runPath = join(root, "runs", `${created.id}.json`);
  const record = JSON.parse(await readFile(runPath, "utf8"));
  record.status = "running"; // 模拟控制面中断时的活跃态
  const { writeFile } = await import("node:fs/promises");
  await writeFile(runPath, JSON.stringify(record), "utf8");
  await fx.orchestrator.close();
  const { Orchestrator: Reloaded } = await import("../src/orchestrator.mjs");
  const second = await new Reloaded({
    router: { preview: async () => route() },
    adapters: new Map(),
    eventStore: { emit: async () => {} },
    dataRoot: root,
    policy: policy(),
    approvalBroker: { request: async () => ({ decision: "accept" }), denyRun() {} },
  }).init();
  assert.equal(second.get(created.id).status, "waiting_agent", "重启改写进内存");
  const persisted = JSON.parse(await readFile(runPath, "utf8"));
  assert.equal(persisted.status, "waiting_agent", "重启改写同步落盘，内存与磁盘不分叉");
  await second.close();
});

test("clearFinished keeps waiting when a new save chain appears mid-drain", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const runPath = join(fx.root, "runs", `${created.id}.json`);
  const { writeFile } = await import("node:fs/promises");
  let releaseFirst;
  const firstGate = new Promise((resolveGate) => { releaseFirst = resolveGate; });
  // 链 A settle 前夕挂上更迟的链 B（旧实现只等 A 且误删 B 引用，B 的迟到写盘会让文件复活）
  fx.orchestrator.saveChains.set(created.id, firstGate.then(async () => {
    await writeFile(runPath, JSON.stringify(fx.orchestrator.get(created.id)), "utf8");
    fx.orchestrator.saveChains.set(created.id, (async () => {
      await new Promise((resolveSlow) => setTimeout(resolveSlow, 60));
      await writeFile(runPath, JSON.stringify(fx.orchestrator.get(created.id)), "utf8");
    })());
  }));
  const clearing = fx.orchestrator.clearFinished();
  releaseFirst();
  const result = await clearing;
  assert.ok(result.runIds.includes(created.id));
  await assert.rejects(() => readFile(runPath, "utf8"), { code: "ENOENT" }, "循环收敛把链 B 也等完，文件不复活");
});

test("close keeps draining save chains that appear while it is waiting", async (t) => {
  const fx = await fixture();
  t.after(async () => { await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  let secondFlushed = false;
  fx.orchestrator.saveChains.set(created.id, new Promise((resolveSlow) => setTimeout(resolveSlow, 60)).then(() => {
    // 首链收敛瞬间挂上新链（一次性快照会漏掉它）
    fx.orchestrator.saveChains.set(created.id, new Promise((resolveNext) => setTimeout(resolveNext, 60)).then(() => { secondFlushed = true; }));
  }));
  await fx.orchestrator.close();
  assert.equal(secondFlushed, true, "close 循环收敛等待期间新增的写链");
});

test("init skips a run whose restart restatement cannot be persisted", async (t) => {
  const fx = await fixture();
  const root = fx.root;
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const runPath = join(root, "runs", `${created.id}.json`);
  const { writeFile } = await import("node:fs/promises");
  const record = JSON.parse(await readFile(runPath, "utf8"));
  record.status = "running";
  await writeFile(runPath, JSON.stringify(record), "utf8");
  await fx.orchestrator.close();
  const { Orchestrator: Reloaded } = await import("../src/orchestrator.mjs");
  class PersistFailing extends Reloaded {
    // 模拟基类真实失败序：同步段已 runs.set，之后 writeFile/rename 才抛——init 的 catch 必须兜底移除
    async save(run) {
      this.runs.set(run.id, run);
      throw new Error("disk full");
    }
  }
  const second = await new PersistFailing({
    router: { preview: async () => route() },
    adapters: new Map(),
    eventStore: { emit: async () => {} },
    dataRoot: root,
    policy: policy(),
    approvalBroker: { request: async () => ({ decision: "accept" }), denyRun() {} },
  }).init();
  assert.throws(() => second.get(created.id), { code: "RUN_NOT_FOUND" }, "落盘失败的改写不入内存（不分叉），文件留盘待查");
  const persisted = JSON.parse(await readFile(runPath, "utf8"));
  assert.equal(persisted.status, "running", "磁盘原样保留 forensic 状态");
  await second.close();
});

test("a late save from a lingering coroutine cannot resurrect a cleared run", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const run = fx.orchestrator.get(created.id); // 模拟终态尾巴协程仍持有的 run 引用
  const runPath = join(fx.root, "runs", `${created.id}.json`);
  const result = await fx.orchestrator.clearFinished();
  assert.ok(result.runIds.includes(created.id));
  await fx.orchestrator.save(run); // 迟到写盘（emitEvent 降级 / drain 收尾路径）
  await assert.rejects(() => readFile(runPath, "utf8"), { code: "ENOENT" }, "墓碑丢弃迟到写盘，文件不复活");
  assert.throws(() => fx.orchestrator.get(created.id), { code: "RUN_NOT_FOUND" }, "run 不回内存 Map");
});

test("a failed disk removal restores the run instead of orphaning it in memory", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const runPath = join(fx.root, "runs", `${created.id}.json`);
  // node 打开文件带 FILE_SHARE_DELETE，句柄锁不住删除——把 run 文件换成非空目录让 rm 必然抛错
  const { mkdir, writeFile } = await import("node:fs/promises");
  await rm(runPath, { force: true });
  await mkdir(runPath);
  await writeFile(join(runPath, "hold.txt"), "block non-recursive rm", "utf8");
  const result = await fx.orchestrator.clearFinished();
  assert.ok(!result.runIds.includes(created.id), "删盘失败不谎报已清除");
  assert.equal(fx.orchestrator.get(created.id).id, created.id, "run 恢复内存可见性（磁盘还在就不装作已清除）");
});

test("a direct HTTP continuation is tracked in executions so close waits for it", async (t) => {
  const fx = await fixture();
  t.after(async () => { await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  let releaseTurn;
  const gate = new Promise((resolveGate) => { releaseTurn = resolveGate; });
  fx.orchestrator.adapters.get("claude-fable").send = async () => {
    await gate;
    return { sessionId: "s", text: "done", protocol: "mock" };
  };
  const continuing = fx.orchestrator.continue(created.id, { prompt: "go", agentId: "claude-fable" });
  // continue 入口有多个 await（save/emitEvent）才到注册点，轮询等待而非赌单 tick
  const registerDeadline = Date.now() + 1_000;
  while (!fx.orchestrator.executions.has(`continue:${created.id}`) && Date.now() < registerDeadline) {
    await new Promise((resolveTick) => setImmediate(resolveTick));
  }
  assert.ok(fx.orchestrator.executions.has(`continue:${created.id}`), "在途续聊注册进 executions（close 可等待）");
  assert.equal(fx.orchestrator.isBusy(), true);
  releaseTurn();
  await continuing;
  assert.ok(!fx.orchestrator.executions.has(`continue:${created.id}`), "完成后自清");
  await fx.orchestrator.close();
});

test("cancelling a run with queued steers does not restart consumption afterwards", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "route only", execute: false, permissionMode: "plan" });
  let releaseTurn;
  const gate = new Promise((resolveGate) => { releaseTurn = resolveGate; });
  let markEntered;
  const turnEntered = new Promise((resolveEnter) => { markEntered = resolveEnter; });
  fx.orchestrator.adapters.get("claude-fable").send = async () => {
    markEntered();
    await gate;
    return { sessionId: "s", text: "done", protocol: "mock" };
  };
  const continuing = fx.orchestrator.continue(created.id, { prompt: "第一轮", agentId: "claude-fable" });
  await turnEntered;
  await fx.orchestrator.continue(created.id, { prompt: "排队插话", agentId: "claude-fable" });
  await fx.orchestrator.cancel(created.id);
  releaseTurn();
  await continuing.catch(() => {}); // 取消路径抛错属预期
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 50)); // 让链尾 ensure 有机会（不该）触发
  const done = fx.orchestrator.get(created.id);
  assert.equal(done.status, "cancelled");
  assert.deepEqual(done.pendingSteer.map((steer) => steer.prompt), ["排队插话"], "取消后留队如实可见，不被补启消费");
  assert.equal(fx.orchestrator.executions.size, 0, "无补启的排干协程");
});

test("a save already queued behind the chain is discarded once the tombstone lands", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const run = fx.orchestrator.get(created.id);
  const runPath = join(fx.root, "runs", `${created.id}.json`);
  // 门闩占住写链 → save 通过入口检查排在链上 → 墓碑落地 → 释放门闩 → flush 的写盘前复查应丢弃
  let releaseChain;
  fx.orchestrator.saveChains.set(created.id, new Promise((resolveChain) => { releaseChain = resolveChain; }));
  const lateSave = fx.orchestrator.save(run);
  fx.orchestrator.runs.delete(created.id);
  fx.orchestrator.clearedRuns.add(created.id);
  await rm(runPath, { force: true });
  releaseChain();
  await lateSave;
  await assert.rejects(() => readFile(runPath, "utf8"), { code: "ENOENT" }, "链上迟到写盘被墓碑复查丢弃，文件不复活");
});

test("clearFinished skips a terminal run whose execution coroutine has not finished", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  // 门闩 run.completed 事件写盘：execute 已置 succeeded 但协程卡在 emitEvent 的 await 窗口
  let releaseEmit;
  const emitGate = new Promise((resolveGate) => { releaseEmit = resolveGate; });
  const originalEmit = fx.orchestrator.eventStore.emit.bind(fx.orchestrator.eventStore);
  fx.orchestrator.eventStore.emit = async (type, data, context) => {
    if (type === "run.completed") await emitGate;
    return originalEmit(type, data, context);
  };
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, maxRounds: 3, permissionMode: "plan" });
  const statusDeadline = Date.now() + 5_000;
  while (Date.now() < statusDeadline && fx.orchestrator.get(created.id).status !== "succeeded") {
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 10));
  }
  assert.equal(fx.orchestrator.get(created.id).status, "succeeded");
  assert.ok(fx.orchestrator.executions.has(created.id), "协程仍在（卡在事件写盘）");
  const skipped = await fx.orchestrator.clearFinished();
  assert.ok(!skipped.runIds.includes(created.id), "终态但协程未收尾——本轮跳过不清");
  assert.equal(fx.orchestrator.get(created.id).id, created.id, "run 未被删除，协程不会 RUN_NOT_FOUND");
  releaseEmit();
  const drainDeadline = Date.now() + 5_000;
  while (Date.now() < drainDeadline && (fx.orchestrator.executions.has(created.id) || fx.orchestrator.controllers.has(created.id))) {
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 10));
  }
  const secondPass = await fx.orchestrator.clearFinished();
  assert.ok(secondPass.runIds.includes(created.id), "协程收尾后再次清理成功");
});

test("session effort override validates the CLI whitelist and reaches the coordinator turn", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  await assert.rejects(
    () => fx.orchestrator.create({ prompt: "x", execute: false, permissionMode: "plan", effort: "ultra;rm" }),
    { code: "INVALID_EFFORT" },
  );
  const created = await fx.orchestrator.create({ prompt: "x", execute: false, permissionMode: "plan", effort: "XHigh" });
  assert.equal(created.effortOverride, "xhigh", "大小写归一后固化");
  await fx.orchestrator.continue(created.id, { prompt: "go", agentId: "claude-fable" });
  assert.equal(fx.calls.at(-1).effort, "xhigh", "主脑轮携带 /effort 覆盖到 adapter");
  const plain = await fx.orchestrator.create({ prompt: "y", execute: false, permissionMode: "plan" });
  assert.equal(plain.effortOverride, null, "未选择时不传（CLI 用自身默认档）");
  const ultra = await fx.orchestrator.create({ prompt: "z", execute: false, permissionMode: "plan", effort: "ultracode" });
  assert.equal(ultra.effortOverride, "ultracode", "ultracode 档在白名单内（CLI 实测接受）");
});

test("run meta updates are whitelisted and project-level archive matches by cwd", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "meta target", execute: false, permissionMode: "plan", cwd: fx.root });
  const pinned = await fx.orchestrator.updateMeta(created.id, { pinned: true, unread: true, title: "改名后的任务", ignored: "x" });
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.unread, true);
  assert.equal(pinned.title, "改名后的任务");
  assert.equal(pinned.ignored, undefined, "白名单外字段不落盘");
  await assert.rejects(() => fx.orchestrator.updateMeta(created.id, { title: "   " }), { code: "VALIDATION_FAILED" });
  const other = await fx.orchestrator.create({ prompt: "other cwd", execute: false, permissionMode: "plan" });
  const archived = await fx.orchestrator.archiveFinishedByCwd(fx.root);
  assert.deepEqual(archived.runIds, [created.id], "仅归档 cwd 匹配的终态任务");
  assert.equal(fx.orchestrator.get(created.id).archived, true);
  assert.equal(fx.orchestrator.get(other.id).archived, undefined, "其他 cwd 不受影响");
});
