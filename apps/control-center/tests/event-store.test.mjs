import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  const iterated = [];
  for await (const event of store.iterate({ afterSequence: first.events.at(-1).sequence })) iterated.push(event.sequence);
  assert.deepEqual(iterated, [3, 4, 5]);
});

test("init builds bounded recent and per-run rings in one stream and list calls stay memory-backed", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-rings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  const historical = Array.from({ length: 8 }, (_, index) => ({
    schemaVersion: 1,
    eventId: `event-${index + 1}`,
    sequence: index + 1,
    timestamp: new Date(index * 1000).toISOString(),
    type: "test.event",
    runId: index < 6 ? "run-a" : "run-b",
    data: { index: index + 1 },
  }));
  await writeFile(path, `${historical.slice(0, 4).map(JSON.stringify).join("\n")}\nmalformed\n${historical.slice(4).map(JSON.stringify).join("\n")}\n`, "utf8");

  const store = await new EventStore(path, { recentLimit: 3, perRunLimit: 2 }).init();
  assert.deepEqual((await store.list(2000)).map((event) => event.sequence), [6, 7, 8]);
  assert.deepEqual((await store.listByRun("run-a", 10_000)).map((event) => event.sequence), [5, 6]);
  assert.deepEqual((await store.listByRun("run-b", 10_000)).map((event) => event.sequence), [7, 8]);

  const firstRead = await store.listByRun("run-a");
  firstRead[0].data.index = 999;
  assert.equal((await store.listByRun("run-a"))[0].data.index, 5, "callers cannot mutate the hot index");

  // Destroying the fixture after init proves list/listByRun do not synchronously re-read the whole log.
  await writeFile(path, "corrupt-after-init\n", "utf8");
  assert.deepEqual((await store.list()).map((event) => event.sequence), [6, 7, 8]);
  assert.deepEqual((await store.listByRun("run-a")).map((event) => event.sequence), [5, 6]);
});

test("per-run indexes obey a total LRU budget and batch concurrent cache misses into one scan", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-lru-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  const runs = [
    ...Array.from({ length: 5 }, (_, index) => "run-a"),
    ...Array.from({ length: 3 }, () => "run-b"),
    ...Array.from({ length: 3 }, () => "run-c"),
  ];
  const events = runs.map((runId, index) => ({
    eventId: `lru-${index + 1}`,
    sequence: index + 1,
    type: "test.event",
    runId,
    data: { index: index + 1 },
  }));
  await writeFile(path, `${events.map(JSON.stringify).join("\n")}\n`, "utf8");
  let scans = 0;
  const store = await new EventStore(path, {
    recentLimit: 3,
    perRunLimit: 3,
    maxRunIndexes: 2,
    runIndexEventBudget: 6,
    maxPendingRunLoads: 2,
    onRunIndexScan: () => { scans += 1; },
  }).init();
  assert.equal(store.byRun.size, 2);
  assert.ok(store.indexedRunEvents <= 6);
  assert.equal(store.byRun.has("run-a"), false, "init retains only the most recently active run indexes");

  const runAPending = store.listByRun("run-a", 3);
  const missingPending = store.listByRun("missing", 3);
  await assert.rejects(() => store.listByRun("overflow", 3), { code: "EVENT_INDEX_BUSY" });
  const [runA, missing] = await Promise.all([runAPending, missingPending]);
  assert.deepEqual(runA.map((event) => event.sequence), [3, 4, 5]);
  assert.deepEqual(missing, []);
  assert.equal(scans, 1, "different run misses in the same turn share one streaming disk scan");
  assert.ok(store.byRun.size <= 2);
  assert.ok(store.indexedRunEvents <= 6);

  assert.deepEqual((await store.listByRun("run-a", 3)).map((event) => event.sequence), [3, 4, 5]);
  assert.equal(scans, 1, "the lazy tail is cached after reconstruction");
  assert.equal(store.runIndexInflight.size, 0, "completed and rejected miss keys do not leak inflight slots");
  assert.deepEqual(await store.listByRun("overflow", 3), []);
  assert.equal(scans, 2, "capacity is available again after the previous batch settles");
});

