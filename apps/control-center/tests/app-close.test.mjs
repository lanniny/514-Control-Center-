import test from "node:test";
import assert from "node:assert/strict";
import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createControlCenter } from "../src/app.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRepo = resolve(appRoot, "../..");

async function createIsolatedRepo(root) {
  const repoRoot = resolve(root, "repo");
  const configRoot = resolve(repoRoot, "config/control-center");
  const schemaRoot = resolve(repoRoot, "schemas/control-center");
  await mkdir(configRoot, { recursive: true });
  await mkdir(schemaRoot, { recursive: true });
  for (const name of ["models.json", "routing.json", "permissions.json", "claude-coordinator.md"]) {
    await cp(resolve(sourceRepo, "config/control-center", name), resolve(configRoot, name));
  }
  await cp(resolve(sourceRepo, "schemas/control-center/contracts.schema.json"), resolve(schemaRoot, "contracts.schema.json"));
  await writeFile(resolve(configRoot, "sources.json"), `${JSON.stringify({
    version: 1,
    explicit: [
      { id: "control.models", path: "config/control-center/models.json", label: "Models", kind: "json", scope: "repo", critical: true },
      { id: "control.routing", path: "config/control-center/routing.json", label: "Routing", kind: "json", scope: "repo", critical: true },
      { id: "control.permissions", path: "config/control-center/permissions.json", label: "Permissions", kind: "json", scope: "repo", critical: true },
      { id: "control.claude-coordinator", path: "config/control-center/claude-coordinator.md", label: "Coordinator", kind: "markdown", scope: "repo", critical: true },
    ],
    discover: [],
    runtime: [],
  }, null, 2)}\n`, "utf8");
  return repoRoot;
}

test("app close 在 proxy restore 未完成时保留服务与实例锁，并允许并发调用后重试", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-app-close-"));
  const repoRoot = await createIsolatedRepo(root);
  const dataRoot = resolve(root, "data");
  const lockPath = resolve(dataRoot, "control-center.lock");
  const state = await createControlCenter({ repoRoot, dataRoot });
  t.after(async () => {
    await state.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  const originalProxyClose = state.ccswitchProxy.close.bind(state.ccswitchProxy);
  let proxyCloseAttempts = 0;
  state.ccswitchProxy.close = async () => {
    proxyCloseAttempts += 1;
    if (proxyCloseAttempts === 1) {
      return {
        ...state.ccswitchProxy.status(),
        closed: false,
        warnings: [{ code: "PROXY_CLOSE_INCOMPLETE", error: "injected restore failure" }],
      };
    }
    return originalProxyClose();
  };

  const first = state.close();
  const concurrent = state.close();
  for (const attempt of [first, concurrent]) {
    await assert.rejects(
      attempt,
      (error) => error.code === "CONTROL_CENTER_CLOSE_INCOMPLETE"
        && error.proxyStatus?.warnings?.[0]?.code === "PROXY_CLOSE_INCOMPLETE",
    );
  }
  assert.equal(proxyCloseAttempts, 1, "concurrent app close calls must share one proxy close attempt");
  assert.ok(state.automations.timer, "scheduler must resume when shutdown aborts before its commit point");
  await access(lockPath);
  await state.eventStore.emit("test.close_retry_ready", {}, { sensitivity: "internal" });

  await state.close();
  assert.equal(proxyCloseAttempts, 2);
  await assert.rejects(access(lockPath), { code: "ENOENT" });
});

test("app close 提交点后的清理失败会尽力完成其余步骤，并允许后续关闭重试", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-app-close-"));
  const repoRoot = await createIsolatedRepo(root);
  const dataRoot = resolve(root, "data");
  const lockPath = resolve(dataRoot, "control-center.lock");
  const state = await createControlCenter({ repoRoot, dataRoot });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const calls = [];
  const originalDenyAll = state.approvalBroker.denyAll.bind(state.approvalBroker);
  const originalOrchestratorClose = state.orchestrator.close.bind(state.orchestrator);
  const originalEventStoreClose = state.eventStore.close.bind(state.eventStore);
  const originalFlush = state.childRegistry.flush.bind(state.childRegistry);
  state.approvalBroker.denyAll = async () => {
    calls.push("approvalBroker.denyAll");
    return originalDenyAll();
  };
  let orchestratorAttempts = 0;
  state.orchestrator.close = async () => {
    calls.push("orchestrator.close");
    await originalOrchestratorClose();
    orchestratorAttempts += 1;
    if (orchestratorAttempts === 1) {
      throw Object.assign(new Error("injected orchestrator cleanup failure"), { code: "INJECTED_CLEANUP_FAILURE" });
    }
  };
  state.eventStore.close = async () => {
    calls.push("eventStore.close");
    return originalEventStoreClose();
  };
  state.childRegistry.flush = async () => {
    calls.push("childRegistry.flush");
    return originalFlush();
  };

  await assert.rejects(
    state.close(),
    (error) => {
      return error.code === "CONTROL_CENTER_CLOSE_FAILED"
        && error.cleanupErrors?.some((entry) => entry.step === "orchestrator.close"
          && entry.code === "INJECTED_CLEANUP_FAILURE");
    },
  );
  assert.deepEqual(calls, [
    "approvalBroker.denyAll",
    "orchestrator.close",
    "eventStore.close",
    "childRegistry.flush",
  ]);
  await assert.rejects(access(lockPath), { code: "ENOENT" });

  await state.close();
  assert.deepEqual(calls, [
    "approvalBroker.denyAll",
    "orchestrator.close",
    "eventStore.close",
    "childRegistry.flush",
    "orchestrator.close",
  ]);
});

test("app close 为未纳入 deadline 的 cleanup step 提供超时并支持恢复后重试", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-app-close-"));
  const repoRoot = await createIsolatedRepo(root);
  const dataRoot = resolve(root, "data");
  const lockPath = resolve(dataRoot, "control-center.lock");
  const state = await createControlCenter({ repoRoot, dataRoot });
  t.after(async () => {
    await state.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  let releaseFlush;
  state.childRegistry.flush = () => new Promise((resolveFlush) => { releaseFlush = resolveFlush; });
  const startedAt = Date.now();
  await assert.rejects(
    state.close({ budgetMs: 5_000, deadlineMs: Date.now() + 150 }),
    (error) => error.code === "CONTROL_CENTER_CLOSE_FAILED"
      && error.cleanupErrors?.some((entry) => entry.step === "childRegistry.flush"
        && entry.code === "CONTROL_CENTER_CLOSE_TIMEOUT"),
  );
  assert.ok(Date.now() - startedAt < 1_000, "an external absolute deadline must override the local close budget");
  await access(lockPath);

  releaseFlush();
  await state.close({ budgetMs: 1_000 });
  await assert.rejects(access(lockPath), { code: "ENOENT" });
});
