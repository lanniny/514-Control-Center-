import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  assertArgvTransportSafe,
  assertEchoMatches,
  detectReplacementCorruption,
  digestPrompt,
  inspectPrompt,
  preparePromptTransport,
  sealPromptTransport,
} from "../src/prompt-transport.mjs";
import { runProcess } from "../src/process-runner.mjs";
import { buildRemoteCommandLine, shQuote, shUnquote } from "../src/ssh/remote-run.mjs";
import { childProcessEnv } from "../src/process-runner.mjs";

const echoScript = fileURLToPath(new URL("../scripts/prompt-transport-echo.mjs", import.meta.url));
const echoPs1 = fileURLToPath(new URL("../scripts/prompt-transport-echo.ps1", import.meta.url));

const FIXTURES = Object.freeze([
  "ASCII only",
  "中文任务不要改写",
  "组合音标 e\u0301 与零宽\u200b连接",
  "emoji 🎯 和换行\n第二行",
  `${"长提示词".repeat(200)}结束`,
]);

test("promptTransport/v1 seals digest metadata without storing the prompt", () => {
  const prompt = "给 Codex 派一个中文任务 🎯";
  const record = sealPromptTransport({ prompt, transport: "stdin", adapterId: "claude-stream-json" });
  assert.equal(record.schema, "514cc.promptTransport/v1");
  assert.equal(record.transport, "stdin");
  assert.equal(record.inputDigest, digestPrompt(prompt));
  assert.equal(record.byteLength, Buffer.byteLength(prompt, "utf8"));
  assert.equal(record.codePointCount, [...prompt].length);
  assert.equal(record.hasNonAscii, true);
  assert.equal(JSON.stringify(record).includes(prompt), false);
});

test("promptTransport rejects replacement corruption and Windows .ps1 argv", () => {
  assert.equal(detectReplacementCorruption("中文", "??"), true);
  assert.equal(detectReplacementCorruption("中文", "中文"), false);
  assert.throws(
    () => assertEchoMatches("中文任务", "??"),
    { code: "PROMPT_TRANSPORT_CORRUPT", failureClass: "provider_error" },
  );
  assert.throws(
    () => assertArgvTransportSafe({
      prompt: "中文任务",
      command: "kimi",
      platform: "win32",
      resolve: () => ({ command: "powershell.exe", resolvedPath: "C:/shim/kimi.ps1" }),
    }),
    { code: "PROMPT_TRANSPORT_UNSAFE" },
  );
  assert.throws(
    () => sealPromptTransport({
      prompt: "中文任务",
      transport: "stdin",
      command: "claude",
      platform: "win32",
      resolve: () => ({ command: "powershell.exe", resolvedPath: "C:/shim/claude.ps1" }),
    }),
    { code: "PROMPT_TRANSPORT_UNSAFE" },
  );
  assert.equal(inspectPrompt("🎯").hasNonAscii, true);
  assert.doesNotThrow(() => assertArgvTransportSafe({
    prompt: "中文任务",
    command: "kimi",
    platform: "win32",
    resolve: () => ({ command: "C:/bin/kimi.exe", resolvedPath: "C:/bin/kimi.exe" }),
  }));
});

test("preparePromptTransport persists a sanitized record before dispatch", async () => {
  const events = [];
  const record = await preparePromptTransport({
    prompt: "只读探测",
    transport: "argv",
    adapterId: "kimi-headless-resume",
    command: "kimi",
    eventStore: {
      emit: async (type, data) => {
        events.push([type, data]);
      },
    },
    runId: "run-1",
    agentId: "kimi-frontend",
    resolve: () => ({ command: "kimi.exe", resolvedPath: "kimi.exe" }),
  });
  await Promise.resolve();
  assert.equal(events[0][0], "prompt.transport");
  assert.equal(events[0][1].inputDigest, record.inputDigest);
  assert.equal(JSON.stringify(events[0][1]).includes("只读探测"), false);
});

test("preparePromptTransport fails closed when the audit record cannot be persisted", async () => {
  await assert.rejects(
    () => preparePromptTransport({
      prompt: "不能泄漏的中文任务",
      transport: "stdin",
      adapterId: "claude-stream-json",
      command: "claude",
      eventStore: { emit: async () => { throw new Error("disk unavailable"); } },
      runId: "run-audit-failure",
      agentId: "claude-fable",
      resolve: () => ({ command: "claude.exe", resolvedPath: "claude.exe" }),
    }),
    (error) => error.code === "PROMPT_TRANSPORT_AUDIT_FAILED"
      && error.failureClass === "provider_error"
      && !error.message.includes("不能泄漏的中文任务"),
  );
});

