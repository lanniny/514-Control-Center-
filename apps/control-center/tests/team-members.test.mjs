import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeamMemberStore } from "../src/team-members.mjs";

function runtimeProfile({
  id = "codex-technical",
  label = "Codex 技术执行",
  role = "technical-executor",
  capabilities = ["coding", "review", "testing"],
  enabled = true,
  teamMemberEligible = true,
  coordinatorEligible = true,
  eligibilityReason = null,
  model = id === "codex-technical" ? "gpt-test" : null,
  defaultEffort = id === "codex-technical" ? "high" : null,
  modelOptions = id === "codex-technical"
    ? ["gpt-test", "gpt-custom", "gpt-watchman"]
    : ["kimi-code/k3"],
  effortLevels = id === "codex-technical" ? ["high", "xhigh", "ultra"] : [],
} = {}) {
  return {
    id,
    label,
    shortLabel: label.split(" ")[0],
    role,
    description: `${label} runtime`,
    systemPrompt: "遵循当前任务边界并给出验证证据。",
    capabilities,
    model,
    defaultEffort,
    modelOptions: modelOptions.map((option) => ({ id: option, label: option })),
    effortLevels,
    provider: id.startsWith("codex") ? "openai" : "moonshot",
    adapter: id.startsWith("codex") ? "codex-app-server" : "kimi-headless-resume",
    enabled,
    teamMemberEligible,
    coordinatorEligible,
    eligibilityReason,
  };
}

