import test from "node:test";
import assert from "node:assert/strict";
import { encodeJsonLine } from "../src/jsonl.mjs";
import { buildOpencodeArgs, extractOpencodeEventError, formatOpencodeExitError, OpencodeCliAdapter } from "../src/adapters/opencode-cli.mjs";

test("OpenCode JSON error events flatten provider messages", () => {
  assert.equal(extractOpencodeEventError({
    type: "error",
    error: { name: "UnknownError", data: { message: "Unexpected server error" } },
  }), "Unexpected server error");
  assert.equal(formatOpencodeExitError({
    code: 1,
    sessionId: "ses_1",
    eventError: "Unexpected server error",
  }), "opencode exited 1 (session ses_1): Unexpected server error");
  assert.equal(formatOpencodeExitError({ code: 1 }), "opencode exited 1 without a session id");
});

test("OpenCode args map permission/model/effort/session onto documented flags", () => {
  assert.deepEqual(buildOpencodeArgs({ prompt: "inspect" }), [
    "run", "--format", "json", "inspect",
  ]);
  assert.deepEqual(buildOpencodeArgs({ prompt: "plan it", permissionMode: "plan" }), [
    "run", "--format", "json", "--agent", "plan", "plan it",
  ]);
  assert.deepEqual(buildOpencodeArgs({
    prompt: "resume", sessionId: "ses_1", model: "tokenrhythm/deepseek-v4-flash", effort: "high", permissionMode: "workspace-write",
  }), [
    "run", "--format", "json", "--auto", "-s", "ses_1", "-m", "tokenrhythm/deepseek-v4-flash", "--variant", "high", "resume",
  ]);
});

test("OpenCode adapter resolves the session id from JSON events and collects text parts", async () => {
  const emitted = [];
  const sessions = [];
  let seenArgs = null;
  const adapter = new OpencodeCliAdapter({
    cwd: "C:/repo",
    eventStore: { emit: async (type, payload) => { emitted.push({ type, payload }); } },
    runProcessImpl: async (command, args, options) => {
      seenArgs = args;
      options.onStdout(encodeJsonLine({ type: "step_start", sessionID: "ses_abc", part: { type: "step-start" } }));
      options.onStdout(encodeJsonLine({ type: "text", sessionID: "ses_abc", part: { type: "text", text: "PONG" } }));
      options.onStdout(encodeJsonLine({ type: "step_finish", sessionID: "ses_abc", part: { type: "step-finish", tokens: { total: 1 } } }));
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  const result = await adapter.send({
    prompt: "ping",
    runId: "run-opencode",
    model: "tokenrhythm/deepseek-v4-flash",
    onSessionStarted: async ({ sessionId }) => { sessions.push(sessionId); },
  });
  assert.equal(result.sessionId, "ses_abc");
  assert.equal(result.text, "PONG");
  assert.deepEqual(sessions, ["ses_abc"]);
  assert.deepEqual(seenArgs, ["run", "--format", "json", "-m", "tokenrhythm/deepseek-v4-flash", "ping"]);
  assert.ok(emitted.some((entry) => entry.type === "assistant.message" && entry.payload.text === "PONG"));
});

test("OpenCode adapter surfaces process failure after draining event persistence", async () => {
  const processFailure = Object.assign(new Error("synthetic process failure"), { code: "SYNTHETIC_FAILURE" });
  const unhandled = [];
  const attempts = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  const adapter = new OpencodeCliAdapter({
    cwd: "C:/repo",
    eventStore: {
      emit: async (type) => {
        attempts.push(type);
        if (type === "prompt.transport") return;
        throw new Error("event store unavailable");
      },
    },
    runProcessImpl: async (command, args, options) => {
      options.onStdout(encodeJsonLine({ type: "text", sessionID: "ses_x", part: { type: "text", text: "partial" } }));
      throw processFailure;
    },
  });
  try {
    await assert.rejects(
      () => adapter.send({ prompt: "inspect", runId: "run-opencode" }),
      { code: "SYNTHETIC_FAILURE" },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(attempts.includes("assistant.message"));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("OpenCode adapter prefers JSON error events over empty stderr", async () => {
  const adapter = new OpencodeCliAdapter({
    cwd: "C:/repo",
    eventStore: { emit: async () => {} },
    runProcessImpl: async (command, args, options) => {
      options.onStdout(encodeJsonLine({
        type: "error",
        sessionID: "ses_opened",
        error: { name: "UnknownError", data: { message: "Unexpected server error. Check server logs for details." } },
      }));
      return { code: 1, stdout: "", stderr: "" };
    },
  });
  await assert.rejects(
    () => adapter.send({ prompt: "ping", runId: "run-opencode" }),
    (error) => error.code === "OPENCODE_FAILED"
      && /ses_opened/.test(error.message)
      && /Unexpected server error/.test(error.message)
      && !/without a session id/.test(error.message),
  );
});

test("OpenCode adapter explains Windows certificate verification failures", async () => {
  const adapter = new OpencodeCliAdapter({
    cwd: "C:/repo",
    eventStore: { emit: async () => {} },
    runProcessImpl: async (command, args, options) => {
      options.onStdout(encodeJsonLine({
        type: "error",
        sessionID: "ses_cert",
        error: { name: "UnknownError", data: { message: "unknown certificate verification error" } },
      }));
      return { code: 1, stdout: "", stderr: "" };
    },
  });
  await assert.rejects(
    () => adapter.send({ prompt: "ping", runId: "run-opencode" }),
    (error) => error.code === "OPENCODE_FAILED"
      && /certificate verification/.test(error.message)
      && /NODE_USE_SYSTEM_CA/.test(error.message)
      && !/NODE_TLS_REJECT_UNAUTHORIZED/.test(error.message),
  );
});

test("OpenCode adapter rejects non-zero exits without a session id", async () => {
  const adapter = new OpencodeCliAdapter({
    cwd: "C:/repo",
    eventStore: { emit: async () => {} },
    runProcessImpl: async () => ({ code: 1, stdout: "", stderr: "Error: 401 unauthorized" }),
  });
  await assert.rejects(
    () => adapter.send({ prompt: "ping", runId: "run-opencode" }),
    (error) => error.code === "OPENCODE_FAILED" && /401/.test(error.message) && /opencode\.json/.test(error.message),
  );
});
