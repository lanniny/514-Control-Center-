import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnTestServer, stopTestServer, testModelProfiles, waitForUrl } from "./server-fixture.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

// GET /api/config/:id/versions/:versionId/content —— 回滚预览端点（W1B）。
// 独立临时 repoRoot：instance-lock 按 repoRoot/.ai-shared/control-center 落锁，避开 5140 dev server。
test("config version content endpoint serves the stored version text over HTTP", { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-version-content-"));
  const repoRoot = resolve(root, "repo");
  const dataRoot = resolve(root, "data");
  await mkdir(resolve(repoRoot, "config/control-center"), { recursive: true });
  await writeFile(resolve(repoRoot, "config/app.json"), '{"enabled":true}\n');
  await writeFile(resolve(repoRoot, "config/control-center/models.json"), JSON.stringify({
    version: 1,
    profiles: testModelProfiles(),
  }));
  await writeFile(resolve(repoRoot, "config/control-center/routing.json"), JSON.stringify({
    version: 1, primaryCoordinator: "claude-fable", technicalExecutor: "codex-technical", rules: [],
  }));
  await writeFile(resolve(repoRoot, "config/control-center/permissions.json"), JSON.stringify({
    version: 1,
    defaultMode: "plan",
    modes: { plan: { write: false, approvalRequired: false }, build: { write: "workspace", approvalRequired: true } },
    limits: { maxRounds: 6, maxBudgetUsdPerTurn: 2, turnTimeoutMs: 10_000 },
    approval: { ttlMs: 60_000 },
  }));
  await writeFile(resolve(repoRoot, "config/control-center/sources.json"), JSON.stringify({
    version: 1,
    explicit: [{ id: "app.settings", path: "config/app.json", label: "App Settings", kind: "json", scope: "repo", critical: false }],
    discover: [],
    runtime: [],
  }));
  const token = "version-content-token-0123456789";
  const child = spawnTestServer({
    env: {
      CONTROL_CENTER_TOKEN: token,
      CONTROL_CENTER_REPO_ROOT: repoRoot,
      CONTROL_CENTER_DATA_DIR: dataRoot,
      CONTROL_CENTER_PORT: "0",
    },
  });
  t.after(async () => {
    await stopTestServer(child, { token });
    await rm(root, { recursive: true, force: true });
  });
  const origin = new URL(await waitForUrl(child)).origin;
  const auth = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { ...auth, "Content-Type": "application/json" };

  // 鉴权：缺 bearer → 401（/api 全局检查，同其他 config 路由）
  const unauthorized = await fetch(`${origin}/api/config/app.settings/versions/whatever/content`);
  assert.equal(unauthorized.status, 401);

  // 造一个已提交版本：read → plan → apply（critical=false 无需 confirmation）
  const read = await (await fetch(`${origin}/api/config/app.settings`, { headers: auth })).json();
  const updated = '{"enabled":false}\n';
  const planned = await (await fetch(`${origin}/api/config/app.settings/plan`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ content: updated, baseSha256: read.sha256 }),
  })).json();
  const applied = await fetch(`${origin}/api/config/app.settings/apply`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ content: updated, baseSha256: read.sha256, planId: planned.planId }),
  });
  assert.equal(applied.status, 200);

  const versionsPayload = await (await fetch(`${origin}/api/config/app.settings/versions`, { headers: auth })).json();
  assert.equal(versionsPayload.versions.length, 1);
  const versionId = versionsPayload.versions[0].versionId;

  //  happy path：返回该版本原文（= apply 前的文件内容）
  const preview = await fetch(`${origin}/api/config/app.settings/versions/${encodeURIComponent(versionId)}/content`, { headers: auth });
  assert.equal(preview.status, 200);
  const body = await preview.json();
  assert.equal(body.content, read.content);
  assert.equal(body.sha256, read.sha256);
  assert.equal(body.versionId, versionId);
  assert.equal(body.id, "app.settings");
  assert.equal(body.path, "config/app.json");

  // 错误码：版本不存在 → 404 VERSION_NOT_FOUND；配置源不存在 → 404 SOURCE_NOT_FOUND
  const missing = await fetch(`${origin}/api/config/app.settings/versions/no-such-version/content`, { headers: auth });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "VERSION_NOT_FOUND");
  const missingSource = await fetch(`${origin}/api/config/no.such/versions/x/content`, { headers: auth });
  assert.equal(missingSource.status, 404);
  assert.equal((await missingSource.json()).error.code, "SOURCE_NOT_FOUND");
});
