import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_TEAM, TeamStore } from "../src/teams.mjs";

const KNOWN = ["claude-fable", "codex-technical", "grok-search", "grok-build", "pi-resident"];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cc-teams-"));
  const store = await new TeamStore({ dataRoot: root, knownProviders: () => KNOWN }).init();
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

test("validation: coordinator seat is not removable and members must be known providers", async () => {
  const { root, store } = await fixture();
  try {
    await assert.rejects(() => store.create({ name: "无主脑", members: ["codex-technical"] }), { code: "VALIDATION_FAILED" });
    await assert.rejects(() => store.create({ name: "幽灵成员", members: ["claude-fable", "gpt-99"] }), { code: "VALIDATION_FAILED" });
    await assert.rejects(() => store.create({ name: "", members: ["claude-fable"] }), { code: "VALIDATION_FAILED" });
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

test("coordinator: defaults to claude, must be a CLI-capable member", async () => {
  const { root, store } = await fixture();
  try {
    const team = await store.create({ name: "默认主脑队", members: ["claude-fable", "codex-technical"] });
    assert.equal(team.coordinator, "claude-fable", "coordinator defaults to claude");
    const codexLed = await store.create({ name: "Codex 主脑队", coordinator: "codex-technical", members: ["claude-fable", "codex-technical"] });
    assert.equal(codexLed.coordinator, "codex-technical");
    // 主脑必须是成员
    await assert.rejects(
      () => store.create({ name: "主脑不在队", coordinator: "grok-build", members: ["claude-fable"] }),
      { code: "VALIDATION_FAILED" },
    );
    // grok-search 无独立 CLI 会话，不可任主脑
    await assert.rejects(
      () => store.create({ name: "MCP 当主脑", coordinator: "grok-search", members: ["claude-fable", "grok-search"] }),
      { code: "VALIDATION_FAILED" },
    );
    assert.equal(BUILTIN_TEAM.coordinator, "claude-fable", "builtin team is claude-led");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
