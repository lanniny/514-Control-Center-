import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AutomationStore, scheduleIntervalMs, seedBuiltinAutomations, PULSE_CHECK_PROMPT } from "../src/automations.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

test("scheduleIntervalMs parses interval grammar and rejects junk", () => {
  assert.equal(scheduleIntervalMs("manual"), null);
  assert.equal(scheduleIntervalMs("every:30m"), 30 * 60_000);
  assert.equal(scheduleIntervalMs("every:6h"), 6 * 3_600_000);
  assert.equal(scheduleIntervalMs("every:1d"), 86_400_000);
  assert.equal(scheduleIntervalMs("every:0m"), null);
  assert.equal(scheduleIntervalMs("cron:* * * * *"), null);
});

function fakeOrchestrator() {
  const created = [];
  const runs = new Map();
  const runsByIdempotencyKey = new Map();
  return {
    created,
    runs,
    async create(input) {
      if (input.idempotencyKey && runsByIdempotencyKey.has(input.idempotencyKey)) {
        return runsByIdempotencyKey.get(input.idempotencyKey);
      }
      const run = { id: `run-${created.length + 1}`, status: "succeeded", input };
      created.push(input);
      runs.set(run.id, run);
      if (input.idempotencyKey) runsByIdempotencyKey.set(input.idempotencyKey, run);
      return run;
    },
    get(id) {
      const run = runs.get(id);
      if (!run) throw Object.assign(new Error("run not found"), { code: "RUN_NOT_FOUND" });
      return run;
    },
  };
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await new Promise((resolveTimer) => setTimeout(resolveTimer, 10));
  assert.ok(predicate(), "timed out waiting for test condition");
}

const noopEvents = { emit: async () => ({}) };

test("automation CRUD round-trips through disk and validates input", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const orchestrator = fakeOrchestrator();
  const store = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents }).init();
  const sourcePath = resolve(root, "private-spec.md");
  assert.equal(store.status().state, "ready");
  assert.equal(store.status().source, "missing-default");
  assert.equal(store.status().writable, true);

  await assert.rejects(() => store.create({ name: "", prompt: "x" }), { code: "VALIDATION_FAILED" });
  await assert.rejects(() => store.create({ name: "n", prompt: "" }), { code: "VALIDATION_FAILED" });
  await assert.rejects(() => store.create({ name: "n", prompt: "x", schedule: "every:5s" }), { code: "VALIDATION_FAILED" });
  await assert.rejects(() => store.create({ name: "n", prompt: "x", requestedAgentIds: "codex-technical" }), { code: "VALIDATION_FAILED" });
  await assert.rejects(
    () => store.create({ name: "n", prompt: "x", requestedAgentIds: ["a", "b", "c", "d", "e"] }),
    { code: "VALIDATION_FAILED" },
  );
  // 与 run 创建同门：密钥字面量拒绝入库（自动化是定时执行的持久载体）
  await assert.rejects(
    () => store.create({ name: "leak", prompt: "api_key=sk-proj-abcdef1234567890abcdef" }),
    { code: "SENSITIVE_PROMPT" },
  );

  const created = await store.create({
    name: "体检",
    prompt: "跑一轮体系体检",
    schedule: "every:1d",
    teamId: "team-514cc",
    requestedAgentIds: ["codex-technical", "kimi-frontend", "codex-technical"],
    sources: [sourcePath],
  });
  assert.ok(created.id);
  assert.equal(created.enabled, true);

  await store.update(created.id, { enabled: false, schedule: "every:6h" });
  const onDisk = JSON.parse(await readFile(join(root, "automations.json"), "utf8"));
  assert.equal(onDisk.automations.length, 1);
  assert.equal(onDisk.automations[0].enabled, false);
  assert.equal(onDisk.automations[0].schedule, "every:6h");
  assert.deepEqual(onDisk.automations[0].requestedAgentIds, ["codex-technical", "kimi-frontend"]);
  assert.deepEqual(onDisk.automations[0].sources, [{ kind: "file", path: sourcePath, name: "private-spec.md" }]);

  // 重启回环：新实例从磁盘恢复
  const reloaded = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents }).init();
  assert.equal(reloaded.list().length, 1);
  assert.equal(reloaded.list()[0].name, "体检");
  assert.deepEqual(reloaded.list()[0].requestedAgentIds, ["codex-technical", "kimi-frontend"]);
  assert.deepEqual(reloaded.list()[0].sources, [{ kind: "file", path: sourcePath, name: "private-spec.md" }]);
  assert.equal(reloaded.status().source, "disk");

  await store.remove(created.id);
  assert.equal(store.list().length, 0);
  assert.throws(() => store.get(created.id), { code: "AUTOMATION_NOT_FOUND" }); // get 是同步方法
});

