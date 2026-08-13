import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Orchestrator } from "../src/orchestrator.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// 这些方法只读写传入的 run，不碰适配器/磁盘——直接在原型上调，测真实逻辑而非源码字面量
const refundContext = {
  refundableAbandonedAttempt: Orchestrator.prototype.refundableAbandonedAttempt,
  refundAbandonedRound: Orchestrator.prototype.refundAbandonedRound,
};
const acknowledge = (run) => Orchestrator.prototype.acknowledgeAbandonedWork.call(refundContext, run);
const refund = (run) => Orchestrator.prototype.refundAbandonedRound.call(refundContext, run);
const snapshot = (run) => Orchestrator.prototype.abandonmentSnapshot.call({}, run);
const restore = (run, snap) => Orchestrator.prototype.restoreAbandonment.call({}, run, snap);

function runAt(phase, overrides = {}) {
  return {
    status: "recovery_required",
    round: 5,
    maxRounds: 6,
    roundsRefunded: 0,
    resumeQueue: [{ itemId: "item-1" }, { itemId: "item-2" }],
    pendingSteer: [{ id: "steer-1" }, { id: "steer-2" }],
    resumeClaim: { itemId: "item-1" },
    activeSteer: { steerId: "steer-1" },
    inflightTurns: { "codex-technical": "attempt-9" },
    turnAttempts: [{ attemptId: "attempt-9", round: 5, phase }],
    ...overrides,
  };
}

// 只有未提交或 provider 明确拒绝的 attempt 能证明没有真实调用，才允许退还。
test("a provably unaccepted round is refunded", () => {
  for (const phase of ["prepared", "session_ready", "rejected"]) {
    const run = runAt(phase);
    const result = refund(run);
    assert.equal(run.round, 4, `${phase} 应退还轮次`);
    assert.equal(run.roundsRefunded, 1);
    assert.equal(result.phase, phase);
    assert.equal(result.attemptId, "attempt-9");
  }
});

// submitting/submitted/ambiguous 都可能已到 provider；退还会允许超过 maxRounds 次真实调用。
test("possibly submitted or completed rounds are never refunded", () => {
  for (const phase of ["submitting", "submitted", "ambiguous", "completed", "failed"]) {
    const run = runAt(phase);
    assert.equal(refund(run), null, `${phase} 不该退还`);
    assert.equal(run.round, 5);
    assert.equal(run.roundsRefunded, 0);
  }
  const noAttempts = runAt("rejected", { turnAttempts: [] });
  assert.equal(refund(noAttempts), null);
  const atZero = runAt("rejected", { round: 0 });
  assert.equal(refund(atZero), null, "round 0 无可退");
});

test("one attempt cannot be refunded twice", () => {
  const run = runAt("rejected");
  assert.ok(refund(run));
  assert.equal(refund(run), null, "旧 attempt 的 round 已不再拥有当前 round，不得重复退还");
  assert.equal(run.round, 4);
  assert.equal(run.roundsRefunded, 1);
});

// 退还需要人点一次「确认恢复」，但脚本化调用方不能靠人的耐心兜底——必须有显式硬顶
test("refunds are capped so a scripted retry cannot loop forever", () => {
  const run = runAt("rejected", { round: 6, roundsRefunded: 6, maxRounds: 6, turnAttempts: [{ attemptId: "attempt-9", round: 6, phase: "rejected" }] });
  assert.equal(refund(run), null);
  assert.equal(run.round, 6, "达到退还上限后不再退");
  const justUnder = runAt("rejected", { round: 6, roundsRefunded: 5, maxRounds: 6, turnAttempts: [{ attemptId: "attempt-9", round: 6, phase: "rejected" }] });
  assert.ok(refund(justUnder));
  assert.equal(justUnder.roundsRefunded, 6);
});

// maxRounds 不动还不够；关键是可能已提交的 attempt 绝不能退，否则真实 provider 调用数会穿顶。
test("refunding preserves the provider-call ceiling", () => {
  const run = runAt("rejected");
  const before = run.maxRounds;
  refund(run);
  assert.equal(run.maxRounds, before);
  const ambiguous = runAt("ambiguous");
  assert.equal(refund(ambiguous), null);
  assert.equal(ambiguous.round, 5);
});