test("recent and per-run indexes obey byte budgets and oversized events fail before persistence", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-byte-budget-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  const store = await new EventStore(path, {
    recentLimit: 100,
    perRunLimit: 100,
    maxRunIndexes: 10,
    runIndexEventBudget: 1000,
    recentByteLimit: 1600,
    perRunByteLimit: 1600,
    runIndexByteBudget: 2400,
    maxEventBytes: 1200,
  }).init();

  for (const runId of ["run-a", "run-b", "run-c"]) {
    await store.emit("test.large", { blob: "x".repeat(700) }, { runId });
  }
  assert.ok(store.recent.bytes <= store.recentByteLimit);
  assert.ok(store.indexedRunBytes <= store.runIndexByteBudget);
  assert.ok(store.byRun.size <= 2, "global byte pressure evicts the least-recent run index");
  for (const ring of store.byRun.values()) assert.ok(ring.bytes <= store.perRunByteLimit);

  const acceptedSequence = store.sequence;
  await assert.rejects(
    () => store.emit("test.oversized", { blob: "x".repeat(3000) }, { runId: "run-d" }),
    { code: "EVENT_TOO_LARGE" },
  );
  assert.equal(store.sequence, acceptedSequence, "a rejected event does not consume a persistent sequence");
  await store.close();

  const reopened = await new EventStore(path, {
    recentByteLimit: 1600,
    perRunByteLimit: 1600,
    runIndexByteBudget: 2400,
    maxEventBytes: 1200,
  }).init();
  assert.equal(reopened.sequence, acceptedSequence);
  const persisted = [];
  for await (const event of reopened.iterate()) persisted.push(event);
  assert.equal(persisted.some((event) => event.type === "test.oversized"), false);
  await reopened.close();
});

test("an emit after LRU eviction remains provisional until disk history is rebuilt", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-provisional-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  await writeFile(path, [
    JSON.stringify({ eventId: "old-a", sequence: 1, type: "test.old", runId: "run-a", data: { phase: "old" } }),
    JSON.stringify({ eventId: "newer-b", sequence: 2, type: "test.other", runId: "run-b", data: {} }),
    "",
  ].join("\n"), "utf8");
  let scans = 0;
  const store = await new EventStore(path, {
    maxRunIndexes: 1,
    perRunLimit: 10,
    runIndexEventBudget: 10,
    onRunIndexScan: () => { scans += 1; },
  }).init();
  assert.equal(store.byRun.has("run-a"), false);

  await store.emit("test.resumed", { phase: "live" }, { runId: "run-a" });
  assert.equal(store.completeRunIndexes.has("run-a"), false);
  assert.deepEqual((await store.listByRun("run-a", 10)).map((event) => event.sequence), [1, 3]);
  assert.equal(scans, 1);
  assert.equal(store.completeRunIndexes.has("run-a"), true);
});

test("an interleaved run evicted during init is not mistaken for a complete index", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-init-interleaved-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  await writeFile(path, [
    JSON.stringify({ eventId: "old-a", sequence: 1, type: "test.old", runId: "run-a", data: {} }),
    JSON.stringify({ eventId: "middle-b", sequence: 2, type: "test.other", runId: "run-b", data: {} }),
    JSON.stringify({ eventId: "new-a", sequence: 3, type: "test.new", runId: "run-a", data: {} }),
    "",
  ].join("\n"), "utf8");
  let scans = 0;
  const store = await new EventStore(path, {
    maxRunIndexes: 1,
    perRunLimit: 10,
    runIndexEventBudget: 10,
    onRunIndexScan: () => { scans += 1; },
  }).init();

  assert.equal(store.completeRunIndexes.has("run-a"), false);
  assert.deepEqual((await store.listByRun("run-a", 10)).map((event) => event.sequence), [1, 3]);
  assert.equal(scans, 1);
  assert.equal(store.initIncompleteRunFilter, null, "init-only completeness metadata is released after startup");
});

