import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ModelRouter, classifyTask } from "../src/router.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(appRoot, "..", "..");
const models = JSON.parse(await readFile(resolve(repoRoot, "config/control-center/models.json"), "utf8"));
const policy = JSON.parse(await readFile(resolve(repoRoot, "config/control-center/routing.json"), "utf8"));

function health(overrides = {}) {
  const items = models.profiles.map((profile) => ({
    id: profile.id,
    status: profile.enabled ? "online" : "disabled",
    available: profile.enabled,
    reason: "test probe",
    ...overrides[profile.id],
  }));
  return { map: async () => new Map(items.map((item) => [item.id, item])) };
}

test("classifies current and technical tasks", () => {
  assert.equal(classifyTask("搜索今天最新模型变化"), "current-research");
  assert.equal(classifyTask("修复这个异常并补测试"), "debugging");
});

test("routes coding to Codex when healthy", async () => {
  const router = new ModelRouter({ profiles: models.profiles, policy, healthService: health() });
  const route = await router.preview({ taskType: "coding", prompt: "实现配置事务" });
  assert.equal(route.selected.id, "codex-technical");
  assert.match(route.reason, /Codex/);
});

test("high-risk routing requires a healthy cross-provider verifier", async () => {
  const router = new ModelRouter({ profiles: models.profiles, policy, healthService: health() });
  const route = await router.preview({ taskType: "coding", prompt: "实现配置事务", risk: "high" });
  assert.equal(route.selected.id, "codex-technical");
  assert.equal(route.independent.id, "claude-fable");
  assert.equal(route.independentRequired, true);
});

test("high-risk routing fails closed when no independent provider is healthy", async () => {
  const router = new ModelRouter({
    profiles: models.profiles,
    policy,
    healthService: health({
      "claude-fable": { status: "offline", available: false, reason: "offline" },
      "gemini-research": { status: "offline", available: false, reason: "offline" },
    }),
  });
  await assert.rejects(() => router.preview({ taskType: "coding", prompt: "实现配置事务", risk: "high" }), { code: "NO_INDEPENDENT_ROUTE" });
});

test("current-source requirement overrides generic task classification", async () => {
  // v3.5-P2（烛 R-P2 致命2 修正）：改 mock 为 grok 可用——本测试验证的是 taskType 覆盖逻辑本身
  const router = new ModelRouter({
    profiles: models.profiles,
    policy,
    healthService: health({ "grok-search": { status: "online", available: true, reason: "probe ok" } }),
  });
  const route = await router.preview({ taskType: "planning", prompt: "模型方案", needsCurrentSource: true });
  assert.equal(route.taskType, "current-research");
  assert.equal(route.selected.id, "grok-search");
});

test("fails closed when no search-capable provider is available", async () => {
  // v3.5-P2（烛 R-P2 致命2）：gemini 已禁用、claude-cli adapter 无 MCP 不能搜索——
  // current-research 在 grok-search 不可用时必须显式 NO_ROUTE（fail-closed），
  // 而非把任务悄悄给一个不具备搜索能力的 provider（守"严禁 silent fallback"红线）
  const router = new ModelRouter({
    profiles: models.profiles,
    policy,
    healthService: health({ "grok-search": { status: "external-unverified", available: false, reason: "grok_timeout" } }),
  });
  await assert.rejects(() => router.preview({ taskType: "current-research", prompt: "查当前资料" }), { code: "NO_ROUTE" });
});

test("explicit unavailable provider fails instead of silently falling back", async () => {
  const router = new ModelRouter({
    profiles: models.profiles,
    policy,
    healthService: health({ "grok-search": { status: "offline", available: false, reason: "grok_timeout" } }),
  });
  await assert.rejects(() => router.preview({ taskType: "web-search", requestedProvider: "grok-search" }), { code: "PROVIDER_UNAVAILABLE" });
});

test("team member allowlist constrains selection and empty allowlist fails closed", async () => {
  const router = new ModelRouter({ profiles: models.profiles, policy, healthService: health() });
  // 团队不含 codex 时，coding 只能在成员内选（grok-build 具备 coding capability）
  const route = await router.preview({ taskType: "coding", prompt: "实现配置事务", allowedProviders: ["claude-fable", "grok-build"] });
  assert.equal(route.selected.id, "grok-build", "selection restricted to team members");
  const codex = route.candidates.find((item) => item.id === "codex-technical");
  assert.ok(codex.excludedReasons.includes("not a team member"));
  // 空白名单必须 NO_ROUTE，不得退化为不设限制（烛 R10 致命1）
  await assert.rejects(() => router.preview({ taskType: "coding", prompt: "实现配置事务", allowedProviders: [] }), { code: "NO_ROUTE" });
});
