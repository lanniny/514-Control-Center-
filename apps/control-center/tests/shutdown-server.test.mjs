import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnTestServer, stopTestServer, waitForUrl } from "./server-fixture.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

async function api(origin, token, path, { method = "GET", body } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json().catch(() => null) };
}

function exited(child) {
  return child.exitCode != null || child.signalCode != null;
}

async function waitForValue(read, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  assert.fail(message);
}

async function waitForExit(child, timeoutMs = 10_000) {
  if (exited(child)) return { code: child.exitCode, signal: child.signalCode };
  return await new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      rejectExit(new Error(`server did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    };
    child.once("exit", onExit);
  });
}

test("真实 server：shutdown incomplete 后原端口与 token 恢复，修复故障后第二次关闭成功退出", { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-shutdown-server-"));
  const dataRoot = join(root, "data");
  const runtimeHome = join(root, "home");
  const token = "shutdown-retry-e2e-token";
  let upstreamHits = 0;
  const upstream = createServer((request, response) => {
    upstreamHits += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: "shutdown-forward-ok",
      type: "message",
      role: "assistant",
      model: "claude-test",
      content: [{ type: "text", text: "shutdown proxy is still usable" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
  await new Promise((resolveListen) => upstream.listen(0, "127.0.0.1", resolveListen));
  const upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
  await mkdir(runtimeHome, { recursive: true });
  const child = spawnTestServer({
    env: {
      CONTROL_CENTER_TOKEN: token,
      CONTROL_CENTER_DATA_DIR: dataRoot,
      CONTROL_CENTER_RUNTIME_HOME: runtimeHome,
      CONTROL_CENTER_PORT: "0",
    },
  });
  const sidecarPath = join(dataRoot, "ccswitch-proxy.json");
  const savedSidecarPath = `${sidecarPath}.saved-by-test`;
  t.after(async () => {
    if (!exited(child)) {
      try {
        await access(savedSidecarPath);
        await rm(sidecarPath, { recursive: true, force: true });
        await rename(savedSidecarPath, sidecarPath);
      } catch {}
      await stopTestServer(child, { token }).catch(() => {});
    }
    await new Promise((resolveClose) => {
      upstream.close(resolveClose);
      upstream.closeAllConnections?.();
    });
    await rm(root, { recursive: true, force: true });
  });

  const origin = new URL(await waitForUrl(child)).origin;
  const created = await api(origin, token, "/api/providers", {
    method: "POST",
    body: {
      name: "Shutdown restore provider",
      baseUrl: upstreamOrigin,
      apiKey: "shutdown-provider-key",
      apps: { claude: true },
      models: { claude: { model: "claude-test" } },
    },
  });
  assert.equal(created.response.status, 201);
  const switched = await api(origin, token, "/api/providers/switch", {
    method: "POST",
    body: { app: "claude", providerId: created.payload.id },
  });
  assert.equal(switched.response.status, 200);
  assert.equal((await api(origin, token, "/api/ccswitch/proxy/config", {
    method: "PUT",
    body: { listenPort: 0 },
  })).response.status, 200);
  const started = await api(origin, token, "/api/ccswitch/proxy/start", { method: "POST", body: {} });
  assert.equal(started.response.status, 200);
  const proxyOrigin = started.payload.status.origin;
  const takeover = await api(origin, token, "/api/ccswitch/proxy/takeover/claude", {
    method: "PUT",
    body: { enabled: true },
  });
  assert.equal(takeover.response.status, 200);

  const settingsPath = join(runtimeHome, ".claude", "settings.json");
  assert.equal(JSON.parse(await readFile(settingsPath, "utf8")).env.ANTHROPIC_BASE_URL, `${proxyOrigin}/claude`);
  await rename(sidecarPath, savedSidecarPath);
  await mkdir(sidecarPath);

  const firstShutdown = await api(origin, token, "/api/test/shutdown", { method: "POST" });
  assert.equal(firstShutdown.response.status, 202);
  const reopened = await waitForValue(async () => {
    const status = await api(origin, token, "/api/ccswitch/proxy/status");
    return status.response.status === 200 ? status : null;
  }, "Control Center did not reopen its original HTTP port after incomplete shutdown");
  assert.equal(reopened.payload.status.running, true);
  assert.equal(reopened.payload.status.takeover.claude, true);
  assert.equal((await fetch(`${origin}/api/ccswitch/proxy/status`)).status, 401);
  const liveSettings = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.equal(liveSettings.env.ANTHROPIC_BASE_URL, `${proxyOrigin}/claude`);
  assert.equal((await fetch(`${proxyOrigin}/claude/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  })).status, 401);
  const forwarded = await fetch(`${proxyOrigin}/claude/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": liveSettings.env.ANTHROPIC_AUTH_TOKEN,
    },
    body: JSON.stringify({ model: "claude-test", max_tokens: 4, messages: [{ role: "user", content: "ping" }] }),
  });
  assert.equal(forwarded.status, 200);
  assert.equal((await forwarded.json()).content[0].text, "shutdown proxy is still usable");
  assert.equal(upstreamHits, 1);

  await rm(sidecarPath, { recursive: true, force: true });
  await rename(savedSidecarPath, sidecarPath);
  const secondShutdown = await api(origin, token, "/api/test/shutdown", { method: "POST" });
  assert.equal(secondShutdown.response.status, 202);
  const exit = await waitForExit(child);
  assert.equal(exit.code, 0);
  assert.equal(exit.signal, null);
  assert.equal(
    JSON.parse(await readFile(settingsPath, "utf8")).env.ANTHROPIC_BASE_URL,
    upstreamOrigin,
  );
});