test("acknowledgement clears claimed work, inflight accounting and safe refund in one place", () => {
  const run = runAt("rejected");
  const result = acknowledge(run);
  // 被放弃的那一件从队列摘掉，其余保留
  assert.deepEqual(run.resumeQueue, [{ itemId: "item-2" }]);
  assert.deepEqual(run.pendingSteer, [{ id: "steer-2" }]);
  assert.equal(run.resumeClaim, null);
  assert.equal(run.activeSteer, null);
  // inflight 不清 = 该成员永远"正在准备会话"，新消息只排队发不出去
  assert.deepEqual(run.inflightTurns, {});
  assert.ok(run.recoveryAcknowledgedAt);
  assert.match(run.recoveryNote, /abandoned the claimed work/);
  assert.equal(run.round, 4);
  assert.equal(result.roundsRefunded, 1);
});

// 落盘失败必须整体回滚：留半套状态比不改更糟（配额已退但工作项还在队列里）
test("the snapshot restores every field the acknowledgement touches", () => {
  const run = runAt("ambiguous");
  const before = JSON.parse(JSON.stringify(run));
  const snap = snapshot(run);
  acknowledge(run);
  assert.notDeepEqual(JSON.parse(JSON.stringify(run)), before);
  restore(run, snap);
  assert.deepEqual(JSON.parse(JSON.stringify(run)), before, "回滚后与放弃前不一致");
});

test("all recovery paths go through the shared collection point", async () => {
  const source = await readFile(`${root}/src/orchestrator.mjs`, "utf8");
  // 之前两条路径各写一份，结果 inflightTurns 只有排队那条清、注记文案还不一样；
  // 第三条合法路径是 updateRunControls（确认恢复随热改一次性携带）——也必须走同一收口
  assert.equal(source.split("this.acknowledgeAbandonedWork(run)").length - 1, 3, "恢复确认路径没有全部收口");
  assert.equal(source.split("run.inflightTurns = {};").length - 1, 1, "inflight 清理又散回多处");
  assert.equal(source.split("run.recoveryNote = \"Operator acknowledged").length - 1, 1, "恢复注记文案又出现多份");
  // 退还只在落盘成功后播报，回滚过的账目不得进会话流
  assert.ok(source.includes("if (refund) await this.emitRoundRefund(run, refund);"));
  assert.ok(source.includes("if (directRefund) await this.emitRoundRefund(run, directRefund);"));
  assert.ok(source.includes("if (recoveryRefund) await this.emitRoundRefund(run, recoveryRefund);"), "热改路径的退还也必须在落盘后播报");
  const app = await readFile(`${root}/public/app.js`, "utf8");
  assert.ok(app.includes('"run.round_refunded": {'), "退还没有会话流可见性");
  assert.ok(app.includes("metaParts.push(refunded ? `${budget} · 已退还 ${refunded}` : budget);"));
});

// —— 接线验证：走真实 continue() 而非直接调 helper ——
// 单测证明账目逻辑对，接线测试证明它真的被调用到了（两条恢复路径曾各写一份、只修了一半）。
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";

