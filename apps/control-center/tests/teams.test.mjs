import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_TEAM, COORDINATOR_ELIGIBLE, TeamStore } from "../src/teams.mjs";
import { createTeamCatalog } from "../src/adapters/manifest.mjs";

const KNOWN = ["claude-fable", "codex-technical", "grok-search", "grok-build", "kimi-frontend", "pi-resident"];

async function fixture({ teamCatalog = null, knownProviders = KNOWN, knownCoordinators = COORDINATOR_ELIGIBLE } = {}) {
  const root = await mkdtemp(join(tmpdir(), "cc-teams-"));
  const store = await new TeamStore({
    dataRoot: root,
    teamCatalog,
    knownProviders: () => knownProviders,
    knownCoordinators: () => knownCoordinators,
  }).init();
  return { root, store };
}

test("builtin 514cc team is always listed first and is frozen against update and delete", async () => {
  const { root, store } = await fixture();
  try {
    assert.equal(store.list()[0].id, BUILTIN_TEAM.id);
    assert.equal(store.list()[0].builtin, true);
    await assert.rejects(() => store.update(BUILTIN_TEAM.id, { name: "改名" }), { code: "FROZEN_BLOCK" });
    await assert.rejects(() => store.remove(BUILTIN_TEAM.id), { code: "FROZEN_BLOCK" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("create/update/remove round-trips through disk persistence", async () => {
  const { root, store } = await fixture();
  try {
    const team = await store.create({
      name: "研究小队",
      systemPrompt: "情报优先",
      members: ["claude-fable", "grok-search"],
      skills: ["co-research"],
      mcp: ["exa"],
    });
    assert.ok(team.id.startsWith("team-"));
    const reloaded = await new TeamStore({ dataRoot: root, knownProviders: () => KNOWN }).init();
    assert.equal(reloaded.get(team.id).name, "研究小队", "custom team survives restart");
    const updated = await store.update(team.id, { name: "研究小队 v2" });
    assert.equal(updated.name, "研究小队 v2");
    await store.remove(team.id);
    assert.throws(() => store.get(team.id), { code: "SOURCE_NOT_FOUND" });
    const raw = JSON.parse(await readFile(join(root, "teams.json"), "utf8"));
    assert.equal(raw.teams.length, 0, "removal persists to disk");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validation: custom teams need one known member but do not require Claude", async () => {
  const { root, store } = await fixture();
  try {
    const codexOnly = await store.create({ name: "无 Claude 团队", members: ["codex-technical"] });
    assert.deepEqual(codexOnly.members, ["codex-technical"]);
    assert.equal(codexOnly.coordinator, "codex-technical");
    await assert.rejects(() => store.create({ name: "无成员", members: [] }), { code: "VALIDATION_FAILED" });
    await assert.rejects(() => store.create({ name: "幽灵成员", members: ["claude-fable", "gpt-99"] }), { code: "VALIDATION_FAILED" });
    await assert.rejects(() => store.create({ name: "", members: ["codex-technical"] }), { code: "VALIDATION_FAILED" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief renders team context for planner injection", async () => {
  const { root, store } = await fixture();
  try {
    const brief = store.brief(BUILTIN_TEAM.id);
    assert.ok(brief.includes("当前团队：514cc"));
    assert.ok(brief.includes("claude-fable"));
    assert.ok(brief.includes("团队 Skill"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init rejects hand-injected malformed disk records instead of trusting them", async () => {
  const { root } = await fixture();
  try {
    const { writeFile } = await import("node:fs/promises");
    const poisoned = {
      teams: [
        { id: "team-evil", name: "无成员注入", members: [] },
        { id: "team-ok", name: "合法团队", members: ["claude-fable"], skills: [], mcp: [] },
      ],
    };
    await writeFile(join(root, "teams.json"), JSON.stringify(poisoned), "utf8");
    const store = await new TeamStore({ dataRoot: root, knownProviders: () => KNOWN }).init();
    const ids = store.list().map((team) => team.id);
    assert.ok(!ids.includes("team-evil"), "empty-members record rejected on load");
    assert.ok(ids.includes("team-ok"), "valid record loads");
    assert.equal(store.rejectedOnLoad.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejected disk teams retain member references for fail-closed deletion guards", async () => {
  const { root } = await fixture();
  try {
    await writeFile(join(root, "teams.json"), JSON.stringify({
      teams: [
        { id: "team-rejected-ref", name: "主脑不在成员中", members: ["member-orphan"], coordinator: "claude-fable" },
        { name: "缺少标识", members: ["member-no-id"], coordinator: "member-no-id" },
      ],
    }), "utf8");
    const store = await new TeamStore({
      dataRoot: root,
      knownProviders: () => [...KNOWN, "member-orphan", "member-no-id"],
    }).init();
    assert.deepEqual(store.referencesForMember("member-orphan"), ["team-rejected-ref"]);
    assert.deepEqual(store.referencesForMember("member-no-id"), ["rejected-team-2"]);
    await assert.rejects(
      () => store.withMemberReferenceGuard("member-orphan", async () => "mutated"),
      (error) => error.code === "MEMBER_IN_USE" && error.references.includes("team-rejected-ref"),
    );
    await store.create({ name: "无关写入", members: ["codex-technical"] });
    const persisted = JSON.parse(await readFile(join(root, "teams.json"), "utf8"));
    assert.ok(
      persisted.teams.some((team) => team.id === "team-rejected-ref" && team.members?.includes("member-orphan")),
      "an unrelated write must retain the rejected record and its member references",
    );
    assert.ok(
      persisted.teams.some((team) => !team.id && team.members?.includes("member-no-id")),
      "rejected records without an id must also survive unrelated writes",
    );
    const reloaded = await new TeamStore({
      dataRoot: root,
      knownProviders: () => [...KNOWN, "member-orphan", "member-no-id"],
    }).init();
    assert.deepEqual(reloaded.referencesForMember("member-orphan"), ["team-rejected-ref"]);
    assert.equal(reloaded.referencesForMember("member-no-id").length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a corrupt whole team store freezes reference-sensitive mutations without overwriting bytes", async () => {
  const { root } = await fixture();
  try {
    const path = join(root, "teams.json");
    const corrupt = '{"teams":[';
    await writeFile(path, corrupt, "utf8");
    const store = await new TeamStore({ dataRoot: root, knownProviders: () => KNOWN }).init();
    assert.equal(store.storeStatus.failClosed, true);
    assert.equal(store.storeStatus.code, "TEAM_STORE_INVALID");
    assert.throws(() => store.referencesForMember("member-unknown"), {
      code: "MEMBER_REFERENCE_CHECK_FAILED",
    });
    let mutated = false;
    await assert.rejects(
      () => store.withMemberReferenceGuard("member-unknown", async () => { mutated = true; }),
      { code: "MEMBER_REFERENCE_CHECK_FAILED" },
    );
    assert.equal(mutated, false);
    await assert.rejects(
      () => store.create({ name: "不得覆盖损坏真源", members: ["codex-technical"] }),
      { code: "TEAM_STORE_UNAVAILABLE" },
    );
    await assert.rejects(
      () => store.update("team-missing", { name: "不得更新损坏真源" }),
      { code: "TEAM_STORE_UNAVAILABLE" },
    );
    await assert.rejects(
      () => store.remove("team-missing"),
      { code: "TEAM_STORE_UNAVAILABLE" },
    );
    assert.equal(await readFile(path, "utf8"), corrupt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("duplicate disk team ids freeze the whole store instead of dropping an earlier member reference", async () => {
  const { root } = await fixture();
  try {
    const path = join(root, "teams.json");
    const duplicate = JSON.stringify({
      teams: [
        { id: "team-duplicate", name: "第一条", members: ["member-first"], coordinator: "member-first" },
        { id: "team-duplicate", name: "第二条", members: ["member-second"], coordinator: "member-second" },
      ],
    });
    await writeFile(path, duplicate, "utf8");
    const store = await new TeamStore({
      dataRoot: root,
      knownProviders: () => [...KNOWN, "member-first", "member-second"],
    }).init();
    assert.equal(store.storeStatus.failClosed, true);
    assert.equal(store.storeStatus.code, "TEAM_STORE_INVALID");
    assert.throws(() => store.referencesForMember("member-first"), { code: "MEMBER_REFERENCE_CHECK_FAILED" });
    assert.throws(() => store.referencesForMember("member-second"), { code: "MEMBER_REFERENCE_CHECK_FAILED" });
    await assert.rejects(
      () => store.create({ name: "不得覆盖重复真源", members: ["codex-technical"] }),
      { code: "TEAM_STORE_UNAVAILABLE" },
    );
    await assert.rejects(
      () => store.update("team-duplicate", { name: "不得更新重复真源" }),
      { code: "TEAM_STORE_UNAVAILABLE" },
    );
    await assert.rejects(() => store.remove("team-duplicate"), { code: "TEAM_STORE_UNAVAILABLE" });
    assert.equal(await readFile(path, "utf8"), duplicate);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup catalog conflicts remain fail-closed instead of disappearing as rejected records", async () => {
  const { root } = await fixture();
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(root, "teams.json"), JSON.stringify({
      teams: [{ id: "team-unwired", name: "失效执行席", members: ["custom-command-only"], coordinator: "custom-command-only" }],
    }), "utf8");
    const store = await new TeamStore({ dataRoot: root, knownProviders: () => KNOWN }).init();
    assert.equal(store.rejectedOnLoad.length, 1);
    assert.throws(
      () => store.assertCatalogCompatible(),
      (error) => error.code === "TEAM_CATALOG_CONFLICT"
        && error.conflicts.some((item) => item.id === "team-unwired"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reserved builtin name and secret-like prompts are rejected", async () => {
  const { root, store } = await fixture();
  try {
    await assert.rejects(() => store.create({ name: "514cc", members: ["claude-fable"] }), { code: "VALIDATION_FAILED" });
    await assert.rejects(() => store.create({ name: "514 CC", members: ["claude-fable"] }), { code: "VALIDATION_FAILED" });
    await assert.rejects(() => store.create({ name: "５１４ｃｃ", members: ["claude-fable"] }), { code: "VALIDATION_FAILED" });
    await assert.rejects(
      () => store.create({ name: "泄密队", systemPrompt: "api_key=sk-proj-ABCDEFGH12345678", members: ["claude-fable"] }),
      { code: "VALIDATION_FAILED" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent mutations serialize and both survive on disk", async () => {
  const { root, store } = await fixture();
  try {
    const [a, b] = await Promise.all([
      store.create({ name: "并发A", members: ["claude-fable"] }),
      store.create({ name: "并发B", members: ["claude-fable"] }),
    ]);
    const raw = JSON.parse(await readFile(join(root, "teams.json"), "utf8"));
    const names = raw.teams.map((team) => team.name).sort();
    assert.deepEqual(names, ["并发A", "并发B"], "no lost update under concurrent creates");
    assert.notEqual(a.id, b.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("member mutation guard serializes the reference check and commit against team writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "cc-teams-member-guard-"));
  const catalogState = {
    members: [
      { id: "claude-fable", teamMemberEligible: true, coordinatorEligible: true },
      { id: "member-race", teamMemberEligible: true, coordinatorEligible: true },
    ],
  };
  const store = await new TeamStore({ dataRoot: root, teamCatalog: () => catalogState.members }).init();
  try {
    let releaseMutation;
    let mutationStarted;
    const mutationGate = new Promise((resolveGate) => { releaseMutation = resolveGate; });
    const started = new Promise((resolveStarted) => { mutationStarted = resolveStarted; });
    const guarded = store.withMemberReferenceGuard("member-race", async () => {
      mutationStarted();
      await mutationGate;
      catalogState.members = catalogState.members.filter((member) => member.id !== "member-race");
    });
    await started;

    let teamWriteSettled = false;
    const teamWrite = store.create({ name: "竞态团队", members: ["member-race"], coordinator: "member-race" })
      .finally(() => { teamWriteSettled = true; });
    await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
    assert.equal(teamWriteSettled, false, "team write must wait while the member reference guard owns the team queue");
    releaseMutation();
    await guarded;
    await assert.rejects(teamWrite, { code: "VALIDATION_FAILED" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coordinator defaults to the first CLI-capable member and may be any registered CLI profile", async () => {
  const { root, store } = await fixture();
  try {
    const codexOnly = await store.create({ name: "Codex 单席队", members: ["codex-technical"] });
    assert.equal(codexOnly.coordinator, "codex-technical");
    const grokLed = await store.create({ name: "Grok 主脑队", members: ["grok-search", "grok-build"] });
    assert.equal(grokLed.coordinator, "grok-build", "non-CLI members are skipped when deriving a coordinator");
    const codexLed = await store.create({ name: "Codex 主脑队", coordinator: "codex-technical", members: ["claude-fable", "codex-technical"] });
    assert.equal(codexLed.coordinator, "codex-technical");
    // 主脑必须是成员
    await assert.rejects(
      () => store.create({ name: "主脑不在队", coordinator: "grok-build", members: ["codex-technical"] }),
      { code: "VALIDATION_FAILED" },
    );
    // grok-search 无独立 CLI 会话，不可任主脑
    await assert.rejects(
      () => store.create({ name: "MCP 当主脑", coordinator: "grok-search", members: ["grok-search", "codex-technical"] }),
      { code: "VALIDATION_FAILED" },
    );
    assert.equal(BUILTIN_TEAM.coordinator, "claude-fable", "builtin team is claude-led");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("team catalog comes from adapter bindings instead of arbitrary profile commands", () => {
  const catalog = createTeamCatalog([
    {
      id: "codex-technical",
      label: "Codex",
      role: "technical-executor",
      provider: "openai",
      adapter: "codex-app-server",
      command: "codex",
      enabled: true,
    },
    {
      id: "grok-search",
      label: "Grok Search",
      role: "current-intelligence",
      provider: "xai-compatible",
      adapter: "grok-mcp-via-codex-app-server",
      command: null,
      enabled: true,
    },
    {
      id: "gemini-research",
      label: "Gemini",
      role: "research-specialist",
      provider: "google",
      adapter: "gemini-stream-json",
      command: "gemini",
      enabled: false,
    },
  ]);
  assert.equal(catalog.find((item) => item.id === "codex-technical").coordinatorEligible, true);
  assert.equal(catalog.find((item) => item.id === "grok-search").teamMemberEligible, true);
  assert.equal(catalog.find((item) => item.id === "grok-search").coordinatorEligible, false);
  assert.equal(catalog.find((item) => item.id === "gemini-research").teamMemberEligible, false);
  assert.equal(catalog.find((item) => item.id === "gemini-research").eligibilityReason, "profile-disabled");
  assert.throws(
    () => createTeamCatalog([{
      id: "custom-cli-coordinator",
      label: "Custom",
      role: "custom",
      provider: "custom",
      adapter: "custom-stream",
      command: "custom",
      enabled: true,
    }]),
    { code: "ADAPTER_MANIFEST_INVALID" },
  );
});

test("catalog compatibility blocks a hot reload that would invalidate saved teams", async () => {
  let catalog = KNOWN.map((id) => ({
    id,
    teamMemberEligible: true,
    coordinatorEligible: COORDINATOR_ELIGIBLE.includes(id),
  }));
  const { root, store } = await fixture({ teamCatalog: () => catalog });
  try {
    const team = await store.create({ name: "Kimi 主脑", members: ["kimi-frontend"], coordinator: "kimi-frontend" });
    assert.equal(team.coordinator, "kimi-frontend");
    assert.deepEqual(store.assertCatalogCompatible(), { valid: true, conflicts: [] });
    catalog = catalog.filter((item) => item.id !== "kimi-frontend");
    assert.throws(
      () => store.assertCatalogCompatible(),
      (error) => error.code === "TEAM_CATALOG_CONFLICT"
        && error.conflicts.some((item) => item.id === BUILTIN_TEAM.id)
        && error.conflicts.some((item) => item.id === team.id),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("catalog transition serializes concurrent team writes against the pending directory", async () => {
  const legacyOnly = "legacy-only";
  let catalog = [...KNOWN, legacyOnly].map((id) => ({
    id,
    teamMemberEligible: true,
    coordinatorEligible: COORDINATOR_ELIGIBLE.includes(id) || id === legacyOnly,
  }));
  const candidate = catalog.filter((item) => item.id !== legacyOnly);
  const { root, store } = await fixture({ teamCatalog: () => catalog });
  try {
    let openCandidate;
    let candidateStarted;
    const candidateGate = new Promise((resolveGate) => { openCandidate = resolveGate; });
    const candidateObserved = new Promise((resolveStarted) => { candidateStarted = resolveStarted; });
    const transitionPromise = store.beginCatalogTransition(async () => {
      candidateStarted();
      await candidateGate;
      return candidate;
    });
    await candidateObserved;
    let createSettled = false;
    const createPromise = store.create({ name: "旧目录竞态", members: [legacyOnly], coordinator: legacyOnly });
    void createPromise.then(() => { createSettled = true; }, () => { createSettled = true; });
    await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
    assert.equal(createSettled, false, "team write must wait behind the catalog transition");
    openCandidate();
    const guard = await transitionPromise;
    await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
    assert.equal(createSettled, false, "team write must remain blocked until activation releases the guard");
    await guard.release({ committed: true, activation: { status: "restart-required" } });
    await assert.rejects(createPromise, { code: "VALIDATION_FAILED" });
    const failedReplacement = await store.beginCatalogTransition(catalog);
    await failedReplacement.release({ committed: false, activation: null });
    await assert.rejects(
      () => store.create({ name: "失败事务不得清空旧 pending", members: [legacyOnly], coordinator: legacyOnly }),
      { code: "VALIDATION_FAILED" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
