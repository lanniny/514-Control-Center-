import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Orchestrator, renameWithRetry } from "../src/orchestrator.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveDeferred, rejectDeferred) => {
    resolvePromise = resolveDeferred;
    rejectPromise = rejectDeferred;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function policy() {
  return {
    version: 1,
    modes: {
      plan: { write: false, approvalRequired: false },
      review: { write: false, shell: "read-only", approvalRequired: false },
      build: { write: "workspace", approvalRequired: true },
    },
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

test("renameWithRetry retries only transient Windows replacement failures", async () => {
  const attempts = [];
  const sleeps = [];
  await renameWithRetry("source", "target", {
    async renameFile(source, target) {
      attempts.push([source, target]);
      if (attempts.length < 3) throw Object.assign(new Error("file is temporarily locked"), { code: "EPERM" });
    },
    async sleep(delayMs) { sleeps.push(delayMs); },
  });
  assert.equal(attempts.length, 3);
  assert.deepEqual(sleeps, [10, 25]);

  let permanentAttempts = 0;
  await assert.rejects(
    renameWithRetry("source", "target", {
      async renameFile() {
        permanentAttempts += 1;
        throw Object.assign(new Error("missing directory"), { code: "ENOENT" });
      },
      async sleep() { throw new Error("must not sleep for permanent failures"); },
    }),
    { code: "ENOENT" },
  );
  assert.equal(permanentAttempts, 1);
});

async function fixture({ approvalRequest, capabilities = { agentDisabledSkills: async () => new Set() }, policy: policyOverride = null, models = null } = {}) {
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
    request: approvalRequest || (async () => ({ decision: "accept", approvalId: "approval-fixture" })),
    denyRun() {},
  };
  const events = [];
  const orchestrator = await new Orchestrator({
    router: { preview: async () => route() },
    adapters,
    eventStore: { emit: async (type, data) => { events.push({ type, data }); } },
    dataRoot: root,
    policy: policyOverride || policy(),
    approvalBroker,
    capabilities,
    models,
  }).init();
  return { root, calls, orchestrator, approvalBroker, events };
}

async function waitTerminal(orchestrator, id) {
  // A wider deadline only affects a failing run under full-suite contention; ownership must still
  // drain before success, and the timeout retains enough phase data to expose a genuine hang.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const run = orchestrator.get(id);
    const executionActive = orchestrator.executions.has(id) || orchestrator.executions.has(`continue:${id}`);
    const controllerActive = orchestrator.controllers.has(id);
    // execute() persists terminal state before its final audit event. The execution entry is removed
    // only after that event settles, so waiting on ownership release avoids observing a false partial end.
    if (["succeeded", "failed", "cancelled", "recovery_required"].includes(run.status) && !executionActive && !controllerActive) {
      return orchestrator.get(id);
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 10));
  }
  const stuck = orchestrator.get(id);
  throw new Error(`run did not finish | diag=${JSON.stringify({
    status: stuck.status,
    round: stuck.round,
    maxRounds: stuck.maxRounds,
    controllers: [...orchestrator.controllers.keys()],
    executions: [...orchestrator.executions.keys()],
    attempts: (stuck.turnAttempts || []).map((attempt) => `${attempt.agentId}:${attempt.phase}`),
  })}`);
}

test("high-risk execution performs planner, specialist and independent verifier rounds", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "plan" });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.status, "succeeded");
  assert.deepEqual(fx.calls.map((call) => call.id), ["claude-fable", "codex-technical", "claude-fable"]);
  assert.ok(fx.calls.every((call) => call.permissionMode === "plan"), "Plan must reach every Adapter as native plan");
  assert.equal(completed.result.final, completed.result.critique);
  assert.equal(completed.turnAttempts.length, 3);
  assert.ok(completed.turnAttempts.every((attempt) => attempt.phase === "completed" && attempt.sessionId));
});

test("missing capability provider blocks every provider dispatch", async (t) => {
  const fx = await fixture({ capabilities: null });
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "must fail closed", execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "plan" });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.status, "failed");
  assert.equal(fx.calls.length, 0);
  assert.ok(fx.events.some((event) => event.type === "run.failed" && event.data?.code === "CAPABILITY_CONFIG_UNAVAILABLE"));
});

test("historical runs cannot continue through a provider removed from the live adapter graph", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "preview", execute: false, permissionMode: "plan" });
  const retainedClaude = fx.orchestrator.adapters.get("claude-fable");
  await fx.orchestrator.replaceRuntime({
    router: fx.orchestrator.router,
    adapters: new Map([["claude-fable", retainedClaude]]),
    policy: fx.orchestrator.policy,
    models: { profiles: [{ id: "claude-fable", enabled: true }, { id: "codex-technical", enabled: false }] },
  });
  await assert.rejects(
    () => fx.orchestrator.continue(created.id, { prompt: "must stay disabled", agentId: "codex-technical" }),
    { code: "ADAPTER_UNAVAILABLE" },
  );
});

test("round budget cannot bypass mandatory independent verification", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  await assert.rejects(
    () => fx.orchestrator.create({ prompt: "implement", execute: true, orchestrationMode: "pipeline", maxRounds: 1, permissionMode: "plan" }),
    { code: "INSUFFICIENT_ROUNDS" },
  );
});

test("run creation reuses a persisted idempotency key and validates its wire format", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const input = {
    prompt: "idempotent automation launch",
    execute: false,
    permissionMode: "plan",
    idempotencyKey: "automation:fixture:11111111-1111-4111-8111-111111111111",
  };
  const first = await fx.orchestrator.create(input);
  const second = await fx.orchestrator.create(input);
  assert.equal(second.id, first.id);
  assert.equal(second.idempotencyKey, input.idempotencyKey);
  assert.equal(fx.orchestrator.list().length, 1);
  assert.equal(fx.events.filter((event) => event.type === "run.created").length, 1);
  await assert.rejects(
    () => fx.orchestrator.create({ ...input, idempotencyKey: "bad key with spaces" }),
    { code: "VALIDATION_FAILED" },
  );
});

test("build execution waits for approval and binds workspace-write to the selected executor", async (t) => {
  let decide;
  const decision = new Promise((resolveDecision) => { decide = resolveDecision; });
  const fx = await fixture({ approvalRequest: async () => decision });
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "build" });
  assert.equal(created.status, "waiting_approval");
  await assert.rejects(() => fx.orchestrator.continue(created.id, { prompt: "bypass", agentId: "codex-technical" }), { code: "APPROVAL_REQUIRED" });
  assert.equal(fx.calls.length, 0);
  decide({ decision: "accept", approvalId: "approval-deferred" });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.buildApproval.status, "approved");
  assert.equal(completed.buildApproval.approvalId, "approval-deferred");
  assert.equal(fx.calls.find((call) => call.id === "codex-technical").permissionMode, "workspace-write");
  assert.ok(fx.calls.filter((call) => call.id === "claude-fable").every((call) => call.permissionMode === "plan"));
  assert.equal(fx.orchestrator.buildApprovalIsValid(completed), true);
  assert.ok(fx.orchestrator.activeCapabilityLease(completed), "approved build must issue an active capability lease");
  assert.equal(completed.buildApproval.lease?.status, "active");
  assert.equal(fx.events.filter((event) => event.type === "capability.lease_issued").length, 1);
  const approvedMessage = fx.orchestrator.buildApprovalMessage(completed);
  assert.equal(approvedMessage.params.workspace, resolve(fx.root));
  assert.equal(approvedMessage.params.workspaceSource, "adapter.cwd");
  assert.equal(approvedMessage.params.isolation, "none");
  completed.cwd = join(fx.root, "different-workspace");
  assert.equal(fx.orchestrator.buildApprovalIsValid(completed), false, "changing the execution workspace invalidates approval");
  assert.equal(fx.orchestrator.activeCapabilityLease(completed), null, "invalid approval also voids lease");
  completed.cwd = null;
  assert.equal(fx.orchestrator.buildApprovalIsValid(completed), true);
  assert.ok(fx.orchestrator.activeCapabilityLease(completed));
  completed.route.selected.id = "claude-fable";
  assert.equal(fx.orchestrator.buildApprovalIsValid(completed), false);
});

// LO 2026-08-09：Codex 官方权限档（桌面批准菜单同款）。composer mode 必须映射到
// 原生 sandbox+approvalPolicy 组合 id，且只有声明预设族的 adapter（codex）能用；
// 官方语义不经过 514cc 的 build 审批/租约门，其余成员保持只读/plan。
function codexPresetFixture(extra = {}) {
  const presetPolicy = policy();
  presetPolicy.modes.ask = { write: "workspace", approvalRequired: false };
  presetPolicy.modes.auto = { write: "workspace", approvalRequired: false };
  presetPolicy.modes["full-access"] = { write: true, approvalRequired: false };
  presetPolicy.modes.config = { write: "config.toml", approvalRequired: false };
  return fixture({
    policy: presetPolicy,
    models: { profiles: [
      { id: "codex-technical", adapter: "codex-app-server" },
      { id: "claude-fable", adapter: "claude-stream-json" },
    ] },
    ...extra,
  });
}