test("preparePromptTransport bounds a never-settling audit write", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    () => preparePromptTransport({
      prompt: "不能永久等待的中文任务",
      transport: "jsonl",
      adapterId: "codex-app-server",
      eventStore: { emit: async () => new Promise(() => {}) },
      runId: "run-audit-timeout",
      agentId: "codex-technical",
      auditTimeoutMs: 20,
    }),
    (error) => error.code === "PROMPT_TRANSPORT_AUDIT_FAILED"
      && error.cause?.code === "PROMPT_TRANSPORT_AUDIT_TIMEOUT"
      && !error.message.includes("不能永久等待的中文任务"),
  );
  assert.ok(Date.now() - startedAt < 1_000, "audit timeout must release provider dispatch promptly");
});

test("child environment pins UTF-8 locale flags without leaking foreign secrets", () => {
  const env = childProcessEnv({}, { Path: "C:/runtime", OPENAI_API_KEY: "secret" }, { provider: "kimi" });
  assert.equal(env.PYTHONIOENCODING, "utf-8");
  assert.equal(env.PYTHONUTF8, "1");
  assert.equal(env.LANG, "C.UTF-8");
  assert.equal(env.LC_ALL, "C.UTF-8");
  assert.equal(Object.hasOwn(env, "OPENAI_API_KEY"), false);
});

test("native node argv and stdin echo preserve CJK fixtures", async () => {
  for (const prompt of FIXTURES) {
    const argv = await runProcess(process.execPath, [echoScript, "--echo", prompt], {
      timeoutMs: 15_000,
      provider: null,
    });
    assert.equal(argv.code, 0, argv.stderr);
    const argvEcho = JSON.parse(argv.stdout);
    assert.equal(argvEcho.digest, inspectPrompt(prompt).inputDigest);
    assertEchoMatches(prompt, argvEcho.echo);

    const stdin = await runProcess(process.execPath, [echoScript, "--stdin"], {
      input: prompt,
      timeoutMs: 15_000,
      provider: null,
    });
    assert.equal(stdin.code, 0, stdin.stderr);
    const stdinEcho = JSON.parse(stdin.stdout);
    assert.equal(stdinEcho.digest, inspectPrompt(prompt).inputDigest);
    assertEchoMatches(prompt, stdinEcho.echo);
  }
});

test("Windows powershell.exe -File path is unsafe for non-ASCII argv", async (t) => {
  if (process.platform !== "win32") {
    t.skip("powershell.exe fixture is Windows-only");
    return;
  }
  const ascii = await runProcess("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", echoPs1, "ascii-ok"], {
    timeoutMs: 20_000,
    provider: null,
  });
  assert.equal(ascii.code, 0, ascii.stderr);
  assertEchoMatches("ascii-ok", JSON.parse(ascii.stdout).echo);

  assert.throws(
    () => sealPromptTransport({
      prompt: "中文任务",
      transport: "argv",
      command: "kimi",
      platform: "win32",
      resolve: () => ({ command: "powershell.exe", resolvedPath: echoPs1 }),
    }),
    { code: "PROMPT_TRANSPORT_UNSAFE" },
  );

  const chinese = await runProcess("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", echoPs1, "中文任务"], {
    timeoutMs: 20_000,
    provider: null,
  });
  if (chinese.code === 0) {
    const echoed = JSON.parse(chinese.stdout).echo;
    if (echoed === "中文任务") {
      t.skip("this Windows PowerShell -File preserved CJK argv; the seal still rejects the path");
      return;
    }
    assert.equal(detectReplacementCorruption("中文任务", echoed), true);
  }
});

test("SSH quoting roundtrips CJK argv and fails closed on replacement", () => {
  const prompt = "远程中文任务 🎯\n第二行";
  const quoted = shQuote(prompt);
  assert.equal(shUnquote(quoted), prompt);
  const line = buildRemoteCommandLine({ cwd: "/tmp/项目", command: "kimi", args: ["-p", prompt] });
  assert.match(line, /kimi/);
  assert.equal(shUnquote(shQuote(prompt)), prompt);
  assert.throws(
    () => shUnquote("??"),
    { code: "PROMPT_TRANSPORT_CORRUPT" },
  );
});