test("init completeness tracking stays fixed-size across many unique runs", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-init-memory-bound-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new EventStore(resolve(root, "events.jsonl"), {
    maxRunIndexes: 1,
    perRunLimit: 2,
    runIndexEventBudget: 2,
  });
  let maxFilterBytes = 0;
  store.iterate = async function* iterateUniqueRuns() {
    for (let index = 0; index < 10_000; index += 1) {
      maxFilterBytes = Math.max(maxFilterBytes, this.initIncompleteRunFilter?.bits?.byteLength ?? 0);
      yield { eventId: `unique-${index}`, sequence: index + 1, type: "test.event", runId: `run-${index}`, data: {} };
    }
  };
  await store.init();

  assert.equal(maxFilterBytes, 128 * 1024);
  assert.equal(store.byRun.size, 1);
  assert.equal(store.initIncompleteRunFilter, null);
});

test("legacy oversized history takes an honest slow path instead of returning gaps", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-legacy-oversized-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  const events = [
    { eventId: "small-1", sequence: 1, type: "test.small", runId: "run-a", data: { value: 1 } },
    { eventId: "legacy-large", sequence: 2, type: "test.large", runId: "run-a", data: { blob: "x".repeat(3000) } },
    { eventId: "small-3", sequence: 3, type: "test.small", runId: "run-a", data: { value: 3 } },
  ];
  await writeFile(path, `${events.map(JSON.stringify).join("\n")}\n`, "utf8");
  const store = await new EventStore(path, {
    recentLimit: 10,
    perRunLimit: 10,
    recentByteLimit: 1600,
    perRunByteLimit: 1600,
    runIndexByteBudget: 3200,
    maxEventBytes: 1200,
  }).init();

  await assert.rejects(() => store.list(10), { code: "EVENT_HISTORY_TOO_LARGE" });
  await assert.rejects(() => store.replay(0, 10), { code: "EVENT_HISTORY_TOO_LARGE" });
  await assert.rejects(() => store.listByRun("run-a", 10), { code: "EVENT_HISTORY_TOO_LARGE" });
});

test("aggregate byte eviction is never mistaken for a complete count window", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-aggregate-byte-drop-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  const rows = Array.from({ length: 3 }, (_, index) => ({
    eventId: `aggregate-${index + 1}`,
    sequence: index + 1,
    type: "test.aggregate",
    runId: "run-a",
    data: { blob: String(index).repeat(900) },
  }));
  await writeFile(path, `${rows.map(JSON.stringify).join("\n")}\n`, "utf8");
  const store = await new EventStore(path, {
    recentLimit: 10,
    perRunLimit: 10,
    recentByteLimit: 1600,
    perRunByteLimit: 1600,
    runIndexByteBudget: 3200,
    maxEventBytes: 1200,
  }).init();

  assert.ok(store.recentByteDropThrough > 0);
  assert.equal(store.completeRunIndexes.has("run-a"), false);
  await assert.rejects(() => store.list(10), { code: "EVENT_HISTORY_TOO_LARGE" });
  await assert.rejects(() => store.replay(0, 10), { code: "EVENT_HISTORY_TOO_LARGE" });
  assert.deepEqual((await store.listByRun("run-a", 1)).map((event) => event.sequence), [3]);
  await assert.rejects(() => store.listByRun("run-a", 10), { code: "EVENT_HISTORY_TOO_LARGE" });
});

test("legacy event identities stay fixed-size when eventId is adversarially long", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-identity-bound-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  const event = {
    eventId: "x".repeat(100_000),
    sequence: 1,
    type: "test.long-id",
    runId: "run-long-id",
    data: {},
  };
  await writeFile(path, `${JSON.stringify(event)}\n`, "utf8");
  const store = await new EventStore(path, {
    recentByteLimit: 1600,
    perRunByteLimit: 1600,
    runIndexByteBudget: 3200,
    maxEventBytes: 1200,
  }).init();

  const identities = store.recentExpected.toArray().map((entry) => entry.id);
  assert.equal(identities.length, 1);
  assert.ok(identities[0].startsWith("sha256:"));
  assert.ok(Buffer.byteLength(identities[0], "utf8") < 64);
  await assert.rejects(() => store.list(1), { code: "EVENT_HISTORY_TOO_LARGE" });
});