test("Codex official presets map to native sandbox/approval combos without the 514cc build gate", async (t) => {
  let approvals = 0;
  const fx = await codexPresetFixture({
    approvalRequest: async () => { approvals += 1; return { decision: "accept", approvalId: "approval-preset" }; },
  });
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const cases = [
    ["ask", "workspace-write"],
    ["auto", "workspace-write:on-failure"],
    ["full-access", "danger-full-access"],
    ["config", "config-default"],
  ];
  for (const [composerMode, nativeMode] of cases) {
    fx.calls.length = 0;
    const created = await fx.orchestrator.create({
      prompt: `preset ${composerMode}`, execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: composerMode,
    });
    const completed = await waitTerminal(fx.orchestrator, created.id);
    assert.equal(completed.status, "succeeded", `${composerMode} run must complete`);
    assert.equal(fx.calls.find((call) => call.id === "codex-technical")?.permissionMode, nativeMode, `${composerMode} native mode`);
    assert.ok(fx.calls.filter((call) => call.id === "claude-fable").every((call) => call.permissionMode === "plan"),
      `${composerMode}: 非执行拥有者保持 plan，写面不扩散`);
  }
  assert.equal(approvals, 0, "Codex 官方档不得触发 514cc build 审批门（审批发生在 Codex 层或按官方语义不询问）");
});

test("Codex official presets are rejected on adapters outside the preset family", async (t) => {
  const fx = await codexPresetFixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  for (const mode of ["ask", "auto", "full-access", "config"]) {
    await assert.rejects(
      () => fx.orchestrator.create({
        prompt: "preset on claude", execute: false, orchestrationMode: "pipeline", maxRounds: 3,
        permissionMode: mode, startAgentId: "claude-fable",
      }),
      { code: "UNSUPPORTED_PERMISSION" },
      `${mode} 不得在 claude 模板上放行——ask 原生映射与 build 同为 workspace-write，不能绕过 build 审批门`,
    );
  }
  await assert.rejects(
    () => fx.orchestrator.create({ prompt: "unknown", execute: false, permissionMode: "yolo" }),
    { code: "VALIDATION_FAILED" },
  );
});

// LO 2026-08-10：会话配置不应一刀切固化。模型（per-turn 覆盖）、Effort 与权限白名单迁移
// （降档 / Codex ask↔auto）可会话中热改、下一轮生效；Codex 沙箱轴随原生 thread 固化，不开口子。
test("hot control updates apply next turn and enforce the transition whitelist", async (t) => {
  const fx = await codexPresetFixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({
    prompt: "hot", execute: false, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "ask",
  });

  // Effort 设置 + 清除
  await fx.orchestrator.updateRunControls(created.id, { effort: "high" });
  assert.equal(fx.orchestrator.get(created.id).effortOverride, "high");
  await assert.rejects(
    () => fx.orchestrator.updateRunControls(created.id, { effort: "turbo" }),
    { code: "INVALID_EFFORT" },
  );
  await fx.orchestrator.updateRunControls(created.id, { effort: "ultra" });
  assert.equal(fx.orchestrator.get(created.id).effortOverride, "ultra");
  await fx.orchestrator.updateRunControls(created.id, { effort: "" });
  assert.equal(fx.orchestrator.get(created.id).effortOverride, null);

  // 权限白名单：ask↔auto 放行（同 sandbox，只动 turn 级 approvalPolicy）
  await fx.orchestrator.updateRunControls(created.id, { permissionMode: "auto" });
  assert.equal(fx.orchestrator.get(created.id).permissionMode, "auto");
  await fx.orchestrator.updateRunControls(created.id, { permissionMode: "ask" });
  assert.equal(fx.orchestrator.get(created.id).permissionMode, "ask");
  // 沙箱轴变动 / 跨族 / 升档一律拒绝并如实说明
  for (const target of ["full-access", "config", "review", "plan", "build"]) {
    await assert.rejects(
      () => fx.orchestrator.updateRunControls(created.id, { permissionMode: target }),
      { code: "CONTROL_TRANSITION_FORBIDDEN" },
      `ask → ${target} 不得热改`,
    );
  }
  // 同档幂等：不产生变更事件
  const eventsBefore = fx.events.filter((event) => event.type === "run.control_changed").length;
  await fx.orchestrator.updateRunControls(created.id, { permissionMode: "ask", effort: "" });
  assert.equal(fx.events.filter((event) => event.type === "run.control_changed").length, eventsBefore);

  // 热改后的下一轮派工使用新值（模型经 0.146.0 实测：turn/start 接受 per-turn 覆盖）
  await fx.orchestrator.updateRunControls(created.id, { effort: "high", permissionMode: "auto", model: "gpt-5.5" });
  assert.equal(fx.orchestrator.get(created.id).modelOverride, "gpt-5.5");
  await assert.rejects(
    () => fx.orchestrator.updateRunControls(created.id, { model: "not a model!" }),
    { code: "INVALID_MODEL" },
  );
  fx.calls.length = 0;
  await fx.orchestrator.continue(created.id, { prompt: "go" });
  const codexCall = fx.calls.find((call) => call.id === "codex-technical");
  assert.equal(codexCall.permissionMode, "workspace-write:on-failure", "下一轮必须用上热切后的原生档");
  assert.equal(codexCall.effort, "high", "下一轮必须用上热改的 Effort");
  assert.equal(codexCall.model, "gpt-5.5", "下一轮必须用上热改的模型");
  const controlEvents = fx.events.filter((event) => event.type === "run.control_changed");
  assert.ok(controlEvents.length >= 1, "热改必须落审计事件");
  assert.deepEqual(controlEvents.at(-1).data.changes, [
    { field: "model", from: null, to: "gpt-5.5" },
    { field: "effort", from: null, to: "high" },
    { field: "permissionMode", from: "ask", to: "auto" },
  ]);
});

test("514cc permission downgrades are hot-switchable, upgrades stay creation-gated", async (t) => {
  let approvals = 0;
  const fx = await codexPresetFixture({
    approvalRequest: async () => { approvals += 1; return { decision: "accept", approvalId: "approval-downgrade" }; },
  });
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({
    prompt: "build then downgrade", execute: false, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "build",
  });
  const approvalsAtCreation = approvals;
  // 降档链：build→review→plan 全部放行，无需审批
  await fx.orchestrator.updateRunControls(created.id, { permissionMode: "review" });
  assert.equal(fx.orchestrator.get(created.id).permissionMode, "review");
  await fx.orchestrator.updateRunControls(created.id, { permissionMode: "plan" });
  assert.equal(fx.orchestrator.get(created.id).permissionMode, "plan");
  assert.equal(approvals, approvalsAtCreation, "降档不得触发审批门");
  // 升档（plan→review/build）与跨族（plan→ask）拒绝
  for (const target of ["review", "build", "ask"]) {
    await assert.rejects(
      () => fx.orchestrator.updateRunControls(created.id, { permissionMode: target }),
      { code: "CONTROL_TRANSITION_FORBIDDEN" },
      `plan → ${target} 不得热改`,
    );
  }
  // 降档后下一轮只读
  fx.calls.length = 0;
  await fx.orchestrator.continue(created.id, { prompt: "read only now" });
  assert.ok(fx.calls.every((call) => ["plan", "read-only"].includes(call.permissionMode)), "降档后任何成员不得拿写档");
});

