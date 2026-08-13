import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { BUS_TAIL_LIMITS, BusStore } from "../src/bus.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

async function tempBus(t, prefix) {
  const dataRoot = await mkdtemp(resolve(appRoot, prefix));
  await mkdir(resolve(dataRoot, "bus"), { recursive: true });
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  return dataRoot;
}

test("BusStore readTail bounds real disk I/O by bytes and retains only the newest message budget", async (t) => {
  const dataRoot = await tempBus(t, ".test-bus-tail-large-");
  const runId = randomUUID();
  const messages = Array.from({ length: 5_000 }, (_, index) => ({
    id: `message-${index}`,
    runId,
    from: "claude-fable",
    to: "codex-technical",
    kind: "say",
    text: `bounded-${index}-${"x".repeat(96)}`,
    ts: new Date(index * 1_000).toISOString(),
  }));
  const body = `${messages.map(JSON.stringify).join("\n")}\n`;
  const path = resolve(dataRoot, "bus", `${runId}.jsonl`);
  await writeFile(path, body, "utf8");

  let streamOptions = null;
  const bus = new BusStore({
    dataRoot,
    openFile: async (...args) => {
      const handle = await open(...args);
      return {
        stat: (...statArgs) => handle.stat(...statArgs),
        createReadStream: (options) => {
          streamOptions = { ...options };
          return handle.createReadStream(options);
        },
        close: () => handle.close(),
      };
    },
  });
  const maxBytes = 4_096;
  const maxMessages = 7;
  const result = await bus.readTail(runId, { maxBytes, maxMessages });

  assert.deepEqual(result.messages.map((item) => item.id), messages.slice(-maxMessages).map((item) => item.id));
  assert.equal(result.diagnostics.status, "ok");
  assert.equal(result.diagnostics.fileSizeBytes, Buffer.byteLength(body));
  assert.ok(result.diagnostics.bytesRead <= maxBytes, `read ${result.diagnostics.bytesRead} bytes`);
  assert.ok(streamOptions, "tail read did not create a bounded stream");
  assert.ok(streamOptions.end - streamOptions.start + 1 <= maxBytes);
  assert.equal(streamOptions.autoClose, false);
  assert.deepEqual(result.diagnostics.truncated, { bytes: true, messages: true });

  await assert.rejects(
    () => bus.readTail(runId, { maxBytes: BUS_TAIL_LIMITS.maxBytes + 1 }),
    { code: "VALIDATION_FAILED" },
  );
  await assert.rejects(
    () => bus.readTail(runId, { maxMessages: BUS_TAIL_LIMITS.maxMessages + 1 }),
    { code: "VALIDATION_FAILED" },
  );
});

test("BusStore readTail aborts the underlying stream and closes its handle", async () => {
  const runId = randomUUID();
  const controller = new AbortController();
  const disconnect = Object.assign(new Error("client disconnected"), {
    name: "AbortError",
    code: "CLIENT_DISCONNECTED",
  });
  let observedSignal = null;
  let closed = false;
  const bus = new BusStore({
    dataRoot: appRoot,
    openFile: async () => ({
      stat: async () => ({ size: 4_096 }),
      createReadStream: ({ signal }) => {
        observedSignal = signal;
        const stream = new Readable({ read() {} });
        signal.addEventListener("abort", () => stream.destroy(signal.reason), { once: true });
        return stream;
      },
      close: async () => { closed = true; },
    }),
  });

  const pending = bus.readTail(runId, { signal: controller.signal });
  setImmediate(() => controller.abort(disconnect));
  await assert.rejects(pending, (error) => error === disconnect);
  assert.equal(observedSignal, controller.signal);
  assert.equal(closed, true);
});

test("BusStore exposes EACCES diagnostics while preserving ENOENT and healthy array compatibility", async (t) => {
  const dataRoot = await tempBus(t, ".test-bus-tail-errors-");
  const runId = randomUUID();
  const denied = Object.assign(new Error("permission denied at C:\\private\\bus.jsonl"), { code: "EACCES" });
  const bus = new BusStore({
    dataRoot,
    openFile: async () => { throw denied; },
    readWholeFile: async () => { throw denied; },
  });

  const tail = await bus.readTail(runId);
  assert.deepEqual(tail.messages, []);
  assert.equal(tail.diagnostics.status, "degraded");
  assert.deepEqual(tail.diagnostics.issues, [{
    code: "BUS_READ_FAILED",
    message: "bus JSONL could not be read",
    systemCode: "EACCES",
  }]);
  assert.equal(JSON.stringify(tail).includes("private"), false);
  await assert.rejects(
    () => bus.read(runId),
    (error) => error.code === "BUS_READ_FAILED" && error.diagnostics?.issues?.[0]?.systemCode === "EACCES",
  );

  const normal = new BusStore({ dataRoot });
  assert.deepEqual(await normal.read(runId), [], "ENOENT remains the compatible empty-array case");
  await normal.append(runId, { from: "lo", to: "team", kind: "task", text: "healthy" });
  const messages = await normal.read(runId);
  assert.ok(Array.isArray(messages));
  assert.equal(messages.length, 1);
});