async function fixture(t, {
  catalog = [runtimeProfile(), runtimeProfile({
    id: "kimi-frontend",
    label: "Kimi 前端",
    role: "frontend-engineer",
    capabilities: ["frontend", "coding"],
  })],
  referencesForMember = async () => [],
  guardMemberMutation = null,
  secureFile = null,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "cc-team-members-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = { catalog };
  const securedSizes = [];
  const store = await new TeamMemberStore({
    dataRoot: root,
    runtimeCatalog: () => state.catalog,
    referencesForMember,
    guardMemberMutation,
    secureFile: secureFile ?? (async (path) => {
      securedSizes.push((await stat(path)).size);
      await chmod(path, 0o600);
    }),
  }).load();
  return { root, state, store, securedSizes };
}

test("legacy runtime profiles are projected as builtin logical members", async (t) => {
  const { store } = await fixture(t);
  const members = store.list();
  assert.deepEqual(members.map((member) => member.id), ["codex-technical", "kimi-frontend"]);
  assert.deepEqual(members.map((member) => member.runtimeProfileId), ["codex-technical", "kimi-frontend"]);
  assert.ok(members.every((member) => member.builtin));
  assert.equal(members[0].provider, "openai");
  assert.equal(members[0].adapter, "codex-app-server");
  assert.equal(members[0].teamMemberEligible, true);
  assert.ok(members.every((member) => member.capabilities.length === 1 && member.capabilities[0] === "*"));
});

test("custom CRUD persists metadata while runtime fields stay derived", async (t) => {
  const { root, state, store, securedSizes } = await fixture(t);
  const created = await store.create({
    label: "实现席",
    shortLabel: "实现",
    role: "implementation-specialist",
    description: "负责实现与定向验证",
    systemPrompt: "严格限定修改范围。",
    capabilities: ["coding", "testing"],
    runtimeProfileId: "codex-technical",
    defaultModel: "gpt-custom",
    defaultEffort: "xhigh",
  });
  assert.match(created.id, /^member-[0-9a-f-]{36}$/);
  assert.equal(created.builtin, false);
  assert.equal(created.provider, "openai");
  assert.equal(created.teamMemberEligible, true);
  assert.deepEqual(created.capabilities, ["*"], "旧能力子集在写入边界迁移为默认全能力");
  assert.equal(created.createdAt, created.updatedAt);

  const disk = JSON.parse(await readFile(join(root, "team-members.json"), "utf8"));
  assert.equal(disk.version, 1);
  assert.equal(disk.members.length, 1);
  assert.equal(Object.hasOwn(disk.members[0], "provider"), false, "derived runtime data is not persisted");
  assert.ok(securedSizes.every((size) => size === 0), "private permissions are applied before content is written");
  if (process.platform !== "win32") {
    assert.equal((await stat(join(root, "team-members.json"))).mode & 0o777, 0o600);
  }

  const reloaded = await new TeamMemberStore({
    dataRoot: root,
    runtimeCatalog: () => state.catalog,
    referencesForMember: async () => [],
    secureFile: async (path) => chmod(path, 0o600),
  }).load();
  assert.equal(reloaded.get(created.id).label, "实现席");
  const updated = await reloaded.update(created.id, { label: "实现与测试席", defaultEffort: "ultra" });
  assert.equal(updated.label, "实现与测试席");
  assert.equal(updated.defaultEffort, "ultra");
  assert.notEqual(updated.updatedAt, created.updatedAt);

  assert.deepEqual(await reloaded.remove(created.id), { removed: created.id });
  assert.throws(() => reloaded.get(created.id), { code: "SOURCE_NOT_FOUND" });
  assert.equal(JSON.parse(await readFile(join(root, "team-members.json"), "utf8")).members.length, 0);
});

test("builtin metadata and runtime overrides round-trip while identity and deletion stay frozen", async (t) => {
  const { root, state, store } = await fixture(t);
  const updated = await store.update("codex-technical", {
    label: "烛 · 技术执行",
    shortLabel: "烛",
    role: "code-watchman",
    description: "实现、验证与独立复核",
    capabilities: ["coding", "review"],
    defaultModel: "gpt-watchman",
    defaultEffort: "xhigh",
  });
  assert.equal(updated.id, "codex-technical");
  assert.equal(updated.runtimeProfileId, "codex-technical");
  assert.equal(updated.label, "烛 · 技术执行");
  assert.deepEqual(updated.capabilities, ["*"]);

  state.catalog[0] = { ...state.catalog[0], role: "runtime-role-changed" };
  const reloaded = await new TeamMemberStore({
    dataRoot: root,
    runtimeCatalog: () => state.catalog,
    referencesForMember: async () => [],
    secureFile: async (path) => chmod(path, 0o600),
  }).load();
  assert.equal(reloaded.get("codex-technical").label, "烛 · 技术执行");
  assert.equal(reloaded.get("codex-technical").role, "code-watchman");
  const rebound = await reloaded.update("codex-technical", {
    runtimeProfileId: "kimi-frontend",
    capabilities: ["coding"],
    mainBrainAllowed: false,
  });
  assert.equal(rebound.runtimeProfileId, "kimi-frontend");
  assert.equal(rebound.provider, "moonshot");
  assert.equal(rebound.defaultModel, null, "rebinding follows the target runtime model default");
  assert.equal(rebound.defaultEffort, null, "rebinding drops the previous runtime effort default");
  assert.equal(rebound.mainBrainAllowed, false);
  assert.equal(rebound.coordinatorEligible, false);
  await assert.rejects(() => reloaded.remove("codex-technical"), { code: "FROZEN_BLOCK" });

  const reverted = await reloaded.update("codex-technical", {
    runtimeProfileId: null,
    capabilities: null,
    mainBrainAllowed: null,
    role: null,
  });
  assert.equal(reverted.runtimeProfileId, "codex-technical");
  assert.equal(reverted.mainBrainAllowed, true);
  assert.equal(reverted.role, "runtime-role-changed", "null removes an override and resumes runtime projection");
});

test("custom runtime rebinding resets omitted defaults and rejects stale explicit values", async (t) => {
  const { store } = await fixture(t);
  const created = await store.create({
    label: "待换绑成员",
    runtimeProfileId: "codex-technical",
    capabilities: ["coding"],
    defaultModel: "gpt-custom",
    defaultEffort: "xhigh",
  });

  await assert.rejects(() => store.update(created.id, {
    runtimeProfileId: "kimi-frontend",
    capabilities: ["coding"],
    defaultModel: "gpt-custom",
    defaultEffort: null,
  }), { code: "RUNTIME_MODEL_CONFLICT" });
  await assert.rejects(() => store.update(created.id, {
    runtimeProfileId: "kimi-frontend",
    capabilities: ["coding"],
    defaultModel: "kimi-code/k3",
    defaultEffort: "xhigh",
  }), { code: "RUNTIME_EFFORT_CONFLICT" });

  const rebound = await store.update(created.id, {
    runtimeProfileId: "kimi-frontend",
    capabilities: ["coding"],
  });
  assert.equal(rebound.defaultModel, null);
  assert.equal(rebound.defaultEffort, null);
});

test("custom members require an eligible runtime but capability subsets normalize to full access", async (t) => {
  const disabled = runtimeProfile({
    id: "disabled-profile",
    enabled: false,
    teamMemberEligible: false,
    coordinatorEligible: false,
    eligibilityReason: "profile-disabled",
  });
  const { store } = await fixture(t, { catalog: [runtimeProfile(), disabled] });
  await assert.rejects(
    () => store.create({ label: "幽灵席", runtimeProfileId: "missing-profile" }),
    { code: "RUNTIME_PROFILE_NOT_FOUND" },
  );
  await assert.rejects(
    () => store.create({ label: "禁用席", runtimeProfileId: "disabled-profile" }),
    { code: "RUNTIME_PROFILE_INELIGIBLE" },
  );
  const migrated = await store.create({
    label: "旧能力子集席",
    runtimeProfileId: "codex-technical",
    capabilities: ["coding", "shell-root"],
  });
  assert.deepEqual(migrated.capabilities, ["*"]);
  const updated = await store.update("codex-technical", { capabilities: ["coding", "unwired-tool"] });
  assert.deepEqual(updated.capabilities, ["*"]);
});

test("runtime invalidation retains saved members but fails eligibility and compatibility closed", async (t) => {
  const { state, store } = await fixture(t);
  const custom = await store.create({
    label: "审查席",
    runtimeProfileId: "codex-technical",
    capabilities: ["review"],
  });
  state.catalog = [
    { ...state.catalog[0], enabled: false, teamMemberEligible: false, coordinatorEligible: false, eligibilityReason: "profile-disabled" },
    state.catalog[1],
  ];
  const retained = store.get(custom.id);
  assert.equal(retained.id, custom.id);
  assert.equal(retained.enabled, false);
  assert.equal(retained.teamMemberEligible, false);
  assert.equal(retained.coordinatorEligible, false);
  assert.equal(retained.eligibilityReason, "profile-disabled");
  assert.throws(() => store.assertRuntimeCompatible(), {
    code: "MEMBER_RUNTIME_CONFLICT",
  });

  state.catalog = [state.catalog[1]];
  const missing = store.get(custom.id);
  assert.equal(missing.teamMemberEligible, false);
  assert.equal(missing.eligibilityReason, "runtime-profile-missing");
  assert.throws(() => store.assertRuntimeCompatible(), { code: "MEMBER_RUNTIME_CONFLICT" });
});

test("referenced deletion and reference lookup failures are blocked without mutation", async (t) => {
  let referenceMode = "in-use";
  const { store } = await fixture(t, {
    referencesForMember: async () => {
      if (referenceMode === "error") throw Object.assign(new Error("team store unavailable"), { code: "TEAM_STORE_DOWN" });
      if (referenceMode === "in-use") return ["team-alpha"];
      if (referenceMode === "undecided") return undefined;
      return [];
    },
  });
  const member = await store.create({ label: "被引用席", runtimeProfileId: "codex-technical" });
  await assert.rejects(
    () => store.update(member.id, { runtimeProfileId: "kimi-frontend", capabilities: ["coding"] }),
    { code: "MEMBER_IN_USE" },
  );
  assert.equal(store.get(member.id).runtimeProfileId, "codex-technical");
  await assert.rejects(() => store.remove(member.id), (error) => {
    assert.equal(error.code, "MEMBER_IN_USE");
    assert.deepEqual(error.references, ["team-alpha"]);
    return true;
  });
  assert.equal(store.get(member.id).id, member.id);

  referenceMode = "error";
  await assert.rejects(() => store.remove(member.id), { code: "MEMBER_REFERENCE_CHECK_FAILED" });
  assert.equal(store.get(member.id).id, member.id);

  referenceMode = "undecided";
  await assert.rejects(() => store.remove(member.id), { code: "MEMBER_REFERENCE_CHECK_FAILED" });
  assert.equal(store.get(member.id).id, member.id);

  referenceMode = "clear";
  await store.remove(member.id);
  assert.throws(() => store.get(member.id), { code: "SOURCE_NOT_FOUND" });
});

test("deletion requires an authoritative reference checker", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cc-team-members-no-ref-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await new TeamMemberStore({
    dataRoot: root,
    runtimeCatalog: () => [runtimeProfile()],
  }).load();
  const member = await store.create({ label: "待删席", runtimeProfileId: "codex-technical" });
  await assert.rejects(() => store.remove(member.id), { code: "MEMBER_REFERENCE_CHECK_REQUIRED" });
  assert.equal(store.get(member.id).id, member.id);
});