test("hot control gates mirror continuation admission: approval-pending and recovery block, idle allows", async (t) => {
  let decide;
  const decision = new Promise((resolveDecision) => { decide = resolveDecision; });
  const fx = await fixture({ approvalRequest: async () => decision });
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  // 审批待决：改动会污染动作绑定审批语义，拒绝
  const pending = await fx.orchestrator.create({
    prompt: "approval pending", execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "build",
  });
  assert.equal(pending.status, "waiting_approval");
  await assert.rejects(
    () => fx.orchestrator.updateRunControls(pending.id, { permissionMode: "review" }),
    { code: "APPROVAL_REQUIRED" },
  );
  decide({ decision: "accept", approvalId: "approval-gate" });
  await waitTerminal(fx.orchestrator, pending.id);
  // succeeded 的闲置会话可热改（续聊场景正是两轮之间），下一轮生效
  const idle = fx.orchestrator.get(pending.id);
  assert.equal(idle.status, "succeeded");
  await fx.orchestrator.updateRunControls(pending.id, { permissionMode: "plan", effort: "low" });
  assert.equal(fx.orchestrator.get(pending.id).permissionMode, "plan");
  assert.equal(fx.orchestrator.get(pending.id).effortOverride, "low");
  // 恢复未确认：提交状态不明，拒绝
  idle.status = "recovery_required";
  idle.inflightTurns = { "codex-technical": { round: 1, phase: "submitted" } };
  await assert.rejects(
    () => fx.orchestrator.updateRunControls(pending.id, { effort: "high" }),
    { code: "RECOVERY_REQUIRED" },
  );
  // 确认携带但校验失败：必须整体回滚——claim 不能白白作废、状态不能半翻页
  await assert.rejects(
    () => fx.orchestrator.updateRunControls(pending.id, { effort: "turbo" }, { acknowledgeRecovery: true }),
    { code: "INVALID_EFFORT" },
  );
  const rolledBack = fx.orchestrator.get(pending.id);
  assert.equal(rolledBack.status, "recovery_required", "校验失败后必须回滚到 recovery_required");
  assert.ok(rolledBack.inflightTurns["codex-technical"], "校验失败后 inflight 记账必须回滚");
  // 确认随热改一次性携带：原子完成"放弃 claim + 改档"，停在可续聊的闲置终态
  await fx.orchestrator.updateRunControls(pending.id, { effort: "high" }, { acknowledgeRecovery: true });
  const acked = fx.orchestrator.get(pending.id);
  assert.equal(acked.status, "failed", "确认后不跑轮：停在 failed 闲置终态");
  assert.equal(acked.effortOverride, "high");
  assert.deepEqual(acked.inflightTurns, {}, "确认后 inflight 记账必须作废");
  assert.ok(acked.recoveryAcknowledgedAt, "确认时间必须落账");
  assert.ok(
    fx.events.some((event) => event.type === "run.recovery_acknowledged"),
    "确认恢复必须落审计事件——热改路径不静默",
  );
  assert.ok(
    fx.events.some((event) => event.type === "run.control_changed"
      && event.data.changes.some((change) => change.field === "effort" && change.to === "high")),
    "热改本身仍落 control_changed 审计",
  );
  // 确认后状态已翻页：再热改不再需要 acknowledgeRecovery
  await fx.orchestrator.updateRunControls(pending.id, { effort: "low" });
  assert.equal(fx.orchestrator.get(pending.id).effortOverride, "low");
});

test("capability lease can be revoked mid-run and blocks workspace-write", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "build" });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  const lease = fx.orchestrator.activeCapabilityLease(completed);
  assert.ok(lease, "build approval path must issue active lease");
  assert.equal(lease.status, "active");
  assert.equal(lease.actionSha256, completed.buildApproval.actionSha256);
  // 吊销租约本身（不依赖 turn 生命周期）
  const revoked = await fx.orchestrator.revokeCapabilityLeaseForRun(completed.id, {
    reason: "operator-revoke",
    actor: "test-operator",
  });
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revokedBy, "test-operator");
  assert.equal(fx.orchestrator.activeCapabilityLease(completed), null);
  assert.ok(fx.events.some((event) => event.type === "capability.lease_revoked"));
  // 过期语义：伪造 expiresAt 也应使 activeCapabilityLease 返回 null
  completed.buildApproval.lease = {
    ...lease,
    status: "active",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  };
  assert.equal(fx.orchestrator.activeCapabilityLease(completed), null);
  assert.equal(completed.buildApproval.lease.status, "expired");
});

test("taskGraph records social delegations and cancel marks edges cancelled", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const run = await fx.orchestrator.create({ prompt: "route graph", execute: false, permissionMode: "plan" });
  fx.orchestrator.recordTaskGraphDelegation(run, {
    fromAgentId: "claude-fable",
    toAgentId: "codex-technical",
    busMessageId: "bus-msg-1",
    kind: "route",
    state: "queued",
  });
  await fx.orchestrator.save(run);
  const reloaded = fx.orchestrator.get(run.id);
  assert.equal(reloaded.taskGraph.delegations.length, 1);
  assert.equal(reloaded.taskGraph.delegations[0].toAgentId, "codex-technical");
  assert.ok(reloaded.taskGraph.tasks.some((item) => item.kind === "attempt" && item.assigneeId === "codex-technical"));
  const cancelled = await fx.orchestrator.cancel(run.id);
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.taskGraph.delegations.every((edge) => edge.state === "cancelled"));
  assert.ok(cancelled.taskGraph.tasks.every((task) => ["cancelled", "succeeded", "failed"].includes(task.status)));
});

test("taskGraph binds target attempts and converges attempt and root lifecycle states", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const run = await fx.orchestrator.create({ prompt: "lifecycle graph", execute: false, permissionMode: "plan" });
  run.status = "waiting_agent";
  const phases = ["prepared", "completed", "failed", "ambiguous"];
  for (const [index, phase] of phases.entries()) {
    const busMessageId = `bus-lifecycle-${index}`;
    fx.orchestrator.recordTaskGraphDelegation(run, {
      fromAgentId: "claude-fable",
      toAgentId: "codex-technical",
      busMessageId,
    });
    run.turnAttempts.push({
      attemptId: `attempt-lifecycle-${index}`,
      agentId: "codex-technical",
      phase,
      sourceBusMessageId: busMessageId,
    });
  }
  await fx.orchestrator.save(run);

  const expected = [
    ["running", "running"],
    ["succeeded", "completed"],
    ["failed", "failed"],
    ["recovery_required", "ambiguous"],
  ];
  phases.forEach((_, index) => {
    const busMessageId = `bus-lifecycle-${index}`;
    const task = run.taskGraph.tasks.find((item) => item.busMessageId === busMessageId);
    const edge = run.taskGraph.delegations.find((item) => item.busMessageId === busMessageId);
    assert.deepEqual([task.status, edge.state], expected[index]);
    assert.equal(task.attemptId, `attempt-lifecycle-${index}`);
    assert.equal(edge.targetAttemptId, `attempt-lifecycle-${index}`);
  });

  run.status = "succeeded";
  await fx.orchestrator.save(run);
  assert.equal(run.taskGraph.tasks.find((item) => item.kind === "root").status, "succeeded");
  assert.equal(run.taskGraph.tasks.find((item) => item.busMessageId === "bus-lifecycle-0").status, "skipped");
  assert.equal(run.taskGraph.delegations.find((item) => item.busMessageId === "bus-lifecycle-0").state, "skipped");

  run.status = "failed";
  await fx.orchestrator.save(run);
  assert.equal(run.taskGraph.tasks.find((item) => item.kind === "root").status, "failed");
});

test("social delegation enforces real multi-hop depth before provider dispatch", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const team = {
    id: "team-depth",
    name: "Depth Team",
    coordinator: "claude-fable",
    members: ["claude-fable", "codex-technical", "grok-build"],
    skills: [],
  };
  fx.orchestrator.teams = {
    get(id) {
      if (id !== team.id) throw Object.assign(new Error("team not found"), { code: "SOURCE_NOT_FOUND" });
      return team;
    },
    brief() { return "Depth Team"; },
  };
  const calls = new Map();
  const responseForAgent = {
    "claude-fable": (count) => count === 1 ? "[[msg:codex-technical]] depth one" : "final synthesis",
    "codex-technical": () => "[[msg:grok-build]] depth two",
    "grok-build": () => "[[msg:claude-fable]] depth three must be rejected",
  };
  for (const agentId of team.members) {
    fx.orchestrator.adapters.set(agentId, {
      cwd: fx.root,
      async send(input) {
        const count = (calls.get(agentId) || 0) + 1;
        calls.set(agentId, count);
        await input.onSessionStarted?.({ sessionId: `${agentId}-session`, protocol: `${agentId}-mock` });
        await input.onTurnSubmitting?.({ sessionId: `${agentId}-session`, protocol: `${agentId}-mock`, clientUserMessageId: `${agentId}-message-${count}` });
        await input.onTurnAccepted?.({ sessionId: `${agentId}-session`, protocol: `${agentId}-mock`, clientUserMessageId: `${agentId}-message-${count}`, turnId: `${agentId}-turn-${count}` });
        return { sessionId: `${agentId}-session`, text: responseForAgent[agentId](count), protocol: `${agentId}-mock`, tokens: 10, costUsd: 0.001 };
      },
      async close() {},
    });
  }

  const created = await fx.orchestrator.create({
    prompt: "prove delegation depth",
    execute: true,
    teamId: team.id,
    orchestrationMode: "social",
    delegationDepthLimit: 2,
    maxRounds: 6,
    permissionMode: "plan",
  });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.status, "succeeded");
  assert.deepEqual(completed.taskGraph.delegations.map((edge) => edge.depth), [1, 2, 3]);
  const rejected = completed.taskGraph.delegations.find((edge) => edge.depth === 3);
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.depthLimitReached, true);
  assert.equal(rejected.limit, 2);
  assert.equal(completed.turnAttempts.some((attempt) => attempt.sourceBusMessageId === rejected.busMessageId), false);
  assert.equal(completed.resumeQueue.length, 0);
  assert.ok(completed.taskGraph.tasks.some((task) => task.busMessageId === rejected.busMessageId && task.status === "blocked"));
  const bus = await fx.orchestrator.bus.read(completed.id);
  assert.ok(bus.some((message) => message.kind === "system" && message.text.includes("委派深度上限 2")));
});