test("BusStore reports malformed and truncated JSONL without discarding valid tail records", async (t) => {
  const dataRoot = await tempBus(t, ".test-bus-tail-corrupt-");
  const runId = randomUUID();
  const valid = [
    { id: "first", ts: "2026-07-23T00:00:00.000Z", runId, from: "a", to: "b", kind: "say", text: "one" },
    { id: "last", ts: "2026-07-23T00:00:01.000Z", runId, from: "b", to: "a", kind: "say", text: "two" },
  ];
  const path = resolve(dataRoot, "bus", `${runId}.jsonl`);
  await writeFile(path, `${JSON.stringify(valid[0])}\nnot-json\n${JSON.stringify(valid[1])}\n{"id":`, "utf8");
  const bus = new BusStore({ dataRoot });

  const tail = await bus.readTail(runId, { maxBytes: 8_192, maxMessages: 20 });
  assert.deepEqual(tail.messages.map((item) => item.id), ["first", "last"]);
  assert.equal(tail.diagnostics.status, "degraded");
  assert.equal(tail.diagnostics.malformedLines, 2);
  assert.deepEqual(
    tail.diagnostics.issues.map((item) => item.code),
    ["BUS_JSONL_MALFORMED_LINE", "BUS_JSONL_TRUNCATED_LINE"],
  );
  await assert.rejects(
    () => bus.read(runId),
    (error) => error.code === "BUS_JSONL_CORRUPT" && error.diagnostics?.malformedLines === 2,
  );
});

test("BusStore degrades when the byte budget cannot contain one complete JSONL record", async (t) => {
  const dataRoot = await tempBus(t, ".test-bus-tail-oversized-");
  const runId = randomUUID();
  const path = resolve(dataRoot, "bus", `${runId}.jsonl`);
  await writeFile(path, `${JSON.stringify({ id: "oversized", runId, text: "界".repeat(2_000) })}\n`, "utf8");
  const bus = new BusStore({ dataRoot });

  const tail = await bus.readTail(runId, { maxBytes: 128, maxMessages: 10 });
  assert.deepEqual(tail.messages, []);
  assert.equal(tail.diagnostics.status, "degraded");
  assert.equal(tail.diagnostics.truncated.bytes, true);
  assert.equal(tail.diagnostics.issues[0]?.code, "BUS_TAIL_NO_COMPLETE_RECORD");
});

test("BusStore rejects cross-run and incomplete JSON objects from the audited tail", async (t) => {
  const dataRoot = await tempBus(t, ".test-bus-tail-schema-");
  const runId = randomUUID();
  const otherRunId = randomUUID();
  const valid = {
    id: "valid",
    ts: "2026-07-23T00:00:00.000Z",
    runId,
    from: "lo",
    to: "claude-fable",
    kind: "task",
    text: "bounded",
    ignored: "password=must-not-cross-the-read-boundary",
  };
  const crossRun = { ...valid, id: "cross-run", runId: otherRunId };
  const incomplete = { runId };
  const path = resolve(dataRoot, "bus", `${runId}.jsonl`);
  await writeFile(path, `${[valid, crossRun, incomplete].map(JSON.stringify).join("\n")}\n`, "utf8");
  const bus = new BusStore({ dataRoot });

  const tail = await bus.readTail(runId);
  assert.deepEqual(tail.messages, [{
    id: valid.id,
    ts: valid.ts,
    runId: valid.runId,
    from: valid.from,
    to: valid.to,
    kind: valid.kind,
    text: valid.text,
  }]);
  assert.equal(JSON.stringify(tail).includes("must-not-cross"), false);
  assert.equal(tail.diagnostics.status, "degraded");
  assert.equal(tail.diagnostics.parsedMessages, 1);
  assert.equal(tail.diagnostics.malformedLines, 2);
  assert.deepEqual(tail.diagnostics.issues.map((item) => item.code), [
    "BUS_JSONL_INVALID_RECORD",
    "BUS_JSONL_INVALID_RECORD",
  ]);
  await assert.rejects(() => bus.read(runId), { code: "BUS_JSONL_CORRUPT" });
});
