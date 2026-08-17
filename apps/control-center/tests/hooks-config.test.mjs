import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHooksConfig, parseKimiHookBlocks, resolveHookStoreId, splitCommandArgs } from "../src/hooks-config.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "hooks-config-"));
  const home = join(root, "home");
  const repo = join(root, "repo");
  await mkdir(join(home, ".claude"), { recursive: true });
  await mkdir(join(repo, ".cursor"), { recursive: true });
  await mkdir(join(repo, ".codex"), { recursive: true });
  await writeFile(join(home, ".claude", "settings.json"), JSON.stringify({
    model: "opus",
    hooks: {
      SessionStart: [
        { matcher: "startup", hooks: [{ type: "command", command: "python I:/514claude/514cc/.claude/hooks/mirror-gate.py", timeout: 10 }] },
        { matcher: "", hooks: [{ type: "command", command: "echo hello", timeout: 5 }] },
      ],
    },
  }, null, 2));
  await writeFile(join(repo, ".cursor", "hooks.json"), JSON.stringify({
    version: 1,
    hooks: {
      sessionStart: [{ command: "python I:/514claude/514cc/.claude/hooks/mirror-gate.py", timeout: 10 }],
    },
  }, null, 2));
  const service = createHooksConfig({ repoRoot: repo, homeDir: home });
  return { root, home, repo, service };
}

test("parseKimiHookBlocks reads [[hooks]] tables without a TOML library", () => {
  const items = parseKimiHookBlocks(`
[[hooks]]
event = "SessionStart"
matcher = ""
timeout = 30
command = "echo start"

[[hooks]]
event = "PreToolUse"
matcher = "Bash"
command = "echo tool"
`, { id: "kimi-user", runtime: "kimi", scope: "user", layer: "shared" });
  assert.equal(items.length, 2);
  assert.equal(items[1].event, "PreToolUse");
  assert.equal(items[1].matcher, "Bash");
});

test("splitCommandArgs appends argv lines to the command", () => {
  assert.equal(splitCommandArgs("python hook.py", ["session-start.py", "--force"]), "python hook.py session-start.py --force");
  assert.equal(splitCommandArgs("echo hi", []), "echo hi");
});

test("resolveHookStoreId maps 作用域 + 运行时 to a concrete store", () => {
  assert.equal(resolveHookStoreId({ scope: "user", layer: "shared", runtime: "claude" }), "claude-user");
  assert.equal(resolveHookStoreId({ scope: "user", layer: "local", runtime: "claude" }), "claude-user-local");
  assert.equal(resolveHookStoreId({ scope: "project", layer: "shared", runtime: "claude" }), "claude-project");
  assert.equal(resolveHookStoreId({ scope: "project", layer: "local", runtime: "claude" }), "claude-project-local");
  assert.equal(resolveHookStoreId({ scope: "user", runtime: "cursor" }), "cursor-user");
  assert.equal(resolveHookStoreId({ scope: "user", runtime: "codex" }), "codex-user");
  assert.equal(resolveHookStoreId({ runtime: "gemini" }), "gemini-user");
  assert.equal(resolveHookStoreId({ scope: "project", runtime: "cursor" }), "cursor-project");
});

test("list normalizes Claude and Cursor stores and marks harness hooks protected", async () => {
  const { service } = await fixture();
  const listed = await service.list();
  assert.equal(listed.stores.length, 10);
  assert.equal(listed.items.filter((item) => item.store === "claude-user").length, 2);
  assert.equal(listed.items.find((item) => item.store === "claude-user").layer, "shared");
  const mirror = listed.items.find((item) => item.command.includes("mirror-gate.py") && item.store === "claude-user");
  assert.equal(mirror.protected, true);
  assert.equal(mirror.event, "SessionStart");
  assert.equal(mirror.matcher, "startup");
  const cursor = listed.items.find((item) => item.store === "cursor-project");
  assert.equal(cursor.event, "SessionStart");
  assert.equal(cursor.scope, "project");
});

test("create writes only the hooks key and keeps sibling Claude settings", async () => {
  const { home, service } = await fixture();
  await service.create({
    store: "claude-user",
    event: "PreToolUse",
    matcher: "Write",
    command: "echo created",
    timeout: 8,
  });
  const saved = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(saved.model, "opus");
  assert.equal(saved.hooks.PreToolUse[0].matcher, "Write");
  assert.equal(saved.hooks.PreToolUse[0].hooks[0].command, "echo created");
  assert.equal(saved.hooks.PreToolUse[0].hooks[0].timeout, 8);
});

test("create can target Claude project settings and keep custom fields", async () => {
  const { repo, service } = await fixture();
  await service.create({
    scope: "project",
    layer: "shared",
    runtime: "claude",
    event: "PreToolUse",
    matcher: "Bash",
    command: "echo project",
    statusMessage: "正在检查工作区",
    custom: { owner: "lo" },
  });
  const saved = JSON.parse(await readFile(join(repo, ".claude", "settings.json"), "utf8"));
  assert.equal(saved.hooks.PreToolUse[0].matcher, "Bash");
  assert.equal(saved.hooks.PreToolUse[0].hooks[0].command, "echo project");
  assert.equal(saved.hooks.PreToolUse[0].hooks[0].statusMessage, "正在检查工作区");
  assert.equal(saved.hooks.PreToolUse[0].hooks[0].owner, "lo");
  assert.equal(saved.hooks.PreToolUse[0].hooks[0].timeout, 60);
});

test("protected delete requires confirmation and then removes the hook", async () => {
  const { service } = await fixture();
  const listed = await service.list();
  const mirror = listed.items.find((item) => item.protected && item.store === "claude-user");
  await assert.rejects(() => service.remove(mirror.id), { code: "HOOK_PROTECTED" });
  const after = await service.remove(mirror.id, { confirmProtected: true });
  assert.equal(after.items.some((item) => item.id === mirror.id), false);
  assert.equal(after.items.some((item) => item.store === "claude-user" && item.command.includes("mirror-gate.py")), false);
});
