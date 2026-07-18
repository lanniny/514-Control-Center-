import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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

test("custom teams survive a control-plane restart through the real assembly path", { timeout: 90_000 }, async (t) => {
  // 烛 R11 致命回归防线：knownProviders 在 TeamStore.init() 期间求值——任何装配时序错误
  // （如 TDZ）都会让重启后的自定义团队被静默拒载。必须踩 createControlCenter 真实装配路径。
  const dataRoot = await mkdtemp(resolve(appRoot, ".test-teams-e2e-"));
  const token = "e2e-teams-token-0123456789";
  const env = { ...process.env, CONTROL_CENTER_TOKEN: token, CONTROL_CENTER_DATA_DIR: dataRoot, CONTROL_CENTER_PORT: "0" };
  const spawnServer = () =>
    spawn(process.execPath, [resolve(appRoot, "server.mjs")], { cwd: appRoot, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const stop = async (child) => {
    if (child.exitCode == null) {
      child.kill();
      await new Promise((resolveExit) => child.once("exit", resolveExit));
    }
  };
  let child = spawnServer();
  t.after(async () => {
    await stop(child);
    await rm(dataRoot, { recursive: true, force: true });
  });
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const firstOrigin = new URL(await waitForUrl(child)).origin;
  const created = await fetch(`${firstOrigin}/api/teams`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: "重启存续队", members: ["claude-fable", "codex-technical"], skills: ["co-review"] }),
  });
  assert.equal(created.status, 201);
  const team = await created.json();

  await stop(child);
  child = spawnServer();
  const secondOrigin = new URL(await waitForUrl(child)).origin;
  const listed = await fetch(`${secondOrigin}/api/teams`, { headers: auth });
  assert.equal(listed.status, 200);
  const payload = await listed.json();
  assert.ok(
    payload.teams.some((item) => item.id === team.id && item.name === "重启存续队"),
    "custom team must survive restart via the real assembly path",
  );
  assert.deepEqual(payload.rejectedOnLoad, [], "no records may be silently rejected on load");
});

// timeout 120s：瓶颈是 CLI 健康探测冷启动（bootstrap/preview/dry-run 各 25-30s+），
// 高系统负载下 60s 线稳定超时——实测三端点计时定位，非业务回归（2026-07-17）
test("loopback API enforces bearer auth and supports the operator workflow", { timeout: 120_000 }, async (t) => {
  const dataRoot = await mkdtemp(resolve(appRoot, ".test-http-"));
  const token = "e2e-control-token-0123456789";
  const child = spawn(process.execPath, [resolve(appRoot, "server.mjs")], {
    cwd: appRoot,
    env: { ...process.env, CONTROL_CENTER_TOKEN: token, CONTROL_CENTER_DATA_DIR: dataRoot, CONTROL_CENTER_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode == null) {
      child.kill();
      await new Promise((resolveExit) => child.once("exit", resolveExit));
    }
    await rm(dataRoot, { recursive: true, force: true });
  });

  const printedUrl = await waitForUrl(child);
  const url = new URL(printedUrl);
  assert.equal(url.hash, `#token=${token}`);
  const origin = url.origin;
  const auth = { Authorization: `Bearer ${token}` };

  const favicon = await fetch(`${origin}/favicon.ico`);
  assert.equal(favicon.status, 204);

  const unauthorized = await fetch(`${origin}/api/bootstrap?token=${encodeURIComponent(token)}`);
  assert.equal(unauthorized.status, 401);

  const bootstrapResponse = await fetch(`${origin}/api/bootstrap`, { headers: auth });
  assert.equal(bootstrapResponse.status, 200);
  const bootstrap = await bootstrapResponse.json();
  assert.ok(bootstrap.providers.some((profile) => profile.id === "claude-fable"));
  assert.ok(bootstrap.sources.some((source) => source.id === "control.routing"));
  assert.ok(bootstrap.security.secrets.some((item) => item.id === "grok-search-env" && typeof item.configured === "boolean"));

  const reload = await fetch(`${origin}/api/runtime/reload`, { method: "POST", headers: auth });
  assert.equal(reload.status, 200);
  const reloaded = await reload.json();
  assert.equal(reloaded.status, "reloaded");
  assert.equal(reloaded.generation, 2);

  const configResponse = await fetch(`${origin}/api/config/core.readme`, { headers: auth });
  const config = await configResponse.json();
  assert.equal(config.sha256.length, 64);
  const validate = await fetch(`${origin}/api/config/core.readme/validate`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ content: config.content }),
  });
  assert.equal(validate.status, 200);
  assert.equal((await validate.json()).valid, true);
  const plan = await fetch(`${origin}/api/config/core.readme/plan`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ content: config.content, baseSha256: config.sha256 }),
  });
  const planned = await plan.json();
  assert.equal(plan.status, 200);
  assert.ok(planned.planId);

  const schemaValidation = await fetch(`${origin}/api/config/control.routing/validate`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ content: '{"version":1}' }),
  });
  assert.equal(schemaValidation.status, 200);
  const schemaResult = await schemaValidation.json();
  assert.equal(schemaResult.valid, false);
  assert.equal(schemaResult.parser, "python-jsonschema");

  const route = await fetch(`${origin}/api/router/preview`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "实现并验证控制面", taskType: "coding", risk: "high" }),
  });
  const routed = await route.json();
  assert.equal(route.status, 200);
  assert.equal(routed.selected.id, "codex-technical");
  assert.equal(routed.independent.id, "claude-fable");

  const dryRun = await fetch(`${origin}/api/runs`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "规划一个只读核验", taskType: "planning", execute: false, permissionMode: "plan" }),
  });
  assert.equal(dryRun.status, 202);
  assert.equal((await dryRun.json()).status, "succeeded");

  const controller = new AbortController();
  const events = await fetch(`${origin}/api/events?after=0`, { headers: auth, signal: controller.signal });
  assert.equal(events.status, 200);
  assert.match(events.headers.get("content-type"), /text\/event-stream/);
  const first = await events.body.getReader().read();
  assert.match(new TextDecoder().decode(first.value), /event: ready/);
  controller.abort();
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));
  const afterDisconnect = await fetch(`${origin}/api/health`, { headers: auth });
  assert.equal(afterDisconnect.status, 200);
});