test("historical JSONL lines fail closed at a byte cap before unbounded buffering", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-line-bound-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  await writeFile(path, `${"x".repeat(100_000)}\n${JSON.stringify({ sequence: 1, type: "unreachable" })}\n`, "utf8");
  const store = new EventStore(path, {
    maxEventBytes: 1024,
    maxHistoricalEventBytes: 4096,
  });

  await assert.rejects(() => store.init(), {
    code: "EVENT_HISTORY_TOO_LARGE",
    limit: 4096,
  });
  await store.close();
});

test("historical JSONL rejects invalid UTF-8 instead of parsing replacement characters", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-utf8-integrity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  const prefix = Buffer.from('{"sequence":1,"type":"test.invalid-utf8","data":{"text":"', "utf8");
  const invalidUtf8 = Buffer.from([0xc3, 0x28]);
  const suffix = Buffer.from('"}}\n', "utf8");
  await writeFile(path, Buffer.concat([prefix, invalidUtf8, suffix]));
  const store = new EventStore(path);

  await assert.rejects(() => store.init(), { code: "EVENT_HISTORY_CORRUPT" });
  await store.close();
});

test("a legacy oversized run does not poison other keys in the same lazy-load batch", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-batch-error-isolation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  const rows = [
    { eventId: "bad-large", sequence: 1, type: "test.large", runId: "run-bad", data: { blob: "x".repeat(3000) } },
    { eventId: "good-small", sequence: 2, type: "test.small", runId: "run-good", data: { value: 2 } },
    { eventId: "filler-1", sequence: 3, type: "test.small", runId: "run-filler-1", data: {} },
    { eventId: "filler-2", sequence: 4, type: "test.small", runId: "run-filler-2", data: {} },
  ];
  await writeFile(path, `${rows.map(JSON.stringify).join("\n")}\n`, "utf8");
  const store = await new EventStore(path, {
    maxRunIndexes: 2,
    perRunLimit: 10,
    runIndexEventBudget: 20,
    recentByteLimit: 1600,
    perRunByteLimit: 1600,
    runIndexByteBudget: 3200,
    maxEventBytes: 1200,
  }).init();

  const bad = store.listByRun("run-bad", 10);
  const good = store.listByRun("run-good", 10);
  await assert.rejects(() => bad, { code: "EVENT_HISTORY_TOO_LARGE", runId: "run-bad" });
  assert.deepEqual((await good).map((event) => event.sequence), [2]);
});

test("concurrent run misses queue in bounded scan chunks instead of returning busy", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-run-load-queue-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  const rows = Array.from({ length: 10 }, (_, index) => ({
    eventId: `queued-${index}`,
    sequence: index + 1,
    type: "test.event",
    runId: `run-${index}`,
    data: { index },
  }));
  await writeFile(path, `${rows.map(JSON.stringify).join("\n")}\n`, "utf8");
  const scanSizes = [];
  const store = await new EventStore(path, {
    maxRunIndexes: 2,
    perRunLimit: 2,
    runIndexEventBudget: 4,
    maxPendingRunLoads: 8,
    onRunIndexScan: ({ keys }) => { scanSizes.push(keys.length); },
  }).init();

  const histories = await Promise.all(Array.from({ length: 8 }, (_, index) => store.listByRun(`run-${index}`, 2)));
  assert.deepEqual(histories.map((events) => events.map((event) => event.sequence)), Array.from({ length: 8 }, (_, index) => [index + 1]));
  assert.deepEqual(scanSizes, [2, 2, 2, 2]);
  assert.ok(scanSizes.every((size) => size <= store.maxConcurrentRunLoads));
});

test("emit subscribers and callers cannot mutate byte-accounted history", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-mutation-isolation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await new EventStore(resolve(root, "events.jsonl")).init();
  store.subscribe((event) => { event.data.value = "subscriber-mutated"; });
  const returned = await store.emit("test.event", { value: "original" }, { runId: "run-a" });
  returned.data.value = "caller-mutated";
  assert.equal((await store.list(1))[0].data.value, "original");
});

