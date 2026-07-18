import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { attachLfJsonl, encodeJsonLine } from "../src/jsonl.mjs";
import { findSecretCandidates, sanitizeForPersistence } from "../src/redaction.mjs";
import { childProcessEnv, resolveCommand, runProcess } from "../src/process-runner.mjs";
import { buildCodexArgs } from "../src/adapters/codex-cli.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

test("persistence sanitizer removes secrets and private reasoning", () => {
  const value = sanitizeForPersistence({
    apiKey: "sk-test-12345678901234567890",
    message: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
    thinking: "private reasoning",
    nested: { ok: "visible" },
  });
  assert.equal(value.apiKey, "[REDACTED]");
  assert.match(value.message, /\[REDACTED\]/);
  assert.equal(value.thinking, "[NOT_PERSISTED]");
  assert.equal(value.nested.ok, "visible");
});

test("secret scanner accepts references and rejects literals", () => {
  assert.deepEqual(findSecretCandidates('api_key: "${MODEL_API_KEY}"'), []);
  assert.equal(findSecretCandidates('api_key: "abcdefghijklmnop123456"').length, 1);
  assert.ok(findSecretCandidates('{"authorization":"Basic YWJjZGVmZ2hpamtsbW5vcA=="}').length);
  assert.ok(findSecretCandidates('{"aws_access_key_id":"AKIAABCDEFGHIJKLMNOP"}').length);
  assert.match(sanitizeForPersistence({ prompt: "Authorization: Basic YWJjZGVmZ2hpamtsbW5vcA==" }).prompt, /REDACTED/);
  assert.match(sanitizeForPersistence({ prompt: "AKIAABCDEFGHIJKLMNOP" }).prompt, /REDACTED/);
});

test("LF JSONL parser does not split on Unicode line separators", async () => {
  const stream = new PassThrough();
  const messages = [];
  attachLfJsonl(stream, (message) => messages.push(message));
  stream.end(encodeJsonLine({ text: "left\u2028right" }));
  await new Promise((resolve) => stream.once("end", resolve));
  assert.deepEqual(messages, [{ text: "left\u2028right" }]);
});

test("Windows command resolution never enables a shell", { skip: process.platform !== "win32" }, () => {
  const resolved = resolveCommand("gemini");
  assert.equal(resolved.command.toLowerCase(), "powershell.exe");
  assert.ok(resolved.prefixArgs.includes("-File"));
  assert.match(resolved.resolvedPath, /gemini\.ps1$/i);
});

test("Windows command resolution respects the first safe PATH owner", { skip: process.platform !== "win32" }, async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-path-owner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = resolve(root, "first");
  const second = resolve(root, "second");
  await import("node:fs/promises").then(({ mkdir, writeFile }) => Promise.all([
    mkdir(first, { recursive: true }),
    mkdir(second, { recursive: true }),
  ]).then(() => Promise.all([
    writeFile(resolve(first, "codex.ps1"), "exit 0\n"),
    writeFile(resolve(second, "codex.exe"), "not-an-executable\n"),
  ])));
  const resolved = resolveCommand("codex", { PATH: `${first};${second}` });
  assert.match(resolved.resolvedPath, /first[\\/]codex\.ps1$/i);
  assert.equal(resolved.command.toLowerCase(), "powershell.exe");
});

test("grok resolves to ~/.grok/bin when PATH omits it (Phase 3 dispatch)", { skip: process.platform !== "win32" }, async (t) => {
  const home = await mkdtemp(resolve(appRoot, ".test-grok-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const binDir = resolve(home, ".grok", "bin");
  await import("node:fs/promises").then(({ mkdir, writeFile }) =>
    mkdir(binDir, { recursive: true }).then(() => writeFile(resolve(binDir, "grok.exe"), "stub")),
  );
  // PATH intentionally lacks any grok; the known-install fallback must still resolve it
  const resolved = resolveCommand("grok", { PATH: "C:\\Windows\\System32", USERPROFILE: home });
  assert.match(resolved.resolvedPath, /\.grok[\\/]bin[\\/]grok\.exe$/i);
  assert.equal(resolved.prefixArgs.length, 0);
});

test("agent child environments do not inherit the control-plane bearer token", () => {
  const env = childProcessEnv({}, {
    PATH: "test",
    CODEX_HOME: "C:/safe-home",
    CONTROL_CENTER_TOKEN: "secret",
    control_center_token: "shadow",
    CODEX_THREAD_ID: "desktop-thread",
    CODEX_REMOTE_PAYLOAD: "desktop-payload",
  });
  assert.equal(env.PATH, "test");
  assert.equal(env.CODEX_HOME, "C:/safe-home");
  assert.equal(Object.keys(env).some((key) => key.toLowerCase() === "control_center_token"), false);
  assert.equal(Object.keys(env).some((key) => key.toLowerCase() === "codex_thread_id"), false);
  assert.equal(Object.keys(env).some((key) => key.toLowerCase().startsWith("codex_remote_")), false);
});

test("pre-aborted processes never spawn and stderr obeys the shared output limit", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-pre-abort-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = resolve(root, "spawned.txt");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => runProcess(process.execPath, ["-e", "require('node:fs').writeFileSync(process.argv[1], 'spawned')", marker], { signal: controller.signal }),
    { code: "ABORTED" },
  );
  await assert.rejects(() => access(marker), { code: "ENOENT" });
  await assert.rejects(
    () => runProcess(process.execPath, ["-e", "process.stderr.write('x'.repeat(4096))"], { maxOutputBytes: 1024 }),
    { code: "OUTPUT_LIMIT" },
  );
});

test("Codex resume keeps top-level sandbox options before the resume subcommand", () => {
  const args = buildCodexArgs({ sessionId: "00000000-0000-0000-0000-000000000000", cwd: "C:/repo" });
  assert.deepEqual(args.slice(0, 6), ["exec", "-s", "read-only", "-C", "C:/repo", "resume"]);
  assert.ok(args.indexOf("-s") < args.indexOf("resume"));
});

test("numeric metering fields survive even when the key smells like a credential", () => {
  const out = sanitizeForPersistence({ tokens: 71607, token_count: 12, api_key: "sk-real-secret-value", enabled: true });
  assert.equal(out.tokens, 71607, "tokens metering number is not redacted");
  assert.equal(out.token_count, 12, "numeric token_count survives");
  assert.equal(out.api_key, "[REDACTED]", "string credentials still redacted");
  assert.equal(out.enabled, true, "booleans survive");
});
