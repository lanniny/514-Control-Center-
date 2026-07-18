import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { EventStore } from "./event-store.mjs";
import { ConfigManager } from "./config-manager.mjs";
import { HealthService } from "./health.mjs";
import { ModelRouter } from "./router.mjs";
import { ApprovalBroker } from "./approval-broker.mjs";
import { createAdapters } from "./adapters/index.mjs";
import { Orchestrator } from "./orchestrator.mjs";
import { ObservabilityService } from "./observability.mjs";
import { SessionAggregator } from "./sessions.mjs";
import { TeamStore } from "./teams.mjs";
import { DATA_ROOT, REPO_ROOT } from "./paths.mjs";
import { acquireInstanceLock } from "./instance-lock.mjs";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const HOT_RELOAD_SOURCES = new Set([
  "control.models",
  "control.routing",
  "control.permissions",
  "control.claude-coordinator",
]);

async function readRuntimeConfig(repoRoot) {
  const configRoot = join(repoRoot, "config", "control-center");
  const [models, routing, permissions] = await Promise.all([
    readJson(join(configRoot, "models.json")),
    readJson(join(configRoot, "routing.json")),
    readJson(join(configRoot, "permissions.json")),
  ]);
  validateRuntimeGraph({ models, routing, permissions });
  return { configRoot, models, routing, permissions };
}

export function validateRuntimeGraph({ models, routing, permissions }) {
  const ids = models.profiles.map((profile) => profile.id);
  if (new Set(ids).size !== ids.length) throw Object.assign(new Error("model profile ids must be unique"), { code: "RUNTIME_GRAPH_INVALID" });
  const known = new Set(ids);
  for (const id of [routing.primaryCoordinator, routing.technicalExecutor]) {
    if (!known.has(id)) throw Object.assign(new Error(`routing references unknown profile ${id}`), { code: "RUNTIME_GRAPH_INVALID" });
  }
  for (const rule of routing.rules || []) {
    for (const id of rule.prefer || []) {
      if (!known.has(id)) throw Object.assign(new Error(`routing rule ${rule.id} references unknown profile ${id}`), { code: "RUNTIME_GRAPH_INVALID" });
    }
  }
  if (permissions.modes?.build?.approvalRequired !== true) {
    throw Object.assign(new Error("build mode must remain approval-bound"), { code: "RUNTIME_GRAPH_INVALID" });
  }
  if (Number(permissions.limits?.maxRounds) < 3) {
    throw Object.assign(new Error("permission maxRounds must allow planner, executor and verifier"), { code: "RUNTIME_GRAPH_INVALID" });
  }
}

function createRuntimeComponents({ models, routing, permissions, eventStore, repoRoot, approvalBroker }) {
  const adapters = createAdapters({
    profiles: models.profiles,
    eventStore,
    cwd: repoRoot,
    approvalResolver: (message, context) => approvalBroker.request(message, context),
  });
  const externalProbes = new Map();
  if (adapters.get("grok-search")?.health) externalProbes.set("grok-search", () => adapters.get("grok-search").health());
  const healthService = new HealthService(models.profiles, { externalProbes });
  const router = new ModelRouter({ profiles: models.profiles, policy: routing, healthService });
  return { models, routing, permissions, adapters, healthService, router };
}

