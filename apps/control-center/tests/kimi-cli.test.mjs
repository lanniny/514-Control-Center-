import test from "node:test";
import assert from "node:assert/strict";
import { encodeJsonLine } from "../src/jsonl.mjs";
import { buildKimiArgs, buildKimiEnv, KimiCliAdapter } from "../src/adapters/kimi-cli.mjs";
import { childProcessEnv } from "../src/process-runner.mjs";

test("Kimi prompt mode carries an explicit read-only plan boundary", () => {
  assert.deepEqual(buildKimiArgs({ prompt: "inspect" }), [
    "-p", "inspect", "--output-format", "stream-json", "--plan",
  ]);
  assert.deepEqual(buildKimiArgs({ prompt: "resume", sessionId: "session-1", model: "kimi-k2.5" }), [
    "-p", "resume", "--output-format", "stream-json", "--plan", "-S", "session-1", "-m", "kimi-k2.5",
  ]);
});

test("Kimi immediately handles EventStore rejections and drains them when the process fails", async () => {
  const processFailure = Object.assign(new Error("synthetic process failure"), { code: "SYNTHETIC_FAILURE" });
  const unhandled = [];
  const attempts = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  let runOptions = null;
  const adapter = new KimiCliAdapter({
    cwd: "C:/repo",
    eventStore: {
      emit: async (type) => {
        attempts.push(type);
        throw new Error("event store unavailable");
      },
    },
    runProcessImpl: async (command, args, options) => {
      runOptions = options;
      options.onStdout(encodeJsonLine({ role: "assistant", content: "partial" }));
      options.onStdout(encodeJsonLine({ role: "meta", type: "session.resume_hint", session_id: "session-kimi" }));
      throw processFailure;
    },
  });

  try {
    await assert.rejects(
      () => adapter.send({
        prompt: "inspect",
        runId: "run-kimi",
        onSessionStarted: async () => { throw new Error("checkpoint unavailable"); },
      }),
      { code: "SYNTHETIC_FAILURE" },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runOptions.provider, "kimi");
    assert.ok(attempts.includes("assistant.message"));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("Kimi effort rides the KIMI_MODEL_THINKING_EFFORT env wire and stays inside the kimi allowlist", async () => {
  assert.deepEqual(buildKimiEnv({ effort: "MAX" }), { KIMI_MODEL_THINKING_EFFORT: "max" });
  assert.deepEqual(buildKimiEnv({}), {});
  assert.deepEqual(buildKimiEnv({ effort: "  " }), {});

  // env 白名单：kimi 子进程收得到档位，别家 provider 收不到（process-runner 裁剪口径）
  const base = { Path: "C:/runtime/bin", KIMI_API_KEY: "kimi-secret" };
  const kimiEnv = childProcessEnv({ KIMI_MODEL_THINKING_EFFORT: "max" }, base, { provider: "kimi" });
  assert.equal(kimiEnv.KIMI_MODEL_THINKING_EFFORT, "max");
  const foreignEnv = childProcessEnv({ KIMI_MODEL_THINKING_EFFORT: "max" }, base, { provider: "anthropic" });
  assert.equal(Object.hasOwn(foreignEnv, "KIMI_MODEL_THINKING_EFFORT"), false);

  let runOptions = null;
  const adapter = new KimiCliAdapter({
    cwd: "C:/repo",
    eventStore: { emit: async () => {} },
    runProcessImpl: async (command, args, options) => {
      runOptions = options;
      options.onStdout(encodeJsonLine({ role: "meta", type: "session.resume_hint", session_id: "session-kimi" }));
      return { code: 0, stderr: "" };
    },
  });
  await adapter.send({ prompt: "inspect", runId: "run-kimi-effort", effort: "high" });
  assert.equal(runOptions.env.KIMI_MODEL_THINKING_EFFORT, "high");
  assert.equal(runOptions.provider, "kimi");

  await adapter.send({ prompt: "inspect", runId: "run-kimi-no-effort" });
  assert.deepEqual(runOptions.env, {}, "no effort configured means no wire variable");
});
