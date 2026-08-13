import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SearchService } from "../src/search.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

async function seedRepo(t) {
  const root = await mkdtemp(resolve(appRoot, ".test-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const aiShared = join(root, ".ai-shared");
  await mkdir(join(aiShared, "handoff"), { recursive: true });
  await writeFile(
    join(aiShared, "handoff", "claude-to-codex__路由治理__20260720-1015.md"),
    "# 路由治理交接\n\nroute-gate 的 reason 标签统一为小写。\n",
    "utf8",
  );
  await writeFile(
    join(aiShared, "handoff", "codex-to-claude__drift__20260721-0930.md"),
    "# 漂移检查\n\n正文里提到一次路由漂移案例，供搜索命中正文。\n",
    "utf8",
  );
  await writeFile(join(aiShared, "context.md"), "# 上下文\n\n## 路由\n\n当前路由主协调为 claude。\n", "utf8");
  await writeFile(join(aiShared, "decisions.md"), "# 决策\n\n## D1 路由策略\n\n双地落同步。\n", "utf8");
  await writeFile(join(root, "MEMORY.md"), "# 项目记忆\n\n路由相关长期记忆。\n", "utf8");
  await mkdir(join(root, "apps", "demo"), { recursive: true });
  await writeFile(join(root, "apps", "demo", "MEMORY.md"), "# demo 记忆\n\n与路由无关的记录。\n", "utf8");
  await writeFile(
    join(root, "module.yaml"),
    "skills:\n  - code: co-review\n    path: .agents/skills/co-review\n    description: \"烛的四节深度评审入口\"\n  - code: router-helper\n    path: skills/orchestration/router-helper\n    description: \"路由辅助 skill\"\n",
    "utf8",
  );
  return { root, aiShared };
}

function fakeSessions(sources) {
  return {
    async list() {
      return { includeSummaries: false, sources };
    },
  };
}

test("search groups hits across handoff/doc/memory/skill and ranks title hits first", async (t) => {
  const { root, aiShared } = await seedRepo(t);
  const service = new SearchService({
    repoRoot: root,
    aiSharedRoot: aiShared,
    sessions: fakeSessions([
      {
        source: "claude",
        sessions: [{ id: "s1", label: "路由评审会话", summary: "", modifiedAt: "2026-07-24T10:00:00Z" }],
      },
    ]),
  });
  const result = await service.search({ query: "路由" });
  assert.equal(result.query, "路由");
  const kinds = result.groups.map((group) => group.kind);
  for (const expected of ["session", "handoff", "memory", "doc", "skill"]) assert.ok(kinds.includes(expected), `missing group ${expected}`);
  for (const group of result.groups) {
    for (const item of group.items) {
      assert.ok(item.id && item.title && typeof item.snippet === "string" && item.ref && item.score > 0);
    }
  }
  // 标题命中（handoff 路由治理 / session 路由评审）必须排在纯正文命中（drift 文件）之前
  const handoff = result.groups.find((group) => group.kind === "handoff");
  const titleHit = handoff.items.find((item) => item.ref.includes("路由治理"));
  const bodyHit = handoff.items.find((item) => item.ref.includes("drift"));
  assert.ok(titleHit && bodyHit, "expected both a title hit and a body-only hit");
  assert.ok(titleHit.score > bodyHit.score, `title hit ${titleHit.score} should outrank body hit ${bodyHit.score}`);
  // 组序遵循契约枚举序
  assert.deepEqual(kinds, [...kinds].sort((a, b) => ["session", "handoff", "memory", "doc", "skill"].indexOf(a) - ["session", "handoff", "memory", "doc", "skill"].indexOf(b)));
});

test("search returns empty groups for empty query and honors limit", async (t) => {
  const { root, aiShared } = await seedRepo(t);
  const service = new SearchService({ repoRoot: root, aiSharedRoot: aiShared, sessions: null });
  assert.deepEqual(await service.search({ query: "" }), { query: "", groups: [] });
  assert.deepEqual(await service.search({ query: "   " }), { query: "   ", groups: [] });
  const limited = await service.search({ query: "路由", limit: 1 });
  const total = limited.groups.reduce((sum, group) => sum + group.items.length, 0);
  assert.equal(total, 1);
});

test("search degrades gracefully when the session provider fails", async (t) => {
  const { root, aiShared } = await seedRepo(t);
  const service = new SearchService({
    repoRoot: root,
    aiSharedRoot: aiShared,
    sessions: { async list() { throw new Error("scan failed"); } },
  });
  const result = await service.search({ query: "路由" });
  assert.ok(result.groups.length > 0);
  assert.ok(!result.groups.some((group) => group.kind === "session"));
});

test("search serves the file corpus from cache on warm queries", async (t) => {
  const { root, aiShared } = await seedRepo(t);
  const service = new SearchService({ repoRoot: root, aiSharedRoot: aiShared, sessions: null });
  const first = await service.search({ query: "路由" });
  const second = await service.search({ query: "路由" });
  assert.deepEqual(second.groups, first.groups);
});