test("heterogeneous resume hints stay provider-native", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const run = await fx.orchestrator.create({ prompt: "resume map", execute: false });
  run.sessions = {
    "claude-fable": "claude-sess-1",
    "codex-technical": "codex-sess-1",
  };
  // mock adapter ids so resumeHints can classify
  fx.orchestrator.adapters.get("claude-fable").id = "claude-stream-json";
  fx.orchestrator.adapters.get("codex-technical").id = "codex-exec-json";
  const hints = fx.orchestrator.resumeHintsForRun(run);
  assert.equal(hints.length, 2);
  const claude = hints.find((item) => item.agentId === "claude-fable");
  const codex = hints.find((item) => item.agentId === "codex-technical");
  assert.equal(claude.canResume, true);
  assert.match(claude.command, /claude -r /);
  assert.equal(codex.canResume, true);
  assert.match(codex.command, /codex exec resume /);
  assert.notEqual(claude.command, codex.command);
});

test("dry-run build metadata cannot grant workspace-write through continue", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "build" });
  await fx.orchestrator.continue(created.id, { prompt: "inspect", agentId: "codex-technical" });
  assert.equal(fx.calls.length, 1);
  assert.equal(fx.calls[0].permissionMode, "read-only");
});

test("review permission mode is accepted without approval and stays non-writing", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({
    prompt: "deep review current tree",
    execute: true,
    orchestrationMode: "pipeline",
    maxRounds: 3,
    permissionMode: "review",
  });
  assert.equal(created.permissionMode, "review");
  assert.equal(created.buildApproval, null);
  assert.notEqual(created.status, "waiting_approval");
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.status, "succeeded");
  assert.ok(fx.calls.length >= 1);
  assert.ok(fx.calls.every((call) => call.permissionMode === "read-only"), "Review must reach every Adapter as native read-only");
});

test("an explicit active member owns build even when the router selected another member", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({
    prompt: "coordinator-owned build",
    execute: true,
    orchestrationMode: "pipeline",
    maxRounds: 3,
    permissionMode: "build",
    startAgentId: "claude-fable",
  });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.route.selected.id, "codex-technical");
  assert.equal(completed.startAgentId, "claude-fable");
  assert.equal(completed.executionOwnerId, "claude-fable");
  assert.equal(fx.calls[0].id, "claude-fable");
  assert.equal(fx.calls[0].permissionMode, "workspace-write");
  assert.equal(fx.calls.some((call) => call.id === "codex-technical" && call.permissionMode === "workspace-write"), false);
  const approval = fx.orchestrator.buildApprovalMessage(completed).params;
  assert.equal(approval.executionOwnerId, "claude-fable");
  assert.equal(approval.routeSelectedAgent, "codex-technical");
});

test("unknown permission modes fail closed while omission still defaults to plan", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  await assert.rejects(() => fx.orchestrator.create({
    prompt: "must reject unknown permission",
    execute: false,
    permissionMode: "superuser",
  }), { code: "VALIDATION_FAILED" });
  const created = await fx.orchestrator.create({ prompt: "route only", execute: false });
  assert.equal(created.permissionMode, "plan");
});

test("an approved build grant is not reused by a later manual continuation", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "build" });
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
  const created = await fx.orchestrator.create({ prompt: "implement once", execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "plan" });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.status, "recovery_required");
  assert.equal(fallbackCalls, 0);
  assert.match(completed.error, /transport closed/);
});

test("a confirmed-interrupted read-only timeout auto-continues natively instead of gating", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  let codexCalls = 0;
  const seen = [];
  fx.orchestrator.adapters.get("codex-technical").send = async (input) => {
    codexCalls += 1;
    seen.push({ sessionId: input.sessionId, prompt: input.prompt });
    await input.onSessionStarted?.({ sessionId: "codex-session", protocol: "mock" });
    await input.onTurnSubmitting?.({ sessionId: "codex-session", protocol: "mock", clientUserMessageId: `m-${codexCalls}` });
    await input.onTurnAccepted?.({ sessionId: "codex-session", protocol: "mock", clientUserMessageId: `m-${codexCalls}`, turnId: `t-${codexCalls}` });
    if (codexCalls === 1) {
      throw Object.assign(new Error("Codex turn timed out"), {
        code: "TURN_TIMEOUT",
        safeToFallback: false,
        interruptConfirmed: true,
        sessionId: "codex-session",
        codexPhase: "turn-submitted-or-unknown",
      });
    }
    return { sessionId: "codex-session", text: "recovered-final", protocol: "mock", tokens: 5, costUsd: 0.01 };
  };
  const created = await fx.orchestrator.create({ prompt: "deep investigation", execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "plan" });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.status, "succeeded");
  assert.equal(codexCalls, 2, "失败轮自动原生续跑一次，不进人工闸");
  assert.equal(seen[1].sessionId, "codex-session", "续跑必须回到同一个原生会话");
  assert.match(seen[1].prompt, /自动恢复/, "续跑用续接指令而不是原 prompt 盲重放");
  assert.equal(completed.autoRecoveries, 1);
  const codexAttempts = completed.turnAttempts.filter((attempt) => attempt.agentId === "codex-technical");
  assert.deepEqual(codexAttempts.map((attempt) => attempt.phase), ["failed", "completed"]);
  assert.equal(codexAttempts[1].round, codexAttempts[0].round + 1, "自动续跑必须消耗一个新的持久化 round");
  assert.equal(completed.result.specialist, "recovered-final");
  assert.equal(completed.result.truncated, true, "恢复用尽轮次后必须如实标记独立复核未执行");
  assert.equal(completed.result.critique, null);
  assert.ok(fx.events.some((event) => event.type === "run.auto_recovery" && event.data.count === 1));
  assert.ok(!fx.events.some((event) => event.type === "adapter.replay_blocked"), "自动续跑成功时不产生阻断事件");
});

test("an unconfirmed-interrupt timeout keeps the strict manual recovery gate", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  let codexCalls = 0;
  fx.orchestrator.adapters.get("codex-technical").send = async () => {
    codexCalls += 1;
    throw Object.assign(new Error("Codex turn timed out"), {
      code: "TURN_TIMEOUT",
      safeToFallback: false,
      interruptConfirmed: false,
      sessionId: "codex-session",
      codexPhase: "turn-submitted-or-unknown",
    });
  };
  const created = await fx.orchestrator.create({ prompt: "investigate", execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "plan" });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.status, "recovery_required");
  assert.equal(codexCalls, 1, "打断未确认 = 原生轮可能仍活着，绝不自动续跑");
  assert.equal(completed.autoRecoveries ?? 0, 0);
  assert.match(completed.recoveryNote, /may still own a native turn/, "未确认时保持严格文案");
  const blocked = fx.events.find((event) => event.type === "adapter.replay_blocked");
  assert.ok(blocked);
  assert.equal(blocked.data.interruptConfirmed, false);
  assert.ok(!fx.events.some((event) => event.type === "run.auto_recovery"));
});

test("a failed auto-continuation falls back to the graded manual gate", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  let codexCalls = 0;
  fx.orchestrator.adapters.get("codex-technical").send = async () => {
    codexCalls += 1;
    throw Object.assign(new Error("Codex turn timed out"), {
      code: "TURN_TIMEOUT",
      safeToFallback: false,
      interruptConfirmed: true,
      sessionId: "codex-session",
      codexPhase: "turn-submitted-or-unknown",
    });
  };
  const created = await fx.orchestrator.create({ prompt: "investigate twice", execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "plan" });
  const completed = await waitTerminal(fx.orchestrator, created.id);
  assert.equal(completed.status, "recovery_required");
  assert.equal(codexCalls, 2, "一次失败最多自动续跑一次：续跑失败直接交人工，不递归白烧");
  assert.equal(completed.autoRecoveries, 1);
  const failedAttempts = completed.turnAttempts.filter((attempt) => attempt.agentId === "codex-technical");
  assert.deepEqual(failedAttempts.map((attempt) => attempt.round), [2, 3], "两次可能触达 provider 的派发必须占用两个不同 round");
  assert.match(completed.recoveryNote, /confirmed interrupted/, "已确认打断的文案如实降级，不再谎称可能有活跃占用");
  assert.equal(fx.events.filter((event) => event.type === "run.auto_recovery").length, 1);
  assert.equal(fx.events.filter((event) => event.type === "adapter.replay_blocked").length, 1);
});