function policy() {
  return {
    version: 1,
    modes: { plan: { write: false, approvalRequired: false }, review: { write: false, shell: "read-only", approvalRequired: false }, build: { write: "workspace", approvalRequired: true } },
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

async function wiredFixture() {
  const dataRoot = await mkdtemp(resolve(root, ".test-round-refund-"));
  const adapter = (id) => ({
    cwd: dataRoot,
    async send(input) {
      await input.onSessionStarted?.({ sessionId: `${id}-session`, protocol: `${id}-mock` });
      await input.onTurnSubmitting?.({ sessionId: `${id}-session`, protocol: `${id}-mock`, clientUserMessageId: `${id}-m` });
      await input.onTurnAccepted?.({ sessionId: `${id}-session`, protocol: `${id}-mock`, clientUserMessageId: `${id}-m`, turnId: `${id}-t` });
      return { sessionId: `${id}-session`, text: `${id}-done`, protocol: `${id}-mock`, tokens: 100, costUsd: 0.01 };
    },
    async close() {},
  });
  const events = [];
  const orchestrator = await new Orchestrator({
    router: { preview: async () => route() },
    adapters: new Map([["claude-fable", adapter("claude-fable")], ["codex-technical", adapter("codex-technical")]]),
    eventStore: { emit: async (type, data) => { events.push({ type, data }); } },
    dataRoot,
    policy: policy(),
    approvalBroker: { request: async () => ({ decision: "accept" }), denyRun() {} },
    capabilities: { agentDisabledSkills: async () => new Set() },
  }).init();
  return { dataRoot, orchestrator, events };
}

test("an explicit provider rejection is checkpointed and refunded on the next continuation", async (t) => {
  const fx = await wiredFixture();
  t.after(async () => { await fx.orchestrator.close().catch(() => {}); await rm(fx.dataRoot, { recursive: true, force: true }); });
  const target = fx.orchestrator.adapters.get("codex-technical");
  const successfulSend = target.send.bind(target);
  target.send = async (input) => {
    await input.onSessionStarted?.({ sessionId: "rejected-session", protocol: "mock" });
    await input.onTurnSubmitting?.({ sessionId: "rejected-session", protocol: "mock", clientUserMessageId: "rejected-message" });
    throw Object.assign(new Error("INSUFFICIENT_BALANCE"), {
      code: 403,
      submissionRejected: true,
      safeToFallback: true,
    });
  };
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });

  await assert.rejects(
    () => fx.orchestrator.continue(created.id, { prompt: "first", agentId: "codex-technical" }),
    (error) => error.code === 403,
  );
  const rejected = fx.orchestrator.get(created.id);
  assert.equal(rejected.status, "failed");
  assert.equal(rejected.round, 1);
  assert.equal(rejected.turnAttempts.at(-1).phase, "rejected");
  assert.deepEqual(rejected.inflightTurns, {});
  const rejectedCheckpointIndex = fx.events.findIndex((event) => event.type === "agent.turn_checkpoint" && event.data.phase === "rejected");
  const failedIndex = fx.events.findIndex((event) => event.type === "run.failed");
  assert.ok(rejectedCheckpointIndex >= 0 && failedIndex > rejectedCheckpointIndex, "明确拒绝落盘后必须发布 run.failed");

  target.send = successfulSend;
  await fx.orchestrator.continue(created.id, { prompt: "retry", agentId: "codex-technical" });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && (fx.orchestrator.executions.size || fx.orchestrator.controllers.size)) {
    await new Promise((tick) => setTimeout(tick, 10));
  }
  const retried = fx.orchestrator.get(created.id);
  assert.equal(retried.roundsRefunded, 1);
  assert.equal(retried.round, 1, "明确拒绝不占有效轮，重试复用同一轮号");
  assert.equal(retried.turnAttempts.at(-1).phase, "completed");
  const refundIndex = fx.events.findIndex((event, index) => index > failedIndex && event.type === "run.round_refunded");
  const restartedIndex = fx.events.findIndex((event, index) => index > refundIndex && event.type === "agent.turn_started");
  assert.ok(refundIndex > failedIndex && restartedIndex > refundIndex, "事件顺序必须是 rejected -> failed -> refunded -> restarted");
});

