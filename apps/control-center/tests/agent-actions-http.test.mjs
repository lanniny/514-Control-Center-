import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnTestServer, stopTestServer, waitForUrl } from "./server-fixture.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

async function postAction(origin, token, agent, action) {
  return fetch(`${origin}/api/agents/actions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ agent, action }),
  });
}

test("agent action HTTP boundary rejects malformed ids and reports global capacity", { timeout: 45_000 }, async (t) => {
  const dataRoot = await mkdtemp(resolve(appRoot, ".test-agent-actions-http-"));
  const token = "agent-actions-http-token";
  const child = spawnTestServer({
    env: {
      CONTROL_CENTER_TOKEN: token,
      CONTROL_CENTER_DATA_DIR: dataRoot,
      CONTROL_CENTER_PORT: "0",
      CONTROL_CENTER_TEST_AGENT_ACTION_DELAY_MS: "1000",
    },
  });
  t.after(async () => {
    await stopTestServer(child, { token });
    await rm(dataRoot, { recursive: true, force: true });
  });
  const origin = new URL(await waitForUrl(child)).origin;

  const invalid = await postAction(origin, token, "codex-technical", "version;whoami");
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json()).error.code, "VALIDATION_FAILED");

  const running = ["claude-fable", "codex-technical", "grok-build", "kimi-frontend"]
    .map((agent) => postAction(origin, token, agent, "version"));
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 150));

  const saturated = await postAction(origin, token, "pi-resident", "version");
  assert.equal(saturated.status, 429);
  assert.equal(saturated.headers.get("retry-after"), "1");
  assert.equal((await saturated.json()).error.code, "AGENT_ACTION_CAPACITY");

  const settled = await Promise.all(running);
  assert.ok(settled.every((response) => response.status === 200));
});
