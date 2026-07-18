import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

function waitForUrl(child) {
  return new Promise((resolveUrl, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`server startup timed out: ${output}`)), 20_000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      const match = output.match(/514cc Control Center: (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolveUrl(match[1]);
      }
    });
    child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}: ${output}`));
    });
  });
}

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
    profiles: [
      { id: "claude-fable", label: "Fable", role: "primary-coordinator", provider: "anthropic", adapter: "claude-stream-json", command: "claude", model: "fable" },
      { id: "codex-technical", label: "Codex", role: "technical-executor", provider: "openai", adapter: "codex-app-server", command: "codex", model: "gpt-5" },
    ],
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
  const child = spawn(process.execPath, [resolve(appRoot, "server.mjs")], {
    cwd: appRoot,
    env: {
      ...process.env,
      CONTROL_CENTER_TOKEN: token,
      CONTROL_CENTER_REPO_ROOT: repoRoot,
      CONTROL_CENTER_DATA_DIR: dataRoot,
      CONTROL_CENTER_PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode == null) {
      child.kill();
      await new Promise((resolveExit) => child.once("exit", resolveExit));
    }
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