test("continue() refunds an explicitly rejected final round and reuses its number", async (t) => {
  const fx = await wiredFixture();
  t.after(async () => { await fx.orchestrator.close().catch(() => {}); await rm(fx.dataRoot, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const run = fx.orchestrator.get(created.id);
  run.status = "failed";
  run.round = 6;
  run.turnAttempts = [{ attemptId: "attempt-rejected", round: 6, agentId: "codex-technical", phase: "rejected" }];
  run.inflightTurns = {};

  await fx.orchestrator.continue(created.id, { prompt: "继续", agentId: "codex-technical" });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && (fx.orchestrator.executions.size || fx.orchestrator.controllers.size)) {
    await new Promise((tick) => setTimeout(tick, 10));
  }
  const after = fx.orchestrator.get(created.id);
  assert.equal(after.roundsRefunded, 1, "明确拒绝的第 6 轮没有退还");
  assert.equal(after.round, 6, "退还后重试应复用第 6 轮，而不是越过硬顶");
  assert.deepEqual(after.inflightTurns, {});
  const refundEvent = fx.events.find((event) => event.type === "run.round_refunded");
  assert.ok(refundEvent, "退还没有落审计事件");
  assert.equal(refundEvent.data.round, 5);
  assert.equal(refundEvent.data.maxRounds, 6, "退还不得抬高 maxRounds（成本硬顶不放松）");
  assert.equal(refundEvent.data.phase, "rejected");
});

test("acknowledged ambiguous work is abandoned but never refunded", async (t) => {
  const fx = await wiredFixture();
  t.after(async () => { await fx.orchestrator.close().catch(() => {}); await rm(fx.dataRoot, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const run = fx.orchestrator.get(created.id);
  run.status = "recovery_required";
  run.round = 5;
  run.turnAttempts = [{ attemptId: "attempt-ambiguous", round: 5, agentId: "codex-technical", phase: "ambiguous" }];
  run.inflightTurns = { "codex-technical": "attempt-ambiguous" };

  await fx.orchestrator.continue(created.id, { prompt: "继续", agentId: "codex-technical", acknowledgeRecovery: true });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && (fx.orchestrator.executions.size || fx.orchestrator.controllers.size)) {
    await new Promise((tick) => setTimeout(tick, 10));
  }
  const after = fx.orchestrator.get(created.id);
  assert.equal(after.roundsRefunded, 0);
  assert.equal(after.round, 6, "不明确的旧调用与重试必须各占一轮");
  assert.deepEqual(after.inflightTurns, {});
  assert.ok(!fx.events.some((event) => event.type === "run.round_refunded"));
});

test("a final ambiguous round remains blocked by the hard limit", async (t) => {
  const fx = await wiredFixture();
  t.after(async () => { await fx.orchestrator.close().catch(() => {}); await rm(fx.dataRoot, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const run = fx.orchestrator.get(created.id);
  run.status = "recovery_required";
  run.round = 6;
  run.turnAttempts = [{ attemptId: "attempt-final-ambiguous", round: 6, agentId: "codex-technical", phase: "ambiguous" }];
  const before = JSON.parse(JSON.stringify(run));

  await assert.rejects(
    fx.orchestrator.continue(created.id, { prompt: "继续", agentId: "codex-technical", acknowledgeRecovery: true }),
    { code: "ROUND_LIMIT" },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(fx.orchestrator.get(created.id))), before, "封顶拒绝不得半改恢复状态");
});

// 没有退还时的对照：末轮已 completed（真跑过），重试必须照常扣配额，不能白送
test("a completed final round is not refunded, so the retry still costs a round", async (t) => {
  const fx = await wiredFixture();
  t.after(async () => { await fx.orchestrator.close().catch(() => {}); await rm(fx.dataRoot, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const run = fx.orchestrator.get(created.id);
  run.status = "recovery_required";
  run.round = 4;
  run.turnAttempts = [{ attemptId: "attempt-done", round: 4, agentId: "codex-technical", phase: "completed" }];

  await fx.orchestrator.continue(created.id, { prompt: "继续", agentId: "codex-technical", acknowledgeRecovery: true });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && (fx.orchestrator.executions.size || fx.orchestrator.controllers.size)) {
    await new Promise((tick) => setTimeout(tick, 10));
  }
  const after = fx.orchestrator.get(created.id);
  assert.equal(after.roundsRefunded, 0, "已跑完的轮被错误退还");
  assert.equal(after.round, 5, "重试应正常消耗一轮");
  assert.ok(!fx.events.some((event) => event.type === "run.round_refunded"));
});