test("legacy automation attachment blocks migrate to structured sources before listing or triggering", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-legacy-sources-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = resolve(root, "legacy reference (final)");
  const legacy = {
    version: 1,
    automations: [{
      id: "legacy-attachments",
      name: "旧附件自动化",
      prompt: `读取旧附件\n\n[附件资料——请读取以下文件作为本任务的上下文]\n- ${sourcePath}`,
      schedule: "manual",
      enabled: true,
      permissionMode: "plan",
      createdAt: "2026-08-07T00:00:00.000Z",
    }],
  };
  await writeFile(join(root, "automations.json"), `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
  const orchestrator = fakeOrchestrator();
  const store = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents }).init();
  const migrated = store.get("legacy-attachments");
  assert.equal(migrated.prompt, "读取旧附件");
  assert.deepEqual(migrated.sources, [{ kind: "file", path: sourcePath, name: "legacy reference (final)" }]);
  await store.trigger(migrated.id);
  assert.equal(orchestrator.created[0].prompt, "读取旧附件");
  assert.deepEqual(orchestrator.created[0].sources, migrated.sources);
});

test("corrupt automation store stays degraded and blocks seed/CRUD without overwriting the original", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-corrupt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "automations.json");
  const original = '{"version":1,"automations":[{"id":"keep-me"}';
  await writeFile(path, original, "utf8");
  const events = [];
  const store = await new AutomationStore({
    dataRoot: root,
    orchestrator: fakeOrchestrator(),
    eventStore: { emit: async (type, data) => { events.push({ type, data }); } },
  }).init();

  const status = store.status();
  assert.equal(status.state, "degraded");
  assert.equal(status.code, "AUTOMATION_STORE_CORRUPT");
  assert.equal(status.failClosed, true);
  assert.equal(status.writable, false);
  assert.equal(status.schedulerActive, false);
  assert.equal(store.start(), false, "a degraded store must not start its scheduler");
  await assert.rejects(() => seedBuiltinAutomations(store), { code: "AUTOMATION_STORE_CORRUPT" });
  await assert.rejects(() => store.create({ name: "replacement", prompt: "must not persist" }), { code: "AUTOMATION_STORE_CORRUPT" });
  await assert.rejects(() => store.update("keep-me", { enabled: false }), { code: "AUTOMATION_STORE_CORRUPT" });
  await assert.rejects(() => store.remove("keep-me"), { code: "AUTOMATION_STORE_CORRUPT" });
  await assert.rejects(() => store.trigger("keep-me"), { code: "AUTOMATION_STORE_CORRUPT" });
  assert.equal(await readFile(path, "utf8"), original, "the corrupt automation file must remain byte-for-byte untouched");
  assert.ok(events.some((event) => event.type === "automation.store_degraded"));
});

test("existing unreadable automation path is degraded rather than treated as first initialization", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-unreadable-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "automations.json");
  await mkdir(path);
  const store = await new AutomationStore({ dataRoot: root, orchestrator: fakeOrchestrator(), eventStore: noopEvents }).init();

  assert.equal(store.status().state, "degraded");
  assert.equal(store.status().code, "AUTOMATION_STORE_UNREADABLE");
  assert.equal(store.status().failClosed, true);
  await assert.rejects(() => seedBuiltinAutomations(store), { code: "AUTOMATION_STORE_UNREADABLE" });
  await assert.rejects(() => store.create({ name: "replacement", prompt: "must not persist" }), { code: "AUTOMATION_STORE_UNREADABLE" });
  assert.equal((await stat(path)).isDirectory(), true, "the unreadable original path must not be replaced");
});

test("runtime write failure rolls memory back, degrades the store and removes sensitive temp files", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-write-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "automations.json");
  const store = await new AutomationStore({ dataRoot: root, orchestrator: fakeOrchestrator(), eventStore: noopEvents }).init();
  await mkdir(path); // rename(temp, directory) fails after the temp snapshot has been written

  await assert.rejects(
    () => store.create({ name: "不得留在内存", prompt: "write failure" }),
    { code: "AUTOMATION_STORE_WRITE_FAILED" },
  );
  assert.deepEqual(store.list(), [], "failed mutation must be rolled back in memory");
  assert.equal(store.status().state, "degraded");
  assert.equal(store.status().writable, false);
  assert.equal(store.status().failClosed, true);
  await assert.rejects(() => store.create({ name: "后续写入", prompt: "blocked" }), { code: "AUTOMATION_STORE_WRITE_FAILED" });
  assert.equal((await readdir(root)).some((name) => name.endsWith(".tmp")), false, "failed snapshots must not leave temp files");
});

test("trigger records runHistory and cancel stops a non-terminal last run", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runs = new Map();
  const orchestrator = {
    async create(input) {
      const run = { id: `run-${runs.size + 1}`, status: "running", input };
      runs.set(run.id, run);
      return run;
    },
    get(id) {
      const run = runs.get(id);
      if (!run) throw Object.assign(new Error("run not found"), { code: "RUN_NOT_FOUND" });
      return run;
    },
    async cancel(id) {
      const run = this.get(id);
      run.status = "cancelled";
      return run;
    },
  };
  const store = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents }).init();
  const item = await store.create({ name: "hist", prompt: "do work", schedule: "manual", permissionMode: "review" });
  assert.equal(item.permissionMode, "review");
  const run = await store.trigger(item.id);
  assert.equal(run.input.orchestrationMode, "pipeline");
  const after = store.get(item.id);
  assert.equal(after.lastRunId, run.id);
  assert.equal(after.runHistory.length, 1);
  assert.equal(after.runHistory[0].runId, run.id);
  assert.equal(after.runHistory[0].source, "manual");
  const cancelled = await store.cancel(item.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(store.get(item.id).runHistory[0].status, "cancelled");
  await assert.rejects(() => store.cancel(item.id), { code: "AUTOMATION_NOT_RUNNING" });
});

test("trigger creates a real run with the composer snapshot and records lastRun", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-trig-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const orchestrator = fakeOrchestrator();
  const store = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents }).init();
  const sourcePath = resolve(root, "automation-source.md");
  const item = await store.create({
    name: "评审",
    prompt: "评审最近改动",
    startAgentId: "codex-technical",
    requestedAgentIds: ["claude-fable", "kimi-frontend"],
    permissionMode: "plan",
    effort: "high",
    sources: [sourcePath],
  });
  const run = await store.trigger(item.id);
  assert.equal(run.id, "run-1");
  assert.equal(orchestrator.created[0].prompt, "评审最近改动");
  assert.equal(orchestrator.created[0].startAgentId, "codex-technical");
  assert.deepEqual(orchestrator.created[0].requestedAgentIds, ["claude-fable", "kimi-frontend"]);
  assert.equal(orchestrator.created[0].orchestrationMode, "social");
  assert.deepEqual(orchestrator.created[0].sources, [{ kind: "file", path: sourcePath, name: "automation-source.md" }]);
  assert.equal(orchestrator.created[0].execute, true);
  const fresh = store.get(item.id);
  assert.equal(fresh.lastRunId, "run-1");
  assert.ok(fresh.lastRunAt);
  assert.equal(fresh.pendingTrigger, undefined);
  assert.match(orchestrator.created[0].idempotencyKey, new RegExp(`^automation:${item.id}:`));
});

test("trigger journal survives a post-create write failure and reuses the real run after restart", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-trigger-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "automations.json");
  const pendingSnapshot = join(root, "pending-trigger.json");
  const runs = new Map();
  const runsByKey = new Map();
  const created = [];
  let sabotageCompletion = true;
  const orchestrator = {
    created,
    async create(input) {
      if (runsByKey.has(input.idempotencyKey)) return runsByKey.get(input.idempotencyKey);
      const run = { id: `run-${created.length + 1}`, status: "succeeded", input };
      created.push(input);
      runs.set(run.id, run);
      runsByKey.set(input.idempotencyKey, run);
      if (sabotageCompletion) {
        sabotageCompletion = false;
        // trigger prepare 已经落盘；把该快照保留下来，再让 complete rename 确定失败。
        await rename(path, pendingSnapshot);
        await mkdir(path);
      }
      return run;
    },
    get(id) {
      const run = runs.get(id);
      if (!run) throw Object.assign(new Error("run not found"), { code: "RUN_NOT_FOUND" });
      return run;
    },
  };
  const firstStore = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents }).init();
  const item = await firstStore.create({ name: "可恢复触发", prompt: "exactly once" });

  await assert.rejects(() => firstStore.trigger(item.id), { code: "AUTOMATION_STORE_WRITE_FAILED" });
  assert.equal(created.length, 1, "the first attempt created one real run");
  assert.equal(firstStore.status().writable, false);
  assert.ok(JSON.parse(await readFile(pendingSnapshot, "utf8")).automations[0].pendingTrigger?.id);
  assert.equal((await readdir(root)).some((name) => name.endsWith(".tmp")), false);

  await rm(path, { recursive: true, force: true });
  await rename(pendingSnapshot, path);
  const recoveredStore = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents }).init();
  const recovered = await recoveredStore.trigger(item.id);
  assert.equal(recovered.id, "run-1");
  assert.equal(created.length, 1, "restart recovery must reuse the idempotent run instead of charging twice");
  assert.equal(recoveredStore.get(item.id).lastRunId, "run-1");
  assert.equal(recoveredStore.get(item.id).pendingTrigger, undefined);
});

test("trigger refuses to stack while the previous run is still active", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-busy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const orchestrator = fakeOrchestrator();
  const store = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents }).init();
  const item = await store.create({ name: "长任务", prompt: "跑很久" });
  const run = await store.trigger(item.id);
  orchestrator.runs.get(run.id).status = "running"; // 模拟仍在跑
  await assert.rejects(() => store.trigger(item.id), { code: "AUTOMATION_BUSY" });
  orchestrator.runs.get(run.id).status = "succeeded";
  const second = await store.trigger(item.id); // 终态后可再触发
  assert.equal(second.id, "run-2");
});

test("concurrent trigger is rejected per automation while different automations still run in parallel", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-concurrent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const created = [];
  const runs = new Map();
  let releaseCreates;
  const createGate = new Promise((resolveGate) => { releaseCreates = resolveGate; });
  t.after(() => releaseCreates());
  const orchestrator = {
    created,
    runs,
    async create(input) {
      const sequence = created.length + 1;
      created.push(input);
      await createGate;
      const run = { id: `run-${sequence}`, status: "running", input };
      runs.set(run.id, run);
      return run;
    },
    get(id) {
      const run = runs.get(id);
      if (!run) throw Object.assign(new Error("run not found"), { code: "RUN_NOT_FOUND" });
      return run;
    },
  };
  const store = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents }).init();
  const firstItem = await store.create({ name: "A", prompt: "first" });
  const secondItem = await store.create({ name: "B", prompt: "second" });

  const firstRun = store.trigger(firstItem.id);
  const duplicate = store.trigger(firstItem.id).then(
    () => ({ accepted: true }),
    (error) => ({ accepted: false, error }),
  );
  await waitFor(() => created.length === 1);
  assert.equal(created.length, 1, "same automation must not enter orchestrator.create twice");

  const independentRun = store.trigger(secondItem.id);
  await waitFor(() => created.length === 2);
  assert.equal(created.length, 2, "a different automation must not wait behind the first automation's lock");
  const duplicateResult = await duplicate;
  assert.equal(duplicateResult.accepted, false);
  assert.equal(duplicateResult.error?.code, "AUTOMATION_BUSY");

  releaseCreates();
  const [first, independent] = await Promise.all([firstRun, independentRun]);
  assert.notEqual(first.id, independent.id);
  assert.equal(created.length, 2, "concurrent duplicate must not create or charge a third run");
});

test("idle automations drain only when the control plane is quiet and not busy", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-idle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const orchestrator = fakeOrchestrator();
  orchestrator.list = () => [...orchestrator.runs.values()];
  const store = await new AutomationStore({
    dataRoot: root,
    orchestrator,
    eventStore: noopEvents,
    tickMs: 10,
    idleQuietMs: 60,
    idleCooldownMs: 60,
  }).init();
  const first = await store.create({ name: "闲时一", prompt: "a", schedule: "idle" });
  const second = await store.create({ name: "闲时二", prompt: "b", schedule: "idle" });
  await store.create({ name: "手动", prompt: "c", schedule: "manual" });
  // 定时基线=创建时刻：拨回冷却期外，模拟"早就该跑"
  store.get(first.id).lastRunAt = new Date(Date.now() - 600_000).toISOString();
  // second 留在冷却期内：冷却未到的闲时任务不得放量
  store.get(second.id).lastRunAt = new Date().toISOString();
  // 有非终态 run = 控制面繁忙，闲时任务一律不跑
  orchestrator.runs.set("busy-run", { id: "busy-run", status: "running", createdAt: new Date().toISOString() });
  store.start();
  t.after(() => store.stop());
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 60));
  assert.equal(orchestrator.created.length, 0, "控制面繁忙时不得跑闲时任务");
  // run 刚结束=最近活动，静默窗未满仍不跑
  orchestrator.runs.get("busy-run").status = "succeeded";
  orchestrator.runs.get("busy-run").createdAt = new Date().toISOString();
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 30));
  assert.equal(orchestrator.created.length, 0, "静默窗未满不得跑闲时任务");
  // 静默窗过后放量最久未跑的 first；second 冷却未到继续压着
  await waitFor(() => orchestrator.created.length >= 1);
  assert.equal(store.get(first.id).lastRunId, "run-1");
  assert.equal(store.get(second.id).lastRunId, null, "冷却期内的闲时任务不得放量");
  // second 拨出冷却期后继续排水
  store.get(second.id).lastRunAt = new Date(Date.now() - 600_000).toISOString();
  await waitFor(() => orchestrator.created.length >= 2);
  assert.equal(store.get(second.id).lastRunId, "run-2");
  // 手动任务全程不被闲时排水触碰
  assert.equal(store.list().find((item) => item.name === "手动").lastRunId, null);
  await store.stop();
  // idle 计划持久化回环
  const reloaded = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents }).init();
  assert.equal(reloaded.get(first.id).schedule, "idle");
});

test("idle drain stays closed when the orchestrator cannot prove quietness", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-idle-closed-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // 无 list() 的 orchestrator = 无法证实空闲，fail-closed 不跑
  const orchestrator = fakeOrchestrator();
  const store = await new AutomationStore({
    dataRoot: root,
    orchestrator,
    eventStore: noopEvents,
    tickMs: 10,
    idleQuietMs: 10,
    idleCooldownMs: 10,
  }).init();
  const item = await store.create({ name: "闲时", prompt: "a", schedule: "idle" });
  store.get(item.id).lastRunAt = new Date(Date.now() - 600_000).toISOString();
  store.start();
  t.after(() => store.stop());
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 60));
  await store.stop();
  assert.equal(orchestrator.created.length, 0, "无法证实空闲时不得放量闲时任务");
});

test("scheduler tick fires due automations and skips disabled/manual ones", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-tick-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const orchestrator = fakeOrchestrator();
  const store = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents, tickMs: 10 }).init();
  const due = await store.create({ name: "到点", prompt: "定时活", schedule: "every:1m" });
  await store.create({ name: "手动", prompt: "manual 活", schedule: "manual" });
  const off = await store.create({ name: "停用", prompt: "stopped", schedule: "every:1m" });
  await store.update(off.id, { enabled: false });
  // 定时基线=创建时刻（创建不立即跑）；把 due 的基线拨回过去模拟"到期"，off 同样拨回验证停用优先
  store.get(due.id).lastRunAt = new Date(Date.now() - 120_000).toISOString();
  store.get(off.id).lastRunAt = new Date(Date.now() - 120_000).toISOString();
  store.start();
  t.after(() => store.stop());
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 120));
  await store.stop();
  assert.equal(orchestrator.created.length, 1, `expected exactly the due automation to fire, got ${orchestrator.created.length}`);
  assert.equal(store.get(due.id).lastRunId, "run-1");
});

// v3.7 拓展：体检脉搏注入——{{PULSE}} 占位符在 trigger 时替换为控制面聚合数据；
// 数据源失败注入"不可用"说明（严禁静默伪造健康状态）
test("{{PULSE}} placeholder injects pulse data, and honestly degrades when the provider fails", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-pulse-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const orchestrator = fakeOrchestrator();
  let providerMode = "ok";
  const store = await new AutomationStore({
    dataRoot: root,
    orchestrator,
    eventStore: noopEvents,
    pulseProvider: async () => {
      if (providerMode === "throw") throw new Error("pulse source down");
      if (providerMode === "null") return null;
      return { routeGate: { red: 2, redUnsummoned: 1 }, runtime: { failedLast24h: 0 } };
    },
  }).init();
  const item = await store.create({ name: "体检", prompt: "体检数据：\n{{PULSE}}\n据此判断。" });

  await store.trigger(item.id);
  assert.ok(orchestrator.created[0].prompt.includes('"redUnsummoned": 1'), "pulse JSON 未注入 prompt");
  assert.ok(!orchestrator.created[0].prompt.includes("{{PULSE}}"), "占位符必须被替换");

  providerMode = "throw";
  await store.trigger(item.id);
  assert.ok(orchestrator.created[1].prompt.includes("体检数据源暂不可用"), "数据源失败必须如实注入不可用说明");

  providerMode = "null";
  await store.trigger(item.id);
  assert.ok(orchestrator.created[2].prompt.includes("体检数据源暂不可用"));
});

test("builtin pulse-check automation seeds once and is idempotent", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-seed-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const orchestrator = fakeOrchestrator();
  const store = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents }).init();
  await seedBuiltinAutomations(store);
  await seedBuiltinAutomations(store); // 二次播种必须 no-op
  const seeded = store.list().filter((item) => item.builtin === "pulse-check");
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].schedule, "manual"); // 不擅自定时（费用是 LO 的决策）
  assert.ok(seeded[0].prompt.includes("{{PULSE}}"));
  assert.equal(PULSE_CHECK_PROMPT.includes("[[msg:lo]]"), true); // 异常上报走 ask 卡语义
  // 重启回环后 builtin 标记保留（幂等判据持久化）
  const reloaded = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents }).init();
  await seedBuiltinAutomations(reloaded);
  assert.equal(reloaded.list().filter((item) => item.builtin === "pulse-check").length, 1);

  // 内置项 prompt 随版本升级（旧 prompt 被体系新文本覆盖；LO 自定义的名称/计划不动）
  const item = reloaded.list().find((entry) => entry.builtin === "pulse-check");
  await reloaded.update(item.id, { prompt: "旧版体检指令 {{PULSE}}", name: "我的体检", schedule: "every:1d" });
  await seedBuiltinAutomations(reloaded);
  const upgraded = reloaded.get(item.id);
  assert.equal(upgraded.prompt, PULSE_CHECK_PROMPT, "内置项 prompt 未随版本升级");
  assert.equal(upgraded.name, "我的体检", "LO 自定义名称不得被播种覆盖");
  assert.equal(upgraded.schedule, "every:1d", "LO 自定义计划不得被播种覆盖");
});

test("scheduler survives trigger failures and surfaces lastError", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-err-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const orchestrator = {
    async create() {
      throw Object.assign(new Error("no route for this prompt"), { code: "NO_ROUTE" });
    },
    get() {
      throw Object.assign(new Error("not found"), { code: "RUN_NOT_FOUND" });
    },
  };
  const store = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents, tickMs: 10 }).init();
  const item = await store.create({ name: "会失败", prompt: "bad", schedule: "every:1m" });
  store.get(item.id).lastRunAt = new Date(Date.now() - 120_000).toISOString(); // 基线拨回过去=到期
  store.start();
  t.after(() => store.stop());
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 120));
  await store.stop();
  const fresh = store.get(item.id);
  assert.match(fresh.lastError ?? "", /no route/);
  assert.ok(fresh.lastRunAt, "lastRunAt 必须前移，防止每 tick 重试风暴");
});

test("stop waits for an in-flight scheduler tick before returning", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-autom-stop-tick-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let releaseCreate;
  let started = false;
  const gate = new Promise((resolveGate) => { releaseCreate = resolveGate; });
  const runs = new Map();
  const orchestrator = {
    async create(input) {
      started = true;
      await gate;
      const run = { id: "run-stop", status: "succeeded", input };
      runs.set(run.id, run);
      return run;
    },
    get(id) {
      const run = runs.get(id);
      if (!run) throw Object.assign(new Error("run not found"), { code: "RUN_NOT_FOUND" });
      return run;
    },
  };
  const store = await new AutomationStore({ dataRoot: root, orchestrator, eventStore: noopEvents, tickMs: 10 }).init();
  const item = await store.create({ name: "关闭等待", prompt: "finish first", schedule: "every:1m" });
  store.get(item.id).lastRunAt = new Date(Date.now() - 120_000).toISOString();
  store.start();
  await waitFor(() => started);
  let stopped = false;
  const stopping = store.stop().then(() => { stopped = true; });
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 40));
  assert.equal(stopped, false, "stop returned while the scheduler was still creating a run");
  releaseCreate();
  await stopping;
  assert.equal(store.get(item.id).lastRunId, "run-stop");
});
