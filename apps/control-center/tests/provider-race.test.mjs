import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

test("provider switch and apply-team share the runtime seat mutation lock", async () => {
  const server = await readFile(resolve(appRoot, "server.mjs"), "utf8");
  const switchBlock = server.slice(server.indexOf('pathname === "/api/providers/switch"'));
  assert.match(switchBlock.slice(0, 500), /withRuntimeSeatMutation/);
  const applyBlock = server.slice(server.indexOf('pathname === "/api/providers/apply-team"'));
  assert.match(applyBlock.slice(0, 500), /withRuntimeSeatMutation/);
});

test("provider remove re-checks references after commit", async () => {
  const source = await readFile(resolve(appRoot, "src/providers.mjs"), "utf8");
  const remove = source.slice(source.indexOf("remove(id)"), source.indexOf("sort(orderedIds"));
  assert.ok(remove.indexOf("await this.#commitState(candidate)") < remove.indexOf("deletion-recheck"));
  assert.match(remove, /provider\.reference_race/);
  assert.match(remove, /staleReferences/);
});

test("close returns an attributable phase log and second close is idempotent", async () => {
  const source = await readFile(resolve(appRoot, "src/app.mjs"), "utf8");
  assert.match(source, /schema: "514cc\.close-result\/v1"/);
  assert.match(source, /idempotent: true/);
  assert.match(source, /retryable: true/);
  const close = source.slice(source.indexOf("async close("), source.indexOf("return state;"));
  assert.match(close, /phases\.push\(entry\)/);
  assert.match(close, /if \(closed\)/);
  assert.match(close, /if \(closePromise\) return closePromise/);
  assert.match(close, /closeTasks\.delete\("automations\.stop"\)/);
});
