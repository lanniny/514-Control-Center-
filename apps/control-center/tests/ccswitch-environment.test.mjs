import test from "node:test";
import assert from "node:assert/strict";

import { createEnvironmentAdapter } from "../src/ccswitch/environment.mjs";

test("Windows environment adapter distinguishes Process/User/Machine and verifies persistent mutations", async (t) => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  });

  const calls = [];
  const runner = async (script, env) => {
    calls.push({ script, env });
    if (env.CCSWITCH_ENV_NAMES) {
      return JSON.stringify([
        { name: "OPENAI_API_KEY", value: "user-secret", scope: "User" },
        { name: "OPENAI_API_KEY", value: "machine-secret", scope: "Machine" },
      ]);
    }
    return "";
  };
  const adapter = createEnvironmentAdapter({ platform: "win32", runner });
  const inspected = await adapter.inspect([{ app: "codex", name: "OPENAI_API_KEY" }]);
  assert.deepEqual(inspected.map((item) => item.scope), ["User", "Machine"]);
  assert.equal(calls[0].script.includes("GetEnvironmentVariable"), true);

  await adapter.remove(inspected[0]);
  assert.equal(calls[1].env.CCSWITCH_ENV_SCOPE, "User");
  assert.equal(calls[1].script.includes("deletion verification failed"), true);

  await adapter.set(inspected[1]);
  assert.equal(calls[2].env.CCSWITCH_ENV_SCOPE, "Machine");
  assert.equal(calls[2].env.CCSWITCH_ENV_VALUE, "machine-secret");
  assert.equal(calls[2].script.includes("restore verification failed"), true);
});