test("a lazy run scan coalesces followers and merges emits that arrive during reconstruction", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-lazy-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  await writeFile(path, [
    JSON.stringify({ eventId: "historical-a", sequence: 1, type: "test.event", runId: "run-a", data: { phase: "historical" } }),
    JSON.stringify({ eventId: "newer-b", sequence: 2, type: "test.event", runId: "run-b", data: { phase: "other" } }),
    "",
  ].join("\n"), "utf8");
  let releaseScan;
  let markStarted;
  const scanGate = new Promise((resolveGate) => { releaseScan = resolveGate; });
  const scanStarted = new Promise((resolveStarted) => { markStarted = resolveStarted; });
  let scans = 0;
  const store = await new EventStore(path, {
    perRunLimit: 10,
    maxRunIndexes: 1,
    runIndexEventBudget: 10,
    onRunIndexScan: async () => {
      scans += 1;
      markStarted();
      await scanGate;
    },
  }).init();
  assert.equal(store.byRun.has("run-a"), false);

  const first = store.listByRun("run-a", 10);
  await scanStarted;
  await store.emit("test.live", { phase: "live" }, { runId: "run-a" });
  const follower = store.listByRun("run-a", 10);
  releaseScan();
  const [firstResult, followerResult] = await Promise.all([first, follower]);
  assert.deepEqual(firstResult.map((event) => event.sequence), [1, 3]);
  assert.deepEqual(followerResult, firstResult, "followers wait for the authoritative historical+live merge");
  assert.equal(firstResult.filter((event) => event.sequence === 3).length, 1, "live append is deduplicated if the stream also observes it");
  assert.equal(scans, 1);
});

test("cancelling one lazy-run waiter does not abort a shared scan still in use", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-lazy-waiter-cancel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  await writeFile(path, [
    JSON.stringify({ eventId: "run-a-1", sequence: 1, type: "test.event", runId: "run-a", data: {} }),
    JSON.stringify({ eventId: "run-b-2", sequence: 2, type: "test.event", runId: "run-b", data: {} }),
    "",
  ].join("\n"), "utf8");
  let markStarted;
  let releaseScan;
  const started = new Promise((resolveStarted) => { markStarted = resolveStarted; });
  const scanGate = new Promise((resolveGate) => { releaseScan = resolveGate; });
  let scanSignal = null;
  const store = await new EventStore(path, {
    maxRunIndexes: 1,
    perRunLimit: 10,
    runIndexEventBudget: 10,
    onRunIndexScan: async ({ signal }) => {
      scanSignal = signal;
      markStarted();
      await scanGate;
    },
  }).init();

  const firstController = new AbortController();
  const first = store.listByRun("run-a", 10, { signal: firstController.signal });
  await started;
  const follower = store.listByRun("run-a", 10);
  firstController.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(scanSignal?.aborted, false, "the remaining waiter still owns the shared scan");
  releaseScan();
  assert.deepEqual((await follower).map((event) => event.sequence), [1]);
  assert.equal(store.runIndexInflight.size, 0);
  await store.close();
});

test("cancelling every lazy-run waiter aborts the disk scan and frees the inflight slot", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-lazy-all-cancel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  await writeFile(path, [
    JSON.stringify({ eventId: "run-a-1", sequence: 1, type: "test.event", runId: "run-a", data: {} }),
    JSON.stringify({ eventId: "run-b-2", sequence: 2, type: "test.event", runId: "run-b", data: {} }),
    "",
  ].join("\n"), "utf8");
  let markStarted;
  const started = new Promise((resolveStarted) => { markStarted = resolveStarted; });
  let scans = 0;
  let firstScanAborted = false;
  const store = await new EventStore(path, {
    maxRunIndexes: 1,
    perRunLimit: 10,
    runIndexEventBudget: 10,
    onRunIndexScan: ({ signal }) => {
      scans += 1;
      if (scans > 1) return;
      markStarted();
      return new Promise((resolveScan, rejectScan) => {
        signal.addEventListener("abort", () => {
          firstScanAborted = true;
          rejectScan(signal.reason);
        }, { once: true });
      });
    },
  }).init();

  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = store.listByRun("run-a", 10, { signal: firstController.signal });
  const second = store.listByRun("run-a", 10, { signal: secondController.signal });
  await started;
  firstController.abort();
  secondController.abort();
  await assert.rejects(first, { name: "AbortError" });
  await assert.rejects(second, { name: "AbortError" });
  await new Promise((resolveTick) => setImmediate(resolveTick));
  assert.equal(firstScanAborted, true);
  assert.equal(store.runIndexInflight.size, 0, "cancelled waiters cannot retain pending-load capacity");
  assert.equal(store.completeRunIndexes.has("run-a"), false, "an aborted partial scan is never published");

  assert.deepEqual((await store.listByRun("run-a", 10)).map((event) => event.sequence), [1]);
  assert.equal(scans, 2, "a later caller starts a fresh authoritative scan");
  await store.close();
});

