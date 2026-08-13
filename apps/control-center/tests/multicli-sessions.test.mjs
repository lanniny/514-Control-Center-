import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnTestServer, stopTestServer, testModelProfiles, waitForUrl } from "./server-fixture.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

// 多 CLI 项目树（2026-07-19 LO 需求）：~/.codex/sessions rollout 按 session_meta.cwd 归并进项目树，
// codex-only cwd 合成新项目；/api/sessions/preview?source=codex 解析 response_item 消息骨架。
// 临时 USERPROFILE 重定向 homedir()，不碰真实会话存储；临时 repoRoot 避开 dev server 实例锁。
test("projects tree merges codex rollouts by cwd and previews them", { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-multicli-"));
  const repoRoot = resolve(root, "repo");
  const dataRoot = resolve(root, "data");
  const homeRoot = resolve(root, "home");
  const projectCwd = "I:\\test\\multicli-proj";
  const codexScope = "2026/07/18";
  const codexId = "rollout-2026-07-18T21-30-02-019f756b-5a3e-79e1-919a-c4502d6c1517";

  await mkdir(resolve(repoRoot, "config/control-center"), { recursive: true });
  await writeFile(resolve(repoRoot, "config/app.json"), '{"enabled":true}\n');
  await writeFile(resolve(repoRoot, "config/control-center/models.json"), JSON.stringify({
    version: 1,
    profiles: testModelProfiles(),
  }));
  await writeFile(resolve(repoRoot, "config/control-center/routing.json"), JSON.stringify({
    version: 1, primaryCoordinator: "claude-fable", technicalExecutor: "claude-fable", rules: [],
  }));
  await writeFile(resolve(repoRoot, "config/control-center/permissions.json"), JSON.stringify({
    version: 1,
    defaultMode: "plan",
    modes: { plan: { write: false, approvalRequired: false }, build: { write: "workspace", approvalRequired: true } },
    limits: { maxRounds: 6, maxBudgetUsdPerTurn: 2, turnTimeoutMs: 10_000 },
    approval: { ttlMs: 60_000 },
  }));
  await writeFile(resolve(repoRoot, "config/control-center/sources.json"), JSON.stringify({
    version: 1, explicit: [], discover: [], runtime: [],
  }));

  // 假 home：claude 项目（cwd 与 codex 相同 → 应合并）+ codex rollout ×1
  await mkdir(resolve(homeRoot, ".claude/projects/I--test-multicli-proj"), { recursive: true });
  await writeFile(
    resolve(homeRoot, ".claude/projects/I--test-multicli-proj/aaaa1111-2222-3333-4444-555566667777.jsonl"),
    `${JSON.stringify({ cwd: projectCwd, message: { role: "user", content: "claude 侧问题" }, timestamp: "2026-07-18T10:00:00.000Z" })}\n`,
  );
  await mkdir(resolve(homeRoot, ".codex/sessions", ...codexScope.split("/")), { recursive: true });
  const rolloutLines = [
    { timestamp: "2026-07-18T13:30:07.714Z", type: "session_meta", payload: { id: "019f756b-5a3e-79e1-919a-c4502d6c1517", cwd: projectCwd, originator: "codex_cli_rs" } },
    { timestamp: "2026-07-18T13:30:07.715Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions for X\n\n<INSTRUCTIONS>\n不应出现\n" }] } },
    { timestamp: "2026-07-18T13:30:08.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "排查 API 密钥总额度缺失" }] } },
    { timestamp: "2026-07-18T13:30:19.747Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "我先沿着额度统计链路查。" }] } },
    { timestamp: "2026-07-18T13:30:19.748Z", type: "event_msg", payload: { type: "user_message", message: "排查 API 密钥总额度缺失" } },
  ];
  await writeFile(
    resolve(homeRoot, ".codex/sessions", ...codexScope.split("/"), `${codexId}.jsonl`),
    `${rolloutLines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
  // 两个中文 cwd 的合成项目：slug 化会塌缩成同一个词，id 必须靠散列区分（回归：LO 实测菜单串台）
  const chineseA = "rollout-2026-07-18T23-10-11-039f756b-5a3e-79e1-919a-c4502d6c3111";
  const chineseB = "rollout-2026-07-18T23-20-12-049f756b-5a3e-79e1-919a-c4502d6c4222";
  const metaLine = (id, cwd) => `${JSON.stringify({ timestamp: "2026-07-18T13:30:07.714Z", type: "session_meta", payload: { id, cwd, originator: "codex_cli_rs" } })}\n`;
  await writeFile(resolve(homeRoot, ".codex/sessions", ...codexScope.split("/"), `${chineseA}.jsonl`), metaLine("039f756b-5a3e-79e1-919a-c4502d6c3111", "G:\\learn\\数据结构"));
  await writeFile(resolve(homeRoot, ".codex/sessions", ...codexScope.split("/"), `${chineseB}.jsonl`), metaLine("049f756b-5a3e-79e1-919a-c4502d6c4222", "G:\\learn\\英语影视鉴赏"));

  const token = "multicli-token-0123456789ab";
  const child = spawnTestServer({
    env: {
      CONTROL_CENTER_TOKEN: token,
      CONTROL_CENTER_REPO_ROOT: repoRoot,
      CONTROL_CENTER_DATA_DIR: dataRoot,
      CONTROL_CENTER_PORT: "0",
      USERPROFILE: homeRoot, // homedir() 重定向（Windows）
      HOME: homeRoot,
    },
  });
  t.after(async () => {
    await stopTestServer(child, { token });
    await rm(root, { recursive: true, force: true });
  });

  const baseUrl = new URL(await waitForUrl(child));
  const auth = { authorization: `Bearer ${token}` };

  // 1) 项目树：claude 项目应携带 claude + codex 两条会话（同 cwd 合并）
  const tree = await (await fetch(new URL("/api/sessions/projects", baseUrl), { headers: auth })).json();
  assert.equal(tree.available, true);
  const merged = tree.projects.find((project) => project.path && project.path.replaceAll("/", "\\").toLowerCase() === projectCwd.toLowerCase());
  assert.ok(merged, `expected a project with path ${projectCwd}, got ${JSON.stringify(tree.projects.map((p) => p.path))}`);
  const clis = merged.sessions.map((session) => session.cli).sort();
  assert.deepEqual(clis, ["claude", "codex"]);
  const codexSession = merged.sessions.find((session) => session.cli === "codex");
  assert.equal(codexSession.id, codexId);
  assert.equal(codexSession.scope, codexScope);
  assert.equal(codexSession.label, "07-18 21:30");

  // 中文 cwd 合成项目：id 必须唯一且为 codex-<8hex>（slug 塌缩回归）
  const chineseProjects = tree.projects.filter((project) => project.path?.startsWith("G:\\learn\\"));
  assert.equal(chineseProjects.length, 2);
  const ids = chineseProjects.map((project) => project.id);
  assert.ok(ids.every((id) => /^codex-[0-9a-f]{8}$/.test(id)), `ids should be codex-<hex>: ${ids}`);
  assert.notEqual(ids[0], ids[1], "中文路径合成 id 不得碰撞");

  // 2) codex 预览：注入样板被剥、event_msg 镜像去重 → 恰好 user+assistant 两条
  const preview = await (
    await fetch(new URL(`/api/sessions/preview?source=codex&scope=${encodeURIComponent(codexScope)}&id=${encodeURIComponent(codexId)}`, baseUrl), { headers: auth })
  ).json();
  assert.equal(preview.source, "codex");
  assert.equal(preview.messages.length, 2);
  assert.equal(preview.messages[0].role, "user");
  assert.ok(preview.messages[0].text.includes("排查 API 密钥总额度缺失"));
  assert.equal(preview.messages[1].role, "assistant");
  assert.ok(preview.messages[1].text.includes("额度统计链路"));

  // 3) 遍历防护：scope 段拒绝 ".."（VALIDATION_FAILED → 422）
  const traversal = await fetch(new URL(`/api/sessions/preview?source=codex&scope=${encodeURIComponent("../..")}&id=${encodeURIComponent(codexId)}`, baseUrl), { headers: auth });
  assert.equal(traversal.status, 422);
});
