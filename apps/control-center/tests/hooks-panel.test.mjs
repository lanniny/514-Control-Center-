import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { groupHooks, hookTitle, hooksEmptyReason, resolveHookStoreId } from "../public/modules/hooks-panel.js";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

test("hookTitle uses matcher or 匹配全部", () => {
  assert.equal(hookTitle({ matcher: "startup" }), "startup");
  assert.equal(hookTitle({ matcher: "" }), "匹配全部");
});

test("groupHooks filters by query and scope then groups by event", () => {
  const items = [
    { event: "SessionStart", matcher: "startup", command: "mirror-gate.py", scope: "user", layer: "shared", runtime: "claude" },
    { event: "SessionStart", matcher: "", command: "echo hello", scope: "user", layer: "local", runtime: "claude" },
    { event: "Stop", matcher: "", command: "stop-gate.py", scope: "project", layer: "shared", runtime: "codex" },
  ];
  const user = groupHooks(items, { scope: "user" });
  assert.deepEqual(user.map((group) => group.event), ["SessionStart"]);
  assert.equal(user[0].hooks.length, 2);
  const local = groupHooks(items, { scope: "local" });
  assert.equal(local[0].hooks.length, 1);
  assert.equal(local[0].hooks[0].command, "echo hello");
  const searched = groupHooks(items, { query: "stop" });
  assert.equal(searched.length, 1);
  assert.equal(searched[0].event, "Stop");
});

test("hooksEmptyReason distinguishes stale kernel from filtered empty", () => {
  assert.equal(hooksEmptyReason({ loadError: "API route not found" }), "stale-kernel");
  assert.equal(hooksEmptyReason({ loaded: true, items: [] }), "none");
  assert.equal(hooksEmptyReason({
    loaded: true,
    items: [{ event: "Stop", matcher: "", command: "x", scope: "project", layer: "shared" }],
    scope: "user",
  }), "filtered");
  assert.equal(resolveHookStoreId({ scope: "project", layer: "local", runtime: "claude" }), "claude-project-local");
  assert.equal(resolveHookStoreId({ scope: "user", runtime: "cursor" }), "cursor-user");
  assert.equal(resolveHookStoreId({ runtime: "gemini" }), "gemini-user");
});

test("hooks surface is a config topology node and not a runtime-seat alias", async () => {
  const html = await readFile(`${appRoot}/public/index.html`, "utf8");
  const app = await readFile(`${appRoot}/public/app.js`, "utf8");
  assert.match(html, /data-config-surface="hooks"/);
  assert.match(html, /id="config-surface-hooks"[^>]+data-config-surface-panel="hooks"/);
  assert.match(html, /id="hooks-workbench"/);
  assert.match(html, /href="\.\/forge\/hooks\.css"/);
  assert.doesNotMatch(html, /id="config-surface-runtime"/);
  assert.match(app, /\["providers", "local-runtime", "capabilities", "hooks", "sources"\]/);
  assert.match(app, /mountHooksPanel\(/);
  assert.match(app, /#config\/hooks|configSurface === "hooks"/);
  const panel = await readFile(`${appRoot}/public/modules/hooks-panel.js`, "utf8");
  const css = await readFile(`${appRoot}/public/forge/hooks.css`, "utf8");
  assert.match(panel, /返回/);
  assert.match(panel, /用户 · Gemini CLI|gemini-user/);
  assert.match(panel, /name="store"/);
  assert.match(panel, /codex-user/);
  assert.match(panel, /Grok \/ OpenCode \/ Pi/);
  assert.doesNotMatch(panel, /name="runtime"/);
  assert.match(panel, /状态消息/);
  assert.match(panel, /自定义字段 JSON/);
  assert.match(panel, /Shell 命令/);
  assert.match(panel, /hooks-form-bar/);
  assert.match(panel, /hooks-form-section/);
  assert.match(css, /minmax\(0, 1fr\)/);
  assert.doesNotMatch(css, /max-width:\s*760px/);
});