export async function createControlCenter(options = {}) {
  const repoRoot = resolve(options.repoRoot || REPO_ROOT);
  const dataRoot = resolve(options.dataRoot || DATA_ROOT);
  const instanceLock = await acquireInstanceLock(join(repoRoot, ".ai-shared", "control-center"), { repoRoot, dataRoot });
  try {
  const { configRoot, models, routing, permissions } = await readRuntimeConfig(repoRoot);
  const eventStore = await new EventStore(join(dataRoot, "events.jsonl")).init();
  const approvalBroker = new ApprovalBroker({ eventStore, ttlMs: permissions.approval.ttlMs });
  const runtime = createRuntimeComponents({ models, routing, permissions, eventStore, repoRoot, approvalBroker });
  // 稳定引用盒子：init() 在 state 声明执行前调用 knownProviders——optional chaining 绕不过
  // let 的 TDZ（烛 R11 致命：ReferenceError 被逐记录 catch 吞掉→自定义团队重启后静默拒载）
  const modelsRef = { current: models };
  const teams = await new TeamStore({
    dataRoot,
    knownProviders: () => modelsRef.current.profiles.map((profile) => profile.id),
  }).init();
  const orchestrator = await new Orchestrator({
    router: runtime.router,
    adapters: runtime.adapters,
    eventStore,
    dataRoot,
    policy: permissions,
    approvalBroker,
    teams,
  }).init();
  let generation = 1;
  let closed = false;
  let state;
  const configManager = await new ConfigManager({
    repoRoot,
    dataRoot,
    registryPath: join(configRoot, "sources.json"),
    eventStore,
    beforeCommit: async ({ sourceId, content }) => {
      if (!["control.models", "control.routing", "control.permissions"].includes(sourceId)) return;
      const candidate = await readRuntimeConfig(repoRoot);
      if (sourceId === "control.models") candidate.models = JSON.parse(content);
      if (sourceId === "control.routing") candidate.routing = JSON.parse(content);
      if (sourceId === "control.permissions") candidate.permissions = JSON.parse(content);
      validateRuntimeGraph(candidate);
    },
    onCommitted: async ({ sourceId }) => {
      if (sourceId === "control.permissions") await orchestrator.revokeBuildGrants("permission policy changed");
      if (sourceId === "control.sources") {
        return { status: "restart-required", reason: "the source registry is loaded during control-plane startup" };
      }
      if (!HOT_RELOAD_SOURCES.has(sourceId)) return { status: "not-required", generation };
      return state.reloadRuntime({ sourceId, reason: "configuration commit" });
    },
  }).init();

  const aiSharedRoot = join(repoRoot, ".ai-shared");
  const observability = new ObservabilityService({ aiSharedRoot, repoRoot });
  const sessions = new SessionAggregator({ aiSharedRoot });

  state = {
    repoRoot,
    dataRoot,
    observability,
    sessions,
    teams,
    models: runtime.models,
    routing: runtime.routing,
    permissions: runtime.permissions,
    eventStore,
    healthService: runtime.healthService,
    router: runtime.router,
    approvalBroker,
    orchestrator,
    configManager,
    get generation() { return generation; },
    async reloadRuntime({ sourceId = "manual", reason = "manual reload" } = {}) {
      if (orchestrator.isBusy() || approvalBroker.list().length) {
        return {
          status: "restart-required",
          generation,
          reason: "active runs or approvals prevent an atomic runtime graph swap",
        };
      }
      const nextConfig = await readRuntimeConfig(repoRoot);
      const next = createRuntimeComponents({ ...nextConfig, eventStore, repoRoot, approvalBroker });
      const closeWarnings = await orchestrator.replaceRuntime({
        router: next.router,
        adapters: next.adapters,
        policy: next.permissions,
      });
      approvalBroker.ttlMs = next.permissions.approval.ttlMs;
      modelsRef.current = next.models; // 团队成员校验对齐热重载后的 models
      state.models = next.models;
      state.routing = next.routing;
      state.permissions = next.permissions;
      state.healthService = next.healthService;
      state.router = next.router;
      generation += 1;
      await eventStore.emit(
        "control.runtime_reloaded",
        { generation, sourceId, reason, closeWarnings },
        { sensitivity: "internal", agentId: "control-plane" },
      ).catch(() => {});
      return { status: "reloaded", generation, closeWarnings };
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await approvalBroker.denyAll();
        await orchestrator.close();
        await eventStore.close();
      } finally {
        await instanceLock.release();
      }
    },
  };
  return state;
  } catch (error) {
    await instanceLock.release();
    throw error;
  }
}