test("runtime rebinding and deletion execute inside the injected team mutation guard", async (t) => {
  const guarded = [];
  const { store } = await fixture(t, {
    referencesForMember: null,
    guardMemberMutation: async (memberId, mutation) => {
      guarded.push({ memberId, phase: "start" });
      const result = await mutation();
      guarded.push({ memberId, phase: "committed" });
      return result;
    },
  });
  const member = await store.create({ label: "受锁席", runtimeProfileId: "codex-technical" });
  await store.update(member.id, { description: "元数据更新不需要跨 Store 锁" });
  assert.deepEqual(guarded, []);
  const rebound = await store.update(member.id, { runtimeProfileId: "kimi-frontend", capabilities: ["coding"] });
  assert.equal(rebound.runtimeProfileId, "kimi-frontend");
  await store.remove(member.id);
  assert.deepEqual(guarded, [
    { memberId: member.id, phase: "start" },
    { memberId: member.id, phase: "committed" },
    { memberId: member.id, phase: "start" },
    { memberId: member.id, phase: "committed" },
  ]);
});

test("secret-like text, unsafe keys and structural bounds are rejected", async (t) => {
  const { root, store } = await fixture(t);
  await assert.rejects(
    () => store.create({
      label: "泄漏席",
      runtimeProfileId: "codex-technical",
      systemPrompt: "password=hunter2-secret-value",
    }),
    { code: "VALIDATION_FAILED" },
  );
  const migratedLegacyCapabilities = await store.create({
    label: "旧能力数组迁移席",
    runtimeProfileId: "codex-technical",
    capabilities: Array.from({ length: 65 }, (_, index) => index === 64 ? { legacy: true } : `capability-${index}`),
  });
  assert.deepEqual(migratedLegacyCapabilities.capabilities, ["*"], "旧能力数组内容不得继续阻断成员加载或保存");
  const poisoned = JSON.parse('{"label":"污染席","runtimeProfileId":"codex-technical","__proto__":{"polluted":true}}');
  await assert.rejects(() => store.create(poisoned), { code: "VALIDATION_FAILED" });
  assert.equal(Object.prototype.polluted, undefined);

  await writeFile(join(root, "team-members.json"), JSON.stringify({
    version: 1,
    members: [JSON.parse('{"id":"member-00000000-0000-4000-8000-000000000000","runtimeProfileId":"codex-technical","builtin":false,"label":"污染","shortLabel":"污","role":"","description":"","systemPrompt":"","capabilities":[],"defaultModel":null,"defaultEffort":null,"createdAt":"2026-07-28T00:00:00.000Z","updatedAt":"2026-07-28T00:00:00.000Z","__proto__":{"polluted":true}}')],
  }), "utf8");
  const poisonedStore = new TeamMemberStore({
    dataRoot: root,
    runtimeCatalog: () => [runtimeProfile()],
    referencesForMember: async () => [],
  });
  await assert.rejects(() => poisonedStore.load(), { code: "MEMBER_STORE_INVALID" });
  assert.equal(Object.prototype.polluted, undefined);
});

test("serialized concurrent creates do not lose updates or leave temp files", async (t) => {
  const { root, state, store } = await fixture(t);
  const peer = await new TeamMemberStore({
    dataRoot: root,
    runtimeCatalog: () => state.catalog,
    referencesForMember: async () => [],
    secureFile: async (path) => chmod(path, 0o600),
  }).load();
  const created = await Promise.all(Array.from({ length: 24 }, (_, index) => (index % 2 ? peer : store).create({
    label: `并发席 ${String(index).padStart(2, "0")}`,
    runtimeProfileId: "codex-technical",
    capabilities: ["coding"],
  })));
  assert.equal(new Set(created.map((member) => member.id)).size, 24);
  await store.load();
  assert.equal(store.list().filter((member) => !member.builtin).length, 24);
  const disk = JSON.parse(await readFile(join(root, "team-members.json"), "utf8"));
  assert.equal(disk.members.length, 24);
  const names = await import("node:fs/promises").then(({ readdir }) => readdir(root));
  assert.deepEqual(names.filter((name) => name.endsWith(".tmp")), []);
});
