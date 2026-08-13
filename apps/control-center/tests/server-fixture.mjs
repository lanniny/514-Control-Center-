import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const serverUrls = new WeakMap();
const ownedServerPids = new WeakMap();

export function testModelProfiles() {
  return [
    { id: "claude-fable", label: "Fable", role: "primary-coordinator", provider: "anthropic", adapter: "claude-stream-json", command: "claude", model: "fable", capabilities: [], enabled: true },
    { id: "codex-technical", label: "Codex", role: "technical-executor", provider: "openai", adapter: "codex-app-server", command: "codex", model: null, capabilities: [], enabled: true },
    { id: "grok-search", label: "Grok Search", role: "current-intelligence", provider: "xai-compatible", adapter: "grok-mcp-via-codex-app-server", command: null, model: null, capabilities: [], enabled: true },
    { id: "grok-build", label: "Grok Build", role: "fast-executor", provider: "xai", adapter: "grok-build-headless", command: "grok", model: null, capabilities: [], enabled: true },
    { id: "kimi-frontend", label: "Kimi", role: "frontend-engineer", provider: "moonshot", adapter: "kimi-headless-resume", command: "kimi", model: null, capabilities: [], enabled: true },
    { id: "pi-resident", label: "Pi", role: "resident-agent", provider: "multi-provider", adapter: "pi-rpc", command: "pi", model: null, capabilities: [], enabled: true },
  ];
}

export function testServerEnv(overrides = {}) {
  return {
    ...process.env,
    ...overrides,
    CONTROL_CENTER_OPEN: "0",
    CONTROL_CENTER_TEST_MODE: "1",
  };
}

export function spawnTestServer({ env = {}, cwd = appRoot } = {}) {
  const child = spawn(process.execPath, [resolve(appRoot, "server.mjs")], {
    cwd,
    env: testServerEnv(env),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  ownedServerPids.set(child, child.pid);
  return child;
}

export function waitForUrl(child, { timeoutMs = 20_000 } = {}) {
  return new Promise((resolveUrl, reject) => {
    let output = "";
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const finish = (url) => {
      serverUrls.set(child, url);
      cleanup();
      child.stdout?.resume();
      child.stderr?.resume();
      resolveUrl(url);
    };
    const onStdout = (chunk) => {
      output += chunk.toString("utf8");
      const match = output.match(/514cc Control Center: (http:\/\/[^\s]+)/);
      if (match) finish(match[1]);
    };
    const onStderr = (chunk) => { output += chunk.toString("utf8"); };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`server exited ${code ?? signal}: ${output}`));
    };
    const onError = (error) => {
      cleanup();
      reject(new Error(`server failed to start: ${error.message}; ${output}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`server startup timed out: ${output}`));
    }, timeoutMs);
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve(true);
  if (timeoutMs <= 0) return Promise.resolve(false);
  return new Promise((resolveExit) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
    };
    const onExit = () => {
      cleanup();
      resolveExit(true);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolveExit(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

function exited(child) {
  return child.exitCode != null || child.signalCode != null;
}

export async function stopTestServer(child, { token, timeoutMs = 5_000 } = {}) {
  const ownedPid = child && ownedServerPids.get(child);
  if (!Number.isInteger(ownedPid) || ownedPid !== child.pid) {
    throw Object.assign(new Error("refusing to stop a process not spawned by this test fixture"), {
      code: "TEST_SERVER_NOT_OWNED",
    });
  }
  if (exited(child)) {
    const result = { graceful: false, fallback: false, alreadyExited: true };
    throw Object.assign(new Error(`test server pid ${ownedPid} exited before the fixture requested shutdown`), {
      code: "TEST_SERVER_EXITED_EARLY",
      result,
    });
  }

  const deadline = Date.now() + timeoutMs;
  const serverUrl = serverUrls.get(child);
  let shutdownAccepted = false;
  if (serverUrl && token) {
    try {
      const remaining = Math.max(1, deadline - Date.now());
      const response = await fetch(new URL("/api/test/shutdown", serverUrl), {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(Math.min(1_000, remaining)),
      });
      shutdownAccepted = response.status === 202;
      await response.arrayBuffer().catch(() => {});
    } catch {
      // The bounded exit wait below decides whether the owned child needs fallback termination.
    }
  }

  if (await waitForExit(child, Math.max(0, deadline - Date.now()))) {
    const result = { graceful: shutdownAccepted, fallback: false };
    if (!shutdownAccepted) {
      throw Object.assign(new Error(`test server pid ${ownedPid} exited without accepting the authorized shutdown request`), {
        code: "TEST_SERVER_SHUTDOWN_NOT_ACCEPTED",
        result,
      });
    }
    return result;
  }

  process.stderr.write(
    `[test-fixture] graceful shutdown timed out for owned server pid ${ownedPid}; falling back to child.kill()\n`,
  );
  const exitedAfterKill = new Promise((resolveExit, rejectExit) => {
    const onExit = (code, signal) => {
      child.off("error", onError);
      resolveExit({ code, signal });
    };
    const onError = (error) => {
      child.off("exit", onExit);
      rejectExit(error);
    };
    child.once("exit", onExit);
    child.once("error", onError);
    if (exited(child)) onExit(child.exitCode, child.signalCode);
  });
  if (!child.kill() && !exited(child)) {
    throw new Error(`test server pid ${ownedPid} did not accept fallback termination`);
  }
  await exitedAfterKill;
  const result = { graceful: false, fallback: true };
  throw Object.assign(
    new Error(`test server pid ${ownedPid} required fallback termination instead of the authorized shutdown endpoint`),
    { code: "TEST_SERVER_GRACEFUL_SHUTDOWN_FAILED", result },
  );
}
