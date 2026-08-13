import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createAgentControlActionRunner, cleanAgentDiagnosticOutput } from "../src/agent-actions.mjs";

const profile = {
  id: "codex-technical",
  adapter: "codex-app-server",
  command: "codex",
};

function createRunner({ runProcessImpl, modelDiscovery, eventStore } = {}) {
  return createAgentControlActionRunner({
    resolveMember: (memberId) => ({ id: memberId, runtimeProfileId: profile.id }),
    resolveProfile: (runtimeProfileId) => runtimeProfileId === profile.id ? profile : null,
    modelDiscovery: modelDiscovery || {
      invalidate() {},
      async forAgent() { return { source: "fallback", context: {}, commands: [] }; },
    },
    repoRoot: "C:/repo",
    eventStore: eventStore || { emit: async () => {} },
    runProcessImpl: runProcessImpl || (async () => ({ code: 0, stdout: "codex-cli 1.2.3", stderr: "" })),
  });
}

test("diagnostic output strips terminal controls before secret redaction", () => {
  const splitSecret = "api_key=sk-live-1234567890\u001b[31mABCDEFGHIJK\u001b[0m";
  const cleaned = cleanAgentDiagnosticOutput(`\u001b]0;title\u0007${splitSecret}\r\nready`);
  assert.doesNotMatch(cleaned, /sk-live|ABCDEFGHIJK|\u001b/);
  assert.match(cleaned, /api_key=\[REDACTED\]/);
  assert.match(cleaned, /ready/);
});

test("diagnostic output deeply redacts plural credential arrays in JSON, JSONL and YAML", () => {
  const secrets = ["alpha-secret-value-123", "beta-secret-value-456", "gamma-secret-value-789"];
  const json = cleanAgentDiagnosticOutput(JSON.stringify({
    apiKeys: [secrets[0], "${OPENAI_API_KEY}"],
    nested: { credentials: [{ token: secrets[1] }] },
    tokens: 42,
  }));
  assert.doesNotMatch(json, new RegExp(secrets.join("|")));
  assert.deepEqual(JSON.parse(json), {
    apiKeys: "[REDACTED]",
    nested: { credentials: "[REDACTED]" },
    tokens: 42,
  });

  const jsonl = cleanAgentDiagnosticOutput([
    JSON.stringify({ status: "ok" }),
    JSON.stringify({ secrets: [secrets[2]] }),
  ].join("\n"));
  assert.doesNotMatch(jsonl, new RegExp(secrets.join("|")));
  assert.equal(JSON.parse(jsonl.split("\n")[1]).secrets, "[REDACTED]");

  const mixedPrettyJson = cleanAgentDiagnosticOutput(`warning: loading local config\n${JSON.stringify({
    apiKeys: [secrets[0]],
    nested: { credentials: [{ token: secrets[1] }] },
  }, null, 2)}\nwarning: footer`);
  assert.doesNotMatch(mixedPrettyJson, new RegExp(secrets.join("|")));
  assert.match(mixedPrettyJson, /^warning: loading local config/);
  assert.match(mixedPrettyJson, /warning: footer$/);
  assert.match(mixedPrettyJson, /"apiKeys": "\[REDACTED\]"/);

  const yaml = cleanAgentDiagnosticOutput(`credentials:\n  - ${secrets[0]}\n  - ${secrets[1]}\nvisible: ready\n`);
  assert.doesNotMatch(yaml, new RegExp(secrets.join("|")));
  assert.match(yaml, /credentials: \"\[REDACTED\]\"/);
  assert.match(yaml, /visible: ready/);

  const jsonArgv = cleanAgentDiagnosticOutput(JSON.stringify({
    args: ["--token", secrets[0]],
    nested: { argv: [`--api-key=${secrets[1]}`] },
  }));
  assert.doesNotMatch(jsonArgv, new RegExp(secrets.join("|")));
  assert.deepEqual(JSON.parse(jsonArgv), {
    args: ["--token", "[REDACTED]"],
    nested: { argv: ["--api-key=[REDACTED]"] },
  });

  const yamlArgv = cleanAgentDiagnosticOutput(`args:\n  - --token\n  - ${secrets[2]}\nvisible: ready\n`);
  assert.doesNotMatch(yamlArgv, new RegExp(secrets.join("|")));
  assert.match(yamlArgv, /- --token\n\s+- "\[REDACTED\]"/);
  assert.match(yamlArgv, /visible: ready/);

  for (const source of [
    `apiKeys = ["${secrets[0]}"]`,
    `apiKeys: ["${secrets[0]}"]`,
    `apiKeys = [\n  "${secrets[0]}",\n  "${secrets[1]}"\n]`,
    `credentials = { primary: "${secrets[0]}" }`,
    `args = ["--token", "${secrets[0]}"]`,
    `args = ["--api-key=${secrets[0]}"]`,
  ]) {
    const cleaned = cleanAgentDiagnosticOutput(source);
    assert.doesNotMatch(cleaned, new RegExp(secrets.join("|")), source);
    assert.match(cleaned, /REDACTED/, source);
  }
});

test("diagnostic structured redaction stays linear and fails closed on malformed secret containers", () => {
  const secret = "malformed-secret-value-123456";
  const adversarial = `${"{".repeat(128 * 1024)}\n\"apiKeys\": [\"${secret}\"]`;
  const startedAt = performance.now();
  const cleaned = cleanAgentDiagnosticOutput(adversarial);
  const elapsedMs = performance.now() - startedAt;

  assert.ok(elapsedMs < 1_500, `128 KiB malformed diagnostic took ${elapsedMs.toFixed(1)}ms`);
  assert.doesNotMatch(cleaned, new RegExp(secret));
  assert.match(cleaned, /REDACTED INVALID STRUCTURED OUTPUT/);

  for (const malformed of [
    `apiKeys = ["${secret}"`,
    `credentials: { primary: "${secret}"`,
  ]) {
    const failClosed = cleanAgentDiagnosticOutput(malformed);
    assert.doesNotMatch(failClosed, new RegExp(secret));
    assert.match(failClosed, /REDACTED INVALID STRUCTURED OUTPUT/);
  }
});

test("agent action runner executes the fixed version argv without Provider credentials", async () => {
  const calls = [];
  const events = [];
  const run = createRunner({
    runProcessImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      return { code: 0, stdout: "codex-cli 1.2.3", stderr: "" };
    },
    eventStore: { emit: async (type, data, context) => events.push({ type, data, context }) },
  });

  const result = await run("member-codex", "version");
  assert.equal(result.status, "ok");
  assert.equal(result.output, "codex-cli 1.2.3");
  assert.deepEqual(calls[0].args, ["--version"]);
  assert.equal(calls[0].options.provider, null);
  assert.equal(events[0].type, "control.agent_action_completed");
});