test("autoRecoveryDecision gates on timeout family, confirmation, mode, session and cap", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const orchestrator = fx.orchestrator;
  const run = { sessions: { "codex-technical": "thread-1" }, autoRecoveries: 0 };
  const confirmedTimeout = Object.assign(new Error("timeout"), { code: "TURN_TIMEOUT", interruptConfirmed: true, sessionId: "thread-1" });
  assert.equal(orchestrator.autoRecoveryDecision(run, "codex-technical", confirmedTimeout, "read-only").ok, true);
  assert.equal(orchestrator.autoRecoveryDecision(run, "codex-technical", confirmedTimeout, "plan").ok, true);
  assert.equal(
    orchestrator.autoRecoveryDecision(run, "codex-technical", Object.assign(new Error("limit"), { code: "OUTPUT_LIMIT", interruptConfirmed: true }), "read-only").reason,
    "not-a-timeout",
  );
  assert.equal(
    orchestrator.autoRecoveryDecision(run, "codex-technical", Object.assign(new Error("timeout"), { code: "TURN_IDLE_TIMEOUT", interruptConfirmed: false }), "read-only").reason,
    "interrupt-unconfirmed",
  );
  assert.equal(orchestrator.autoRecoveryDecision(run, "codex-technical", confirmedTimeout, "workspace-write").reason, "write-turn");
  assert.equal(
    orchestrator.autoRecoveryDecision({ sessions: {}, autoRecoveries: 0 }, "codex-technical", Object.assign(new Error("timeout"), { code: "TURN_TIMEOUT", interruptConfirmed: true }), "read-only").reason,
    "no-native-session",
  );
  assert.equal(orchestrator.autoRecoveryDecision({ ...run, autoRecoveries: 2 }, "codex-technical", confirmedTimeout, "read-only").reason, "cap-exhausted");
  assert.equal(
    orchestrator.autoRecoveryDecision({ ...run, round: 3, maxRounds: 3 }, "codex-technical", confirmedTimeout, "read-only").reason,
    "round-limit",
  );
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
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "plan" });
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
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "plan" });
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
  // 拓扑：plan(fable) -> specialist(codex) -> critique(fable)；未显式指定成员的
  // legacy continue 仍绑定持久化 execution owner，不得偷偷回退到 coordinator。
  assert.equal(fx.calls.length, 4);
  assert.match(fx.calls[0].prompt, /规划阶段/);
  assert.equal(created.executionOwnerId, "codex-technical");
  assert.equal(fx.calls[1].id, created.executionOwnerId);
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
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "plan" });
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

test("init rejects when the run directory cannot be enumerated instead of presenting an empty store", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-orchestrator-init-readdir-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  let readdirCalls = 0;
  const orchestrator = new Orchestrator({
    router: { preview: async () => route() },
    adapters: new Map(),
    eventStore: { emit: async () => {} },
    dataRoot: root,
    policy: policy(),
    approvalBroker: { request: async () => ({ decision: "accept" }), denyRun() {} },
    storage: {
      async readdir() {
        readdirCalls += 1;
        throw Object.assign(new Error("run directory unavailable"), { code: "EIO" });
      },
    },
  });

  await assert.rejects(() => orchestrator.init(), { code: "RUN_STORE_UNAVAILABLE" });
  assert.equal(readdirCalls, 1, "init 必须实际枚举 run store，不能静默降级为空列表");
  await orchestrator.close();
});

test("init rejects visibly when an enumerated valid run cannot be read", async (t) => {
  const fx = await fixture();
  const root = fx.root;
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "persisted valid run", execute: false, permissionMode: "plan" });
  const runPath = join(root, "runs", `${created.id}.json`);
  await fx.orchestrator.close();

  for (const ioCode of ["EACCES", "EIO"]) {
    let attemptedPath = null;
    const reloaded = new Orchestrator({
      router: { preview: async () => route() },
      adapters: new Map(),
      eventStore: { emit: async () => {} },
      dataRoot: root,
      policy: policy(),
      approvalBroker: { request: async () => ({ decision: "accept" }), denyRun() {} },
      storage: {
        async readFile(path) {
          attemptedPath = path;
          throw Object.assign(new Error(`cannot read persisted run: ${ioCode}`), { code: ioCode });
        },
      },
    });

    await assert.rejects(() => reloaded.init(), { code: "RUN_STORE_READ_FAILED" }, `${ioCode} 不能被伪装成缺失 run/404`);
    assert.equal(resolve(attemptedPath), resolve(runPath), `${ioCode} 来自已枚举的有效 run 文件`);
    await reloaded.close();
  }
});

