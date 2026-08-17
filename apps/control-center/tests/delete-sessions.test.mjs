import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnTestServer, stopTestServer, testModelProfiles, waitForUrl } from "./server-fixture.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// POST /api/projects/delete-sessions —— 移除项目时的可选同步删除：
// Claude 项目目录整移、codex rollout 按归一化 cwd 精确匹配，全部进 dataRoot/trash 隔离区（可恢复）。
test("delete-sessions quarantines claude dir and cwd-matched codex rollouts", { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-delsess-"));
  const repoRoot = resolve(root, "repo");
  const dataRoot = resolve(root, "data");
  const homeRoot = resolve(root, "home");
  const projectCwd = "I:\\test\\delsess-proj";
  const otherCwd = "I:\\test\\delsess-other";

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
    version: 1, defaultMode: "plan",
    modes: { plan: { write: false, approvalRequired: false }, build: { write: "workspace", approvalRequired: true } },
    limits: { maxRounds: 6, maxBudgetUsdPerTurn: 2, turnTimeoutMs: 10_000 }, approval: { ttlMs: 60_000 },
  }));
  await writeFile(resolve(repoRoot, "config/control-center/sources.json"), JSON.stringify({ version: 1, explicit: [], discover: [], runtime: [] }));

  // 假 home：claude 项目目录 + 两个 codex rollout（一个 cwd 命中、一个旁观）
  const claudeDir = resolve(homeRoot, ".claude/projects/I--test-delsess-proj");
  await mkdir(claudeDir, { recursive: true });
  await writeFile(resolve(claudeDir, "aaaa1111-2222-3333-4444-555566667777.jsonl"), '{"cwd":"I:\\\\test\\\\delsess-proj"}\n');
  const codexDir = resolve(homeRoot, ".codex/sessions/2026/07/18");
  await mkdir(codexDir, { recursive: true });
  const rollout = (id, cwd) =>
    `${JSON.stringify({ timestamp: "2026-07-18T13:30:07.714Z", type: "session_meta", payload: { id, cwd, originator: "codex_cli_rs" } })}\n`;
  await writeFile(resolve(codexDir, "rollout-2026-07-18T21-30-02-019f756b-5a3e-79e1-919a-c4502d6c1517.jsonl"), rollout("019f756b-5a3e-79e1-919a-c4502d6c1517", projectCwd));
  await writeFile(resolve(codexDir, "rollout-2026-07-18T22-40-03-029f756b-5a3e-79e1-919a-c4502d6c2999.jsonl"), rollout("029f756b-5a3e-79e1-919a-c4502d6c2999", otherCwd));

  const token = "delsess-token-0123456789abc";
  const child = spawnTestServer({
    env: {
      CONTROL_CENTER_TOKEN: token,
      CONTROL_CENTER_REPO_ROOT: repoRoot,
      CONTROL_CENTER_DATA_DIR: dataRoot,
      CONTROL_CENTER_PORT: "0",
      USERPROFILE: homeRoot,
      HOME: homeRoot,
    },
  });
  t.after(async () => {
    await stopTestServer(child, { token });
    await rm(root, { recursive: true, force: true });
  });

  const baseUrl = new URL(await waitForUrl(child));
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const response = await fetch(new URL("/api/projects/delete-sessions", baseUrl), {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ project: "I--test-delsess-proj", path: projectCwd }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.claudeRemoved, true);
  assert.equal(result.codexRemoved, 1);
  assert.ok(result.trash);
  const sourceStatus = Object.fromEntries(result.sources.map((source) => [source.source, source]));
  assert.deepEqual(
    Object.fromEntries(Object.entries(sourceStatus).map(([source, status]) => [source, status.supported])),
    // 12 源全部显式列出：未支持删除的源如实报 supported:false，不再静默遗漏
    { claude: true, codex: true, cursor: false, kimi: false, pi: false, bridge: false, grok: false, opencode: false, cline: false, openclaw: false, hermes: false, codebuddy: false },
  );
  assert.equal(sourceStatus.codex.remaining, 0);
  assert.deepEqual(sourceStatus.codex.limitations, []);

  // 系统目录已清空
  assert.equal(await exists(claudeDir), false);
  assert.equal(await exists(resolve(codexDir, "rollout-2026-07-18T21-30-02-019f756b-5a3e-79e1-919a-c4502d6c1517.jsonl")), false);
  // 旁观 rollout（不同 cwd）纹丝不动
  assert.equal(await exists(resolve(codexDir, "rollout-2026-07-18T22-40-03-029f756b-5a3e-79e1-919a-c4502d6c2999.jsonl")), true);
  // 隔离区可恢复：claude 目录与 codex 文件都在 trash 下
  const trashClaude = await readdir(resolve(result.trash, "claude-projects"));
  assert.deepEqual(trashClaude, ["I--test-delsess-proj"]);
  const trashCodex = await readdir(resolve(result.trash, "codex/2026/07/18"));
  assert.deepEqual(trashCodex, ["rollout-2026-07-18T21-30-02-019f756b-5a3e-79e1-919a-c4502d6c1517.jsonl"]);
});
