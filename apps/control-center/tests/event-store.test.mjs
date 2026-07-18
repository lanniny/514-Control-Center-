import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EventStore } from "../src/event-store.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

test("event replay pages forward without silently dropping a sequence gap", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-events-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await new EventStore(resolve(root, "events.jsonl")).init();
  for (let index = 1; index <= 5; index += 1) await store.emit("test.event", { index });

  const first = await store.replay(0, 2);
  assert.deepEqual(first.events.map((event) => event.sequence), [1, 2]);
  assert.equal(first.hasMore, true);
  assert.equal(first.matched, 5);

  const second = await store.replay(first.events.at(-1).sequence, 2);
  assert.deepEqual(second.events.map((event) => event.sequence), [3, 4]);
  assert.equal(second.hasMore, true);
  const final = await store.replay(second.events.at(-1).sequence, 2);
  assert.deepEqual(final.events.map((event) => event.sequence), [5]);
  assert.equal(final.hasMore, false);
});
