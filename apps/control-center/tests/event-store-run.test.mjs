import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/event-store.mjs";

test("listByRun returns full per-run history, unbounded by the global recent window", async () => {
  const root = await mkdtemp(join(tmpdir(), "cc-es-"));
  try {
    const store = await new EventStore(join(root, "events.jsonl")).init();
    // 两个 run 各 60 条——总量远超全局最近 50 窗口，验证 per-run 回放不受窗口限制（烛致命 #1 修复）
    for (let i = 0; i < 60; i += 1) await store.emit("assistant.message", { text: `a${i}` }, { runId: "run-A" });
    for (let i = 0; i < 60; i += 1) await store.emit("assistant.message", { text: `b${i}` }, { runId: "run-B" });
    const a = await store.listByRun("run-A");
    assert.equal(a.length, 60, "all 60 run-A events returned despite >50 global events");
    assert.ok(a.every((event) => event.runId === "run-A"), "only run-A events, no cross-run leakage");
    assert.deepEqual(a.map((event) => event.data.text).slice(0, 2), ["a0", "a1"], "chronological order preserved");
    assert.equal((await store.listByRun("run-B")).length, 60);
    assert.deepEqual(await store.listByRun("run-missing"), [], "unknown run yields empty, not error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