test("init may leave malformed JSON on disk while still loading valid runs", async (t) => {
  const fx = await fixture();
  const root = fx.root;
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "valid persisted run", execute: false, permissionMode: "plan" });
  const malformedPath = join(root, "runs", "malformed.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(malformedPath, "{ definitely-not-json", "utf8");
  await fx.orchestrator.close();

  const reloaded = await new Orchestrator({
    router: { preview: async () => route() },
    adapters: new Map(),
    eventStore: { emit: async () => {} },
    dataRoot: root,
    policy: policy(),
    approvalBroker: { request: async () => ({ decision: "accept" }), denyRun() {} },
  }).init();
  assert.equal(reloaded.get(created.id).id, created.id, "语法损坏不能阻止其他有效 run 恢复可见性");
  assert.equal(await readFile(malformedPath, "utf8"), "{ definitely-not-json", "损坏文件原样留盘待查");
  await reloaded.close();
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

test("direct continuation registers its execution key before admission save and close waits for settlement", async (t) => {
  const fx = await fixture();
  const diskPredecessor = deferred();
  const admissionEntered = deferred();
  const admissionPersisted = deferred();
  const releaseAdmission = deferred();
  let continuing;
  let closing;
  const originalSave = fx.orchestrator.save.bind(fx.orchestrator);
  t.after(async () => {
    diskPredecessor.resolve();
    releaseAdmission.resolve();
    await Promise.allSettled([continuing, closing].filter(Boolean));
    fx.orchestrator.save = originalSave;
    await fx.orchestrator.close();
    await rm(fx.root, { recursive: true, force: true });
  });

  const created = await fx.orchestrator.create({ prompt: "route only", execute: false, permissionMode: "plan" });
  const runPath = join(fx.root, "runs", `${created.id}.json`);
  const continuationPrompt = "continue during shutdown admission";
  let gateAdmissionSave = true;
  fx.orchestrator.saveChains.set(created.id, diskPredecessor.promise);
  fx.orchestrator.save = async (candidate) => {
    if (gateAdmissionSave && candidate.id === created.id && candidate.status === "running") {
      gateAdmissionSave = false;
      admissionEntered.resolve();
      const saved = await originalSave(candidate);
      admissionPersisted.resolve();
      await releaseAdmission.promise;
      return saved;
    }
    return originalSave(candidate);
  };

  continuing = fx.orchestrator.continue(created.id, {
    prompt: continuationPrompt,
    agentId: "claude-fable",
  });
  await admissionEntered.promise;
  assert.ok(fx.orchestrator.transitionChains.has(created.id), "admission 仍在 per-run transition 内");
  assert.ok(fx.orchestrator.controllers.has(created.id), "controller 已占位，close 必须赢得取消所有权");
  const executionKey = `continue:${created.id}`;
  assert.ok(fx.orchestrator.executions.has(executionKey), "execution 必须在 admission 首个 await 前可见，从机械上删除注册窗口");

  let closeSettled = false;
  closing = fx.orchestrator.close().then(() => { closeSettled = true; });
  diskPredecessor.resolve();
  await admissionPersisted.promise;
  await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
  const closeReturnedBeforeAdmissionSettled = closeSettled;

  releaseAdmission.resolve();
  await Promise.allSettled([continuing, closing]);
  fx.orchestrator.save = originalSave;
  const memory = fx.orchestrator.get(created.id);
  const persisted = JSON.parse(await readFile(runPath, "utf8"));
  const userMessages = fx.events.filter((event) => event.type === "user.message" && event.data.text === continuationPrompt);
  assert.deepEqual({
    closeReturnedBeforeAdmissionSettled,
    memoryStatus: memory.status,
    diskStatus: persisted.status,
    memoryRecoveryNote: memory.recoveryNote,
    diskRecoveryNote: persisted.recoveryNote,
    userMessageCount: userMessages.length,
    providerDispatches: fx.calls.length,
  }, {
    closeReturnedBeforeAdmissionSettled: false,
    memoryStatus: "cancelled",
    diskStatus: "cancelled",
    memoryRecoveryNote: "Control plane shutdown cancelled this continuation before prompt was projected.",
    diskRecoveryNote: "Control plane shutdown cancelled this continuation before prompt was projected.",
    userMessageCount: 0,
    providerDispatches: 0,
  }, "close 必须线性化 admission：等待、取消落盘，并明示 prompt 尚未投影");
});

test("direct social continuation keeps its durable prompt fact when close aborts the projection postcheck", async (t) => {
  const fx = await fixture();
  const projectionEntered = deferred();
  const releaseProjection = deferred();
  const controllerAborted = deferred();
  let continuing;
  let closing;
  const originalEmit = fx.orchestrator.eventStore.emit.bind(fx.orchestrator.eventStore);
  t.after(async () => {
    releaseProjection.resolve();
    await Promise.allSettled([continuing, closing].filter(Boolean));
    fx.orchestrator.eventStore.emit = originalEmit;
    await fx.orchestrator.close();
    await rm(fx.root, { recursive: true, force: true });
  });

  const created = await fx.orchestrator.create({
    prompt: "route only",
    execute: false,
    permissionMode: "plan",
    orchestrationMode: "social",
  });
  const continuationPrompt = "durable social prompt at shutdown boundary";
  let gateProjection = true;
  fx.orchestrator.eventStore.emit = async (type, data, context) => {
    const result = await originalEmit(type, data, context);
    if (gateProjection && type === "user.message" && data.text === continuationPrompt) {
      gateProjection = false;
      projectionEntered.resolve();
      await releaseProjection.promise;
    }
    return result;
  };

  continuing = fx.orchestrator.continue(created.id, {
    prompt: continuationPrompt,
    agentId: "claude-fable",
  });
  await projectionEntered.promise;
  const durableBoundary = await fx.orchestrator.bus.read(created.id);
  assert.equal(durableBoundary.length, 1, "projection postcheck 前 durable bus 中恰有一条消息");
  assert.deepEqual({
    kind: durableBoundary[0].kind,
    from: durableBoundary[0].from,
    to: durableBoundary[0].to,
    text: durableBoundary[0].text,
    directContinuation: durableBoundary[0].refs?.directContinuation,
  }, {
    kind: "steer",
    from: "lo",
    to: "claude-fable",
    text: continuationPrompt,
    directContinuation: true,
  });
  assert.equal(fx.calls.length, 0, "provider 尚未派发");

  const controller = fx.orchestrator.controllers.get(created.id);
  assert.ok(controller, "direct continuation controller 在 projection 边界仍持有所有权");
  controller.signal.addEventListener("abort", () => controllerAborted.resolve(), { once: true });
  let closeSettled = false;
  closing = fx.orchestrator.close().then(() => { closeSettled = true; });
  await controllerAborted.promise;
  assert.equal(closeSettled, false, "close 必须等待 projection postcheck 与取消状态落盘");

  releaseProjection.resolve();
  await Promise.all([continuing, closing]);
  fx.orchestrator.eventStore.emit = originalEmit;
  const memory = fx.orchestrator.get(created.id);
  const persisted = JSON.parse(await readFile(join(fx.root, "runs", `${created.id}.json`), "utf8"));
  const messages = await fx.orchestrator.bus.read(created.id);
  assert.deepEqual({
    memoryStatus: memory.status,
    diskStatus: persisted.status,
    memoryRecoveryNote: memory.recoveryNote,
    diskRecoveryNote: persisted.recoveryNote,
    busMessages: messages.length,
    providerDispatches: fx.calls.length,
  }, {
    memoryStatus: "cancelled",
    diskStatus: "cancelled",
    memoryRecoveryNote: "Control plane shutdown cancelled this continuation after the prompt was recorded but before provider completion.",
    diskRecoveryNote: "Control plane shutdown cancelled this continuation after the prompt was recorded but before provider completion.",
    busMessages: 1,
    providerDispatches: 0,
  }, "durable prompt 不能被 shutdown recoveryNote 谎报为尚未投影");
});

test("close installs its latch before abort listeners can synchronously reenter shutdown", async (t) => {
  const fx = await fixture();
  const projectionEntered = deferred();
  const releaseProjection = deferred();
  const abortReentered = deferred();
  const adapterCloseEntered = deferred();
  const releaseAdapterClose = deferred();
  let continuing;
  let outerCompletion;
  let reentrantCompletion;
  const originalEmit = fx.orchestrator.eventStore.emit.bind(fx.orchestrator.eventStore);
  const adapter = fx.orchestrator.adapters.get("claude-fable");
  const originalAdapterClose = adapter.close.bind(adapter);
  t.after(async () => {
    releaseProjection.resolve();
    releaseAdapterClose.resolve();
    await Promise.allSettled([continuing, outerCompletion, reentrantCompletion].filter(Boolean));
    fx.orchestrator.eventStore.emit = originalEmit;
    adapter.close = originalAdapterClose;
    await fx.orchestrator.close();
    await rm(fx.root, { recursive: true, force: true });
  });

  const created = await fx.orchestrator.create({
    prompt: "route only",
    execute: false,
    permissionMode: "plan",
    orchestrationMode: "social",
  });
  const continuationPrompt = "reentrant shutdown latch";
  let gateProjection = true;
  fx.orchestrator.eventStore.emit = async (type, data, context) => {
    const result = await originalEmit(type, data, context);
    if (gateProjection && type === "user.message" && data.text === continuationPrompt) {
      gateProjection = false;
      projectionEntered.resolve();
      await releaseProjection.promise;
    }
    return result;
  };
  let adapterCloseCalls = 0;
  adapter.close = async () => {
    adapterCloseCalls += 1;
    adapterCloseEntered.resolve();
    await releaseAdapterClose.promise;
  };
  // 关闭面只留一个唯一 adapter，让“一次 close”成为精确可判定契约。
  fx.orchestrator.adapters = new Map([["claude-fable", adapter]]);

  continuing = fx.orchestrator.continue(created.id, {
    prompt: continuationPrompt,
    agentId: "claude-fable",
  });
  await projectionEntered.promise;
  const controller = fx.orchestrator.controllers.get(created.id);
  assert.ok(controller, "abort reentry test requires an owned continuation controller");

  let latchInstalledBeforeAbort = false;
  let outerSettled = false;
  let reentrantSettled = false;
  controller.signal.addEventListener("abort", () => {
    latchInstalledBeforeAbort = Boolean(fx.orchestrator.closePromise);
    reentrantCompletion = Promise.resolve(fx.orchestrator.close()).then(() => { reentrantSettled = true; });
    abortReentered.resolve();
  }, { once: true });

  outerCompletion = Promise.resolve(fx.orchestrator.close()).then(() => { outerSettled = true; });
  await abortReentered.promise;
  assert.equal(latchInstalledBeforeAbort, true, "close latch 必须先安装，再同步 abort controller");
  assert.deepEqual({ outerSettled, reentrantSettled, adapterCloseCalls }, {
    outerSettled: false,
    reentrantSettled: false,
    adapterCloseCalls: 0,
  }, "abort listener 重入的 close 不能提前完成");

  releaseProjection.resolve();
  await adapterCloseEntered.promise;
  assert.deepEqual({ outerSettled, reentrantSettled, adapterCloseCalls }, {
    outerSettled: false,
    reentrantSettled: false,
    adapterCloseCalls: 1,
  }, "两个 close 调用都必须等待同一个 adapter 收口，且 adapter 只关闭一次");

  releaseAdapterClose.resolve();
  await Promise.all([continuing, outerCompletion, reentrantCompletion]);
  assert.deepEqual({ outerSettled, reentrantSettled, adapterCloseCalls }, {
    outerSettled: true,
    reentrantSettled: true,
    adapterCloseCalls: 1,
  }, "共享收口释放后两个 close 调用才一起完成");
});

test("close waits for an untracked resumePendingAsk bus projection to settle", async (t) => {
  const fx = await fixture();
  const appendEntered = deferred();
  const releaseAppend = deferred();
  const appendSettled = deferred();
  let resuming;
  let closing;
  const originalAppend = fx.orchestrator.bus.append.bind(fx.orchestrator.bus);
  t.after(async () => {
    releaseAppend.resolve();
    await Promise.allSettled([resuming, closing].filter(Boolean));
    fx.orchestrator.bus.append = originalAppend;
    await fx.orchestrator.close();
    await rm(fx.root, { recursive: true, force: true });
  });

  const created = await fx.orchestrator.create({
    prompt: "answer projection close boundary",
    execute: false,
    permissionMode: "plan",
    orchestrationMode: "social",
  });
  const run = fx.orchestrator.get(created.id);
  run.status = "waiting_agent";
  const ask = await fx.orchestrator.appendBus(run, {
    from: "claude-fable",
    to: "lo",
    kind: "ask",
    text: "continue?",
  });
  run.pendingAsk = { id: ask.id, from: ask.from, text: ask.text, at: ask.ts };
  run.pausedForInput = true;
  await fx.orchestrator.save(run);

  let gateAnswerAppend = true;
  fx.orchestrator.bus.append = async (...args) => {
    const message = args[1];
    if (gateAnswerAppend && message?.kind === "answer") {
      gateAnswerAppend = false;
      appendEntered.resolve();
      await releaseAppend.promise;
      try {
        return await originalAppend(...args);
      } finally {
        appendSettled.resolve();
      }
    }
    return originalAppend(...args);
  };

  resuming = fx.orchestrator.resumePendingAsk(created.id, "continue", { answerToAskId: ask.id });
  await appendEntered.promise;
  assert.ok(fx.orchestrator.projectionChains.has(created.id), "answer append 已在 projection chain 内");
  assert.ok(
    !fx.orchestrator.executions.has(created.id) && !fx.orchestrator.executions.has(`continue:${created.id}`),
    "resumePendingAsk projection 不依赖 executions 可见性",
  );

  let closeSettled = false;
  closing = fx.orchestrator.close().then(() => { closeSettled = true; });
  await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
  const closeReturnedBeforeAppendSettled = closeSettled;

  releaseAppend.resolve();
  await Promise.allSettled([resuming, closing]);
  await appendSettled.promise;
  fx.orchestrator.bus.append = originalAppend;
  const busMessages = await fx.orchestrator.bus.read(created.id);
  assert.equal(closeReturnedBeforeAppendSettled, false, "close 不得漏等未纳入 executions 的回答投影");
  assert.equal(
    busMessages.filter((message) => message.kind === "answer" && message.refs?.answerToAskId === ask.id).length,
    1,
    "close 返回前 durable answer append 已精确收口且不重复",
  );
});

test("init keeps a run visible in recovery_required when restart restatement cannot be persisted", async (t) => {
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
    // 模拟基类真实失败序：同步段已 runs.set，之后 writeFile/rename 才抛。
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
  const visible = second.get(created.id);
  assert.equal(visible.status, "recovery_required", "控制面保留可见性并阻止自动调度");
  assert.equal(visible.persistenceDegraded, true);
  assert.equal(visible.recoveryIssue?.code, "RESTART_PERSISTENCE_FAILED");
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

test("cancel returns multi-CLI cascade visibility for team members and sessions", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({
    prompt: "long collaboration",
    execute: true,
    orchestrationMode: "pipeline",
    maxRounds: 3,
    permissionMode: "plan",
  });
  // let first turns start
  await new Promise((resolveTick) => setTimeout(resolveTick, 30));
  const cancelled = await fx.orchestrator.cancel(created.id);
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cancelCascade);
  assert.equal(cancelled.cancelCascade.scope, "self|descendants|provider-tree");
  assert.ok(Array.isArray(cancelled.cancelCascade.agents));
  assert.ok(cancelled.cancelCascade.agents.includes("claude-fable") || cancelled.cancelCascade.agents.length >= 1);
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
  const created = await fx.orchestrator.create({ prompt: "implement", execute: true, orchestrationMode: "pipeline", maxRounds: 3, permissionMode: "plan" });
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

test("session effort override validates the CLI whitelist and reaches the execution owner turn", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  await assert.rejects(
    () => fx.orchestrator.create({ prompt: "x", execute: false, permissionMode: "plan", effort: "ultra;rm" }),
    { code: "INVALID_EFFORT" },
  );
  const created = await fx.orchestrator.create({ prompt: "x", execute: false, permissionMode: "plan", effort: "XHigh" });
  assert.equal(created.effortOverride, "xhigh", "大小写归一后固化");
  await fx.orchestrator.continue(created.id, { prompt: "go", agentId: "codex-technical" });
  assert.equal(fx.calls.at(-1).effort, "xhigh", "执行所有者轮携带 /effort 覆盖到 adapter");
  const plain = await fx.orchestrator.create({ prompt: "y", execute: false, permissionMode: "plan" });
  assert.equal(plain.effortOverride, null, "未选择时不传（CLI 用自身默认档）");
  await assert.rejects(
    () => fx.orchestrator.create({ prompt: "z", execute: false, permissionMode: "plan", effort: "ultracode" }),
    { code: "INVALID_EFFORT" },
    "ultracode 是 514cc 工作流，不是 Claude CLI effort",
  );
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

test("logical team members sharing one runtime profile keep isolated sessions and member defaults", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-orchestrator-members-"));
  const memberRecords = new Map([
    ["member-alpha", {
      id: "member-alpha",
      runtimeProfileId: "codex-technical",
      label: "Alpha",
      role: "implementation lead",
      description: "Owns the primary implementation pass.",
      systemPrompt: "ALPHA_PERSONA: preserve implementation evidence.",
      capabilities: ["coding", "review"],
      defaultModel: "gpt-alpha-default",
      defaultEffort: "high",
      teamMemberEligible: true,
      coordinatorEligible: true,
    }],
    ["member-beta", {
      id: "member-beta",
      runtimeProfileId: "codex-technical",
      label: "Beta",
      role: "independent verifier",
      description: "Challenges the first member with an isolated identity.",
      personaPrompt: "BETA_PERSONA: challenge unsupported completion claims.",
      capabilities: ["review"],
      defaultModel: "gpt-beta-default",
      defaultEffort: "xhigh",
      teamMemberEligible: true,
      coordinatorEligible: true,
    }],
  ]);
  const team = {
    id: "team-custom-codex-pair",
    name: "Custom Codex Pair",
    coordinator: "member-alpha",
    members: ["member-alpha", "member-beta"],
    skills: [],
  };
  const rosterSnapshots = [];
  const teamMembers = {
    snapshot(ids) {
      rosterSnapshots.push([...ids]);
      return ids.map((id) => memberRecords.get(id));
    },
    get(id) {
      const member = memberRecords.get(id);
      if (!member) throw Object.assign(new Error("member not found"), { code: "SOURCE_NOT_FOUND" });
      return member;
    },
  };
  const routeInputs = [];
  const discoveryProfiles = [];
  const calls = [];
  const adapter = {
    id: "codex-app-server",
    cwd: root,
    async send(input) {
      calls.push({ ...input });
      const sessionId = input.sessionId || `session-${input.agentId}`;
      await input.onSessionStarted?.({ sessionId, protocol: "codex-app-server" });
      await input.onTurnSubmitting?.({ sessionId, protocol: "codex-app-server", clientUserMessageId: `message-${input.agentId}` });
      await input.onTurnAccepted?.({ sessionId, protocol: "codex-app-server", clientUserMessageId: `message-${input.agentId}`, turnId: `turn-${input.agentId}` });
      return { sessionId, text: `${input.agentId} completed`, protocol: "codex-app-server", tokens: 100, costUsd: 0.01 };
    },
    async close() {},
  };
  const orchestrator = await new Orchestrator({
    router: {
      async preview(input) {
        routeInputs.push(input);
        return {
          taskType: "coding",
          risk: "medium",
          selected: { id: "codex-technical", label: "Codex runtime" },
          independent: { id: "codex-technical", label: "Codex runtime" },
          independentRequired: false,
          reason: "shared runtime test route",
        };
      },
    },
    adapters: new Map([["codex-technical", adapter]]),
    eventStore: { emit: async () => {} },
    dataRoot: root,
    policy: policy(),
    approvalBroker: { request: async () => ({ decision: "accept" }), denyRun() {} },
    teams: {
      get(id) {
        if (id !== team.id) throw Object.assign(new Error("team not found"), { code: "SOURCE_NOT_FOUND" });
        return team;
      },
      brief() { return "[团队配置] Custom Codex Pair"; },
    },
    teamMembers,
    modelDiscovery: {
      async forAgent(runtimeProfileId) {
        discoveryProfiles.push(runtimeProfileId);
        return {
          models: [{ id: "gpt-explicit" }],
          effortLevels: ["max"],
        };
      },
    },
    capabilities: { agentDisabledSkills: async () => new Set() },
  }).init();
  t.after(async () => { await orchestrator.close(); await rm(root, { recursive: true, force: true }); });

  const originalSnapshot = teamMembers.snapshot;
  const originalGet = teamMembers.get;
  teamMembers.snapshot = () => [];
  teamMembers.get = () => undefined;
  await assert.rejects(
    () => orchestrator.snapshotTeamRoster(["missing-member"]),
    { code: "TEAM_MEMBER_SNAPSHOT_INVALID" },
    "缺失成员记录不能退化成同名 runtime identity",
  );
  teamMembers.snapshot = originalSnapshot;
  teamMembers.get = originalGet;

  const singleMemberRoster = [memberRecords.get("member-alpha")];
  const optionalSingleMemberRoute = orchestrator.mapRuntimeRoute({
    selected: { id: "codex-technical" },
    independent: { id: "codex-technical" },
    independentRequired: false,
  }, singleMemberRoster, ["member-alpha"]);
  assert.equal(optionalSingleMemberRoute.independent, null, "可选复核没有第二逻辑席时不伪装独立成员");
  assert.throws(
    () => orchestrator.mapRuntimeRoute({
      selected: { id: "codex-technical" },
      independent: { id: "codex-technical" },
      independentRequired: true,
    }, singleMemberRoster, ["member-alpha"]),
    { code: "NO_INDEPENDENT_ROUTE" },
    "强制独立复核必须映射到不同逻辑成员",
  );

  const preview = await orchestrator.create({
    prompt: "validate explicit runtime catalog",
    execute: false,
    permissionMode: "plan",
    teamId: team.id,
    startAgentId: "member-beta",
    model: "gpt-explicit",
    effort: "max",
  });
  assert.deepEqual(discoveryProfiles, ["codex-technical", "codex-technical"], "模型与 effort 目录按 runtime profile 查询");
  assert.equal(preview.startAgentId, "member-beta");

  const created = await orchestrator.create({
    prompt: "run both logical members",
    execute: true,
    permissionMode: "plan",
    teamId: team.id,
    requestedAgentIds: ["member-alpha", "member-beta"],
    maxRounds: 3,
  });
  const completed = await waitTerminal(orchestrator, created.id);
  assert.equal(completed.status, "succeeded");
  assert.deepEqual(routeInputs.at(-1).allowedProviders, ["codex-technical"], "路由器只接收 runtime profile 白名单");
  assert.deepEqual(completed.teamMembers, ["member-alpha", "member-beta"]);
  assert.equal(completed.route.selected.id, "member-alpha");
  assert.equal(completed.route.selected.runtimeProfileId, "codex-technical");
  assert.equal(completed.route.independent.id, "member-beta", "相同 runtime 的独立席位仍映射到另一个逻辑成员");
  assert.equal(completed.route.independent.runtimeProfileId, "codex-technical");
  const approvalMessage = orchestrator.buildApprovalMessage(completed);
  assert.equal(approvalMessage.params.selectedAgent, "member-alpha");
  assert.equal(approvalMessage.params.selectedRuntimeProfileId, "codex-technical");
  assert.equal(approvalMessage.params.model, "gpt-alpha-default");
  assert.equal(approvalMessage.params.effort, "high");
  assert.deepEqual(completed.sessions, {
    "member-alpha": "session-member-alpha",
    "member-beta": "session-member-beta",
  }, "同一 adapter 上的原生会话按逻辑成员隔离");
  assert.ok(completed.turns.every((turn) => ["member-alpha", "member-beta"].includes(turn.agentId)));

  const alphaCall = calls.find((call) => call.agentId === "member-alpha");
  const betaCall = calls.find((call) => call.agentId === "member-beta");
  assert.ok(alphaCall && betaCall);
  assert.equal(alphaCall.model, "gpt-alpha-default");
  assert.equal(alphaCall.effort, "high");
  assert.match(alphaCall.prompt, /memberId: member-alpha/);
  assert.match(alphaCall.prompt, /ALPHA_PERSONA: preserve implementation evidence/);
  assert.equal(betaCall.model, "gpt-beta-default");
  assert.equal(betaCall.effort, "xhigh");
  assert.match(betaCall.prompt, /memberId: member-beta/);
  assert.match(betaCall.prompt, /BETA_PERSONA: challenge unsupported completion claims/);
  assert.ok(calls.every((call) => call.sessionId == null || call.sessionId === `session-${call.agentId}`));

  const persisted = JSON.parse(await readFile(join(root, "runs", `${completed.id}.json`), "utf8"));
  assert.equal(persisted.teamRosterVersion, 1);
  assert.ok(persisted.teamRoster.every((member) => member.teamMemberEligible === true));
  assert.deepEqual(persisted.teamRoster.map(({ id, runtimeProfileId }) => ({ id, runtimeProfileId })), [
    { id: "member-alpha", runtimeProfileId: "codex-technical" },
    { id: "member-beta", runtimeProfileId: "codex-technical" },
  ]);
  assert.ok(rosterSnapshots.some((ids) => ids.join(",") === team.members.join(",")));
  const hints = orchestrator.resumeHintsForRun(completed);
  assert.deepEqual(hints.map(({ agentId, runtimeProfileId }) => ({ agentId, runtimeProfileId })), [
    { agentId: "member-alpha", runtimeProfileId: "codex-technical" },
    { agentId: "member-beta", runtimeProfileId: "codex-technical" },
  ]);
  assert.ok(hints.every((hint) => hint.canResume && hint.command.startsWith("codex exec resume ")));

  const continued = await orchestrator.continue(completed.id, {
    agentId: "member-beta",
    prompt: "continue the verifier session",
  });
  assert.equal(continued.status, "succeeded");
  const continuationCall = calls.at(-1);
  assert.equal(continuationCall.agentId, "member-beta");
  assert.equal(continuationCall.sessionId, "session-member-beta", "续聊沿逻辑成员取回隔离 session");

  orchestrator.adapters.delete("codex-technical");
  await assert.rejects(
    () => orchestrator.continue(completed.id, {
      agentId: "member-alpha",
      prompt: "must fail when the bound runtime disappears",
    }),
    { code: "ADAPTER_UNAVAILABLE" },
    "continue 的可用性检查必须解析到 runtime profile",
  );

  const primaryFallbackAttempts = [];
  const fallbackCalls = [];
  orchestrator.adapters.set("codex-technical", {
    id: "codex-app-server",
    cwd: root,
    async send(input) {
      primaryFallbackAttempts.push({ ...input });
      throw Object.assign(new Error("pre-submit app-server exit"), {
        code: "APP_SERVER_EXIT",
        safeToFallback: true,
      });
    },
    async close() {},
  });
  orchestrator.adapters.set("codex-technical-fallback", {
    id: "codex-cli",
    cwd: root,
    async send(input) {
      fallbackCalls.push({ ...input });
      return {
        sessionId: `fallback-${input.agentId}`,
        text: `${input.agentId} fallback completed`,
        protocol: "codex-exec-json",
      };
    },
    async close() {},
  });
  const fallbackResult = await orchestrator.continue(completed.id, {
    agentId: "member-alpha",
    prompt: "exercise the runtime fallback boundary",
  });
  assert.equal(fallbackResult.status, "succeeded");
  assert.equal(primaryFallbackAttempts.length, 1);
  assert.equal(primaryFallbackAttempts[0].agentId, "member-alpha");
  assert.equal(fallbackCalls.length, 1);
  assert.equal(fallbackCalls[0].agentId, "member-alpha", "fallback 仍接收逻辑成员身份");
  assert.equal(fallbackResult.sessions["member-alpha"], "fallback-member-alpha");
  assert.equal(fallbackResult.turns.at(-1).agentId, "member-alpha");

  const damagedRoster = { ...fallbackResult, teamRoster: null, teamRosterVersion: 1 };
  assert.throws(
    () => orchestrator.resumeHintsForRun(damagedRoster),
    { code: "TEAM_MEMBER_SNAPSHOT_INVALID" },
    "带版本的新 run 缺失 roster 时必须 fail-closed，不能走 legacy identity",
  );
  const missingRuntimeBinding = {
    ...fallbackResult,
    teamRoster: fallbackResult.teamRoster.map(({ runtimeProfileId, ...member }) => member),
    teamRosterVersion: 1,
  };
  assert.throws(
    () => orchestrator.resumeHintsForRun(missingRuntimeBinding),
    { code: "TEAM_MEMBER_SNAPSHOT_INVALID" },
    "v1 roster 必须显式持久化 runtimeProfileId",
  );
});

// LO 2026-08-08：Codex 余额不足 403 → 轮次判定 ambiguous、run 进入 recovery_required，
// 但 inflightTurns 仍挂着该成员。UI 据此显示"正在准备会话"，新消息被当成排队——
// 充值后既发不出去也恢复不了。inflight 是记账而非并发守卫，放弃该轮时必须一并作废。
test("acknowledging recovery clears the inflight turn bookkeeping so the run can continue", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const run = fx.orchestrator.get(created.id);
  run.status = "recovery_required";
  run.error = 'unexpected status 403 Forbidden: {"code":"INSUFFICIENT_BALANCE"}';
  run.inflightTurns = { "codex-technical": "attempt-ambiguous" };
  run.resumeClaim = { itemId: "item-1" };

  await fx.orchestrator.continue(created.id, { prompt: "余额已充值，继续", acknowledgeRecovery: true });

  const after = fx.orchestrator.get(created.id);
  assert.deepEqual(after.inflightTurns, {}, "确认恢复后 inflight 记账必须清空，否则成员永远显示在跑");
  assert.equal(after.resumeClaim, null);
  assert.ok(after.recoveryAcknowledgedAt, "确认时间戳应落盘");
});

test("an ambiguous attempt phase releases its inflight slot", async (t) => {
  const fx = await fixture();
  t.after(async () => { await fx.orchestrator.close(); await rm(fx.root, { recursive: true, force: true }); });
  const created = await fx.orchestrator.create({ prompt: "implement", execute: false, permissionMode: "plan" });
  const run = fx.orchestrator.get(created.id);
  run.turnAttempts = [{ attemptId: "a1", round: 1, agentId: "codex-technical", phase: "submitted" }];
  run.inflightTurns = { "codex-technical": "a1" };

  await fx.orchestrator.checkpointTurn(run, "codex-technical", "a1", "ambiguous", {});

  assert.equal(run.inflightTurns["codex-technical"], undefined, "ambiguous 是终结相位，不得继续占用 inflight 槽位");
});