test("agent action runner rejects unknown actions and concurrent actions for one profile", async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let started;
  const hasStarted = new Promise((resolve) => { started = resolve; });
  const run = createRunner({
    runProcessImpl: async () => {
      started();
      await blocked;
      return { code: 0, stdout: "ok", stderr: "" };
    },
  });

  await assert.rejects(() => run("member-codex", "shell"), { code: "AGENT_ACTION_UNSUPPORTED" });
  await assert.rejects(() => run("member-codex", `version-${"x".repeat(80)}`), { code: "VALIDATION_FAILED" });
  const first = run("member-codex", "version");
  await hasStarted;
  await assert.rejects(() => run("member-codex", "version"), { code: "AGENT_ACTION_BUSY" });
  await assert.rejects(() => run("member-codex", "doctor"), { code: "AGENT_ACTION_BUSY" });
  release();
  await first;
});

test("agent action runner caps global diagnostic concurrency across runtime profiles", async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let started = 0;
  let allStarted;
  const startedGate = new Promise((resolve) => { allStarted = resolve; });
  const profiles = new Map(["member-a", "member-b", "member-c"].map((memberId) => [memberId, {
    id: `seat-${memberId}`,
    builtin: false,
    adapter: "codex-app-server",
    command: "codex",
  }]));
  const run = createAgentControlActionRunner({
    resolveMember: (memberId) => ({ id: memberId, runtimeProfileId: profiles.get(memberId)?.id }),
    resolveProfile: (runtimeProfileId) => [...profiles.values()].find((entry) => entry.id === runtimeProfileId) || null,
    modelDiscovery: { invalidate() {}, async forAgent() { return {}; } },
    repoRoot: "C:/repo",
    runProcessImpl: async () => {
      started += 1;
      if (started === 2) allStarted();
      await blocked;
      return { code: 0, stdout: "ok", stderr: "" };
    },
    maxConcurrentActions: 2,
  });

  const first = run("member-a", "version");
  const second = run("member-b", "version");
  await startedGate;
  await assert.rejects(() => run("member-c", "version"), { code: "AGENT_ACTION_CAPACITY" });
  release();
  await Promise.all([first, second]);
});

test("catalog refresh invalidates the selected runtime profile and preserves member identity", async () => {
  const invalidated = [];
  const run = createRunner({
    modelDiscovery: {
      invalidate(runtimeProfileId) { invalidated.push(runtimeProfileId); },
      async forAgent(runtimeProfileId) {
        return { source: "dynamic", context: { adapterId: "codex-app-server" }, runtimeProfileId };
      },
    },
  });

  const result = await run("member-codex", "refresh-catalog");
  assert.deepEqual(invalidated, ["codex-technical"]);
  assert.equal(result.catalog.context.memberId, "member-codex");
  assert.equal(result.catalog.context.runtimeProfileId, "codex-technical");
});
