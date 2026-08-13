import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnTestServer, stopTestServer, testModelProfiles, waitForUrl } from "./server-fixture.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

// PUT/GET /api/projects/prefs —— 会话级偏好（pinned/archived/unread/alias）随项目偏好同文件持久化。
// 独立临时 repoRoot：instance-lock 按 repoRoot/.ai-shared/control-center 落锁，避开 dev server。
test("project prefs endpoint persists session-level prefs with sanitization", { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-prefs-"));
  const repoRoot = resolve(root, "repo");
  const dataRoot = resolve(root, "data");
  const fakeHome = resolve(root, "home");
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
  const projectDir = resolve(fakeHome, ".claude/projects/cache-project");
  await mkdir(projectDir, { recursive: true });
  await writeFile(resolve(projectDir, "first.jsonl"), `${JSON.stringify({ cwd: "I:\\cache-project", message: { role: "user", content: "first" } })}\n`, "utf8");
  const token = "prefs-token-0123456789abcdef";
  const child = spawnTestServer({
    env: {
      CONTROL_CENTER_TOKEN: token,
      CONTROL_CENTER_REPO_ROOT: repoRoot,
      CONTROL_CENTER_DATA_DIR: dataRoot,
      CONTROL_CENTER_PORT: "0",
      HOME: fakeHome,
      USERPROFILE: fakeHome,
    },
  });
  t.after(async () => {
    await stopTestServer(child, { token });
    await rm(root, { recursive: true, force: true });
  });

  const baseUrl = new URL(await waitForUrl(child));
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const firstProjects = await (await fetch(new URL("/api/sessions/projects", baseUrl), { headers: auth })).json();
  assert.equal(firstProjects.projects[0].sessionCount, 1);
  await writeFile(resolve(projectDir, "second.jsonl"), `${JSON.stringify({ cwd: "I:\\cache-project", message: { role: "user", content: "second" } })}\n`, "utf8");
  const cachedProjects = await (await fetch(new URL("/api/sessions/projects", baseUrl), { headers: auth })).json();
  assert.equal(cachedProjects.projects[0].sessionCount, 1, "normal HTTP call uses the short project snapshot");
  const refreshedProjects = await (await fetch(new URL("/api/sessions/projects?refresh=1", baseUrl), { headers: auth })).json();
  assert.equal(refreshedProjects.projects[0].sessionCount, 2, "refresh=1 bypasses the cached snapshot through the server route");

  // 空库 GET：回默认空映射（向后兼容旧文件）
  const empty = await (await fetch(new URL("/api/projects/prefs", baseUrl), { headers: auth })).json();
  assert.deepEqual(empty, { revision: 0, projects: {}, sessions: {} });

  // PUT 带 sessions + 噪声字段：应只保留白名单键
  const put = await fetch(new URL("/api/projects/prefs", baseUrl), {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      baseRevision: empty.revision,
      projects: { "i:/514claude/514cc": { pinned: true, name: "主仓", teamId: "team-514cc", evil: "<script>" } },
      sessions: {
        "-Users-lo--proj::abc-123": { pinned: true, unread: true, alias: "排查 API 密钥", teamId: "team-514cc", junk: 1 },
        "bad-entry": "not-an-object",
        "-Users-lo--proj::def-456": { archived: true },
      },
    }),
  });
  assert.equal(put.status, 200);
  const saved = await put.json();
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.projects["i:/514claude/514cc"], { pinned: true, name: "主仓", teamId: "team-514cc" });
  assert.deepEqual(saved.sessions["-Users-lo--proj::abc-123"], { pinned: true, unread: true, alias: "排查 API 密钥", teamId: "team-514cc" });
  assert.deepEqual(saved.sessions["-Users-lo--proj::def-456"], { archived: true });
  assert.equal(saved.sessions["bad-entry"], undefined);

  // GET 回读：磁盘已持久化且内容一致
  const reread = await (await fetch(new URL("/api/projects/prefs", baseUrl), { headers: auth })).json();
  assert.deepEqual(reread, saved);

  // 两个标签页从同一 revision 并发保存：只能有一个提交成功，另一个必须显式 409，不能静默后写覆盖。
  const contenders = ["标签页 A", "标签页 B"].map((name) => fetch(new URL("/api/projects/prefs", baseUrl), {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      baseRevision: reread.revision,
      projects: { "i:/514claude/514cc": { pinned: true, name } },
      sessions: reread.sessions,
    }),
  }));
  const responses = await Promise.all(contenders);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const winnerIndex = responses.findIndex((response) => response.status === 200);
  const loserIndex = 1 - winnerIndex;
  const winner = await responses[winnerIndex].json();
  const conflict = await responses[loserIndex].json();
  assert.equal(winner.revision, 2);
  assert.equal(conflict.error.code, "PREFS_REVISION_MISMATCH");
  assert.equal(conflict.error.currentRevision, 2);
  assert.deepEqual(await (await fetch(new URL("/api/projects/prefs", baseUrl), { headers: auth })).json(), winner);
  assert.deepEqual((await readdir(dataRoot)).filter((name) => name.endsWith(".tmp")), [], "atomic writes clean their unique temp files");

  // 只有 ENOENT 可退化为空库；损坏 JSON 必须显式失败，阻止客户端拿假空快照覆盖真值。
  await writeFile(resolve(dataRoot, "project-prefs.json"), "{broken-json\n", "utf8");
  const corrupt = await fetch(new URL("/api/projects/prefs", baseUrl), { headers: auth });
  assert.equal(corrupt.status, 500);
  assert.equal((await corrupt.json()).error.code, "PREFS_CORRUPT");
  const refusedOverwrite = await fetch(new URL("/api/projects/prefs", baseUrl), {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ baseRevision: 2, projects: {}, sessions: {} }),
  });
  assert.equal(refusedOverwrite.status, 500);
  assert.equal((await refusedOverwrite.json()).error.code, "PREFS_CORRUPT", "a corrupt document is never treated as an empty overwrite base");
});