test("close waits for already accepted emits and rejects later writes", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-close-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  const store = await new EventStore(path).init();
  const emits = Array.from({ length: 40 }, (_, index) => store.emit("test.event", { index }, { runId: "run-close" }));
  const closing = store.close();
  await Promise.all([...emits, closing]);

  const reopened = await new EventStore(path).init();
  assert.deepEqual((await reopened.listByRun("run-close", 100)).map((event) => event.sequence), Array.from({ length: 40 }, (_, index) => index + 1));
  await assert.rejects(() => store.emit("too.late"), { code: "EVENT_STORE_CLOSED" });
});

test("close aborts an active lazy scan without retaining or returning partial history", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-close-lazy-scan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  await writeFile(path, [
    JSON.stringify({ eventId: "run-a-1", sequence: 1, type: "test.event", runId: "run-a", data: { index: 1 } }),
    JSON.stringify({ eventId: "run-b-2", sequence: 2, type: "test.event", runId: "run-b", data: { index: 2 } }),
    JSON.stringify({ eventId: "run-a-3", sequence: 3, type: "test.event", runId: "run-a", data: { index: 3 } }),
    "",
  ].join("\n"), "utf8");
  const store = await new EventStore(path, {
    maxRunIndexes: 1,
    perRunLimit: 10,
    runIndexEventBudget: 10,
  }).init();
  const originalIterate = store.iterate.bind(store);
  let markScanPaused;
  let releaseScan;
  const scanPaused = new Promise((resolvePaused) => { markScanPaused = resolvePaused; });
  const scanGate = new Promise((resolveGate) => { releaseScan = resolveGate; });
  let paused = false;
  store.iterate = async function* iterateWithPause(options) {
    for await (const event of originalIterate(options)) {
      yield event;
      if (!paused) {
        paused = true;
        markScanPaused();
        await scanGate;
      }
    }
  };

  const history = store.listByRun("run-a", 10);
  await scanPaused;
  const closing = store.close();
  releaseScan();
  await assert.rejects(() => history, { code: "EVENT_STORE_CLOSED" });
  await closing;
  assert.equal(store.completeRunIndexes.has("run-a"), false);
});

test("close aborts init without publishing partial indexes", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-close-init-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  const rows = Array.from({ length: 40 }, (_, index) => ({
    eventId: `init-${index}`,
    sequence: index + 1,
    type: "test.event",
    runId: `run-${index % 3}`,
    data: { index },
  }));
  await writeFile(path, `${rows.map(JSON.stringify).join("\n")}\n`, "utf8");
  const store = new EventStore(path);
  const originalIterate = store.iterate.bind(store);
  let markPaused;
  let releaseScan;
  const paused = new Promise((resolvePaused) => { markPaused = resolvePaused; });
  const scanGate = new Promise((resolveGate) => { releaseScan = resolveGate; });
  let held = false;
  store.iterate = async function* iterateWithPause(options) {
    for await (const event of originalIterate(options)) {
      yield event;
      if (!held) {
        held = true;
        markPaused();
        await scanGate;
      }
    }
  };

  const initializing = store.init();
  await paused;
  const closing = store.close();
  releaseScan();
  await assert.rejects(() => initializing, { code: "EVENT_STORE_CLOSED" });
  await closing;
  assert.equal(store.completeRunIndexes.size, 0);
  assert.equal(store.readTasks.size, 0);
});

test("close rejects active legacy list and replay scans instead of returning partial results", async (t) => {
  for (const method of ["list", "replay"]) {
    const root = await mkdtemp(resolve(appRoot, `.test-event-close-${method}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = resolve(root, "events.jsonl");
    const rows = [
      { eventId: "small-1", sequence: 1, type: "test.small", runId: "run-a", data: {} },
      { eventId: "large-2", sequence: 2, type: "test.large", runId: "run-a", data: { blob: "x".repeat(3000) } },
      { eventId: "small-3", sequence: 3, type: "test.small", runId: "run-a", data: {} },
    ];
    await writeFile(path, `${rows.map(JSON.stringify).join("\n")}\n`, "utf8");
    const store = await new EventStore(path, {
      recentByteLimit: 1600,
      perRunByteLimit: 1600,
      runIndexByteBudget: 3200,
      maxEventBytes: 1200,
    }).init();
    const originalIterate = store.iterate.bind(store);
    let markPaused;
    let releaseScan;
    const paused = new Promise((resolvePaused) => { markPaused = resolvePaused; });
    const scanGate = new Promise((resolveGate) => { releaseScan = resolveGate; });
    let held = false;
    store.iterate = async function* iterateWithPause(options) {
      for await (const event of originalIterate(options)) {
        yield event;
        if (!held) {
          held = true;
          markPaused();
          await scanGate;
        }
      }
    };

    const reading = method === "list" ? store.list(10) : store.replay(0, 10);
    await paused;
    const closing = store.close();
    releaseScan();
    await assert.rejects(() => reading, { code: "EVENT_STORE_CLOSED" });
    await closing;
    assert.equal(store.readTasks.size, 0);
  }
});

test("legacy recent disk scans serialize instead of multiplying response memory", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-recent-scan-serial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  const rows = [
    { eventId: "small-1", sequence: 1, type: "test.small", runId: "run-a", data: {} },
    { eventId: "large-2", sequence: 2, type: "test.large", runId: "run-a", data: { blob: "x".repeat(3000) } },
    { eventId: "small-3", sequence: 3, type: "test.small", runId: "run-a", data: {} },
  ];
  await writeFile(path, `${rows.map(JSON.stringify).join("\n")}\n`, "utf8");
  const store = await new EventStore(path, {
    recentByteLimit: 1600,
    perRunByteLimit: 1600,
    runIndexByteBudget: 3200,
    maxEventBytes: 1200,
  }).init();
  const originalIterate = store.iterate.bind(store);
  let scans = 0;
  let activeScans = 0;
  let maxActiveScans = 0;
  let markFirstStarted;
  let releaseFirst;
  const firstStarted = new Promise((resolveStarted) => { markFirstStarted = resolveStarted; });
  const firstGate = new Promise((resolveGate) => { releaseFirst = resolveGate; });
  store.iterate = async function* iterateSerially(options) {
    scans += 1;
    activeScans += 1;
    maxActiveScans = Math.max(maxActiveScans, activeScans);
    try {
      if (scans === 1) {
        markFirstStarted();
        await firstGate;
      }
      yield* originalIterate(options);
    } finally {
      activeScans -= 1;
    }
  };

  const list = store.list(10);
  await firstStarted;
  const replay = store.replay(0, 10);
  await new Promise((resolveTick) => setImmediate(resolveTick));
  assert.equal(scans, 1);
  releaseFirst();
  await assert.rejects(() => list, { code: "EVENT_HISTORY_TOO_LARGE" });
  await assert.rejects(() => replay, { code: "EVENT_HISTORY_TOO_LARGE" });
  assert.equal(scans, 2);
  assert.equal(maxActiveScans, 1);
  await store.close();
});

test("iterate stops promptly when its abort signal is cancelled", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-event-abort-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, "events.jsonl");
  const lines = Array.from({ length: 500 }, (_, index) => JSON.stringify({ sequence: index + 1, type: "test.event", data: { blob: "x".repeat(512) } }));
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  const store = await new EventStore(path).init();
  const controller = new AbortController();
  const seen = [];
  for await (const event of store.iterate({ signal: controller.signal })) {
    seen.push(event.sequence);
    controller.abort();
  }
  assert.deepEqual(seen, [1]);
});
