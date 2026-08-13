import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BusStore } from "../src/bus.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const busModuleUrl = new URL("../src/bus.mjs", import.meta.url).href;

const childSource = String.raw`
import { readFile, stat, writeFile } from "node:fs/promises";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { BusStore } = await import(process.env.BUS_MODULE_URL);
await writeFile(process.env.READY_FILE, "ready", "utf8");
while (true) {
  try {
    await stat(process.env.GO_FILE);
    break;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await sleep(5);
  }
}
const delayedRead = async (...args) => {
  try {
    return await readFile(...args);
  } catch (error) {
    if (error?.code === "ENOENT") await sleep(150);
    throw error;
  }
};
const bus = new BusStore({ dataRoot: process.env.DATA_ROOT, readWholeFile: delayedRead });
try {
  const message = await bus.append(process.env.RUN_ID, JSON.parse(process.env.MESSAGE));
  process.stdout.write(JSON.stringify({ ok: true, id: message.id, text: message.text }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error?.code ?? "UNKNOWN" }));
}
`;

function startAppendChild({ dataRoot, runId, message, readyFile, goFile }) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
    cwd: appRoot,
    env: {
      ...process.env,
      BUS_MODULE_URL: busModuleUrl,
      DATA_ROOT: dataRoot,
      RUN_ID: runId,
      MESSAGE: JSON.stringify(message),
      READY_FILE: readyFile,
      GO_FILE: goFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completion = new Promise((resolveCompletion, rejectCompletion) => {
    child.once("error", rejectCompletion);
    child.once("exit", (code, signal) => {
      if (code !== 0 || signal) {
        rejectCompletion(new Error(`bus append child failed (${code ?? signal}): ${stderr}`));
        return;
      }
      try {
        resolveCompletion(JSON.parse(stdout));
      } catch (error) {
        rejectCompletion(new Error(`bus append child returned invalid JSON: ${stdout}\n${stderr}`, { cause: error }));
      }
    });
  });
  return { child, completion };
}

async function waitForFiles(paths, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (const path of paths) {
    while (true) {
      try {
        await stat(path);
        break;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        if (Date.now() >= deadline) throw new Error(`timed out waiting for child barrier: ${path}`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
    }
  }
}

async function raceChildren(t, dataRoot, runId, messages) {
  const goFile = resolve(dataRoot, `${runId}.go`);
  const children = messages.map((message, index) => startAppendChild({
    dataRoot,
    runId,
    message,
    readyFile: resolve(dataRoot, `${runId}.${index}.ready`),
    goFile,
  }));
  t.after(() => {
    for (const { child } of children) {
      if (child.exitCode == null && child.signalCode == null) child.kill();
    }
  });
  await waitForFiles(messages.map((_, index) => resolve(dataRoot, `${runId}.${index}.ready`)));
  await writeFile(goFile, "go", "utf8");
  return Promise.all(children.map(({ completion }) => completion));
}

async function jsonlRecords(dataRoot, runId) {
  const raw = await readFile(resolve(dataRoot, "bus", `${runId}.jsonl`), "utf8");
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function createLockDirectory(bus, runId, { pid, nonce = randomUUID(), acquiredAt }) {
  const lockPath = bus.lockFile(runId);
  const markerPath = resolve(lockPath, `owner-${nonce}.json`);
  await mkdir(lockPath);
  await writeFile(markerPath, `${JSON.stringify({ pid, nonce, acquiredAt })}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { lockPath, markerPath };
}

test("overlapping processes append one durable record for the same stable ID and payload", async (t) => {
  const dataRoot = await mkdtemp(resolve(appRoot, ".test-bus-process-idempotent-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const runId = randomUUID();
  const message = {
    id: "answer:cross-process-idempotent",
    from: "lo",
    to: "codex-technical",
    kind: "answer",
    text: "跨进程只落一次",
    refs: { answerToAskId: "ask-1" },
  };

  const results = await raceChildren(t, dataRoot, runId, [message, message]);
  assert.deepEqual(results.map((item) => item.ok), [true, true]);
  const records = await jsonlRecords(dataRoot, runId);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, message.id);
  assert.equal(records[0].text, message.text);
});

test("overlapping processes reject conflicting reuse without writing conflicting JSONL records", async (t) => {
  const dataRoot = await mkdtemp(resolve(appRoot, ".test-bus-process-conflict-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const runId = randomUUID();
  const base = {
    id: "steer:cross-process-conflict",
    from: "lo",
    to: "codex-technical",
    kind: "steer",
    refs: { queuedSteerId: "steer-1" },
  };

  const results = await raceChildren(t, dataRoot, runId, [
    { ...base, text: "payload-a" },
    { ...base, text: "payload-b" },
  ]);
  assert.equal(results.filter((item) => item.ok).length, 1);
  assert.equal(results.filter((item) => item.code === "BUS_MESSAGE_CONFLICT").length, 1);
  const records = await jsonlRecords(dataRoot, runId);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, base.id);
  assert.ok(["payload-a", "payload-b"].includes(records[0].text));
});

test("BusStore recovers an old lock whose owner is gone", async (t) => {
  const dataRoot = await mkdtemp(resolve(appRoot, ".test-bus-lock-stale-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const runId = randomUUID();
  const bus = new BusStore({
    dataRoot,
    lockTimeoutMs: 500,
    lockStaleMs: 20,
    lockRetryMinMs: 2,
    lockRetryMaxMs: 4,
  });
  await mkdir(resolve(dataRoot, "bus"), { recursive: true });
  const staleLock = await createLockDirectory(bus, runId, {
    pid: -1,
    acquiredAt: "2000-01-01T00:00:00.000Z",
  });
  const old = new Date("2000-01-01T00:00:00.000Z");
  await utimes(staleLock.markerPath, old, old);
  await utimes(staleLock.lockPath, old, old);

  const appended = await bus.append(runId, {
    id: "recovered",
    from: "lo",
    to: "team",
    kind: "system",
    text: "stale lock recovered",
  });
  assert.equal(appended.id, "recovered");
  assert.equal((await jsonlRecords(dataRoot, runId)).length, 1);
  await assert.rejects(() => stat(bus.lockFile(runId)), { code: "ENOENT" });
});

test("BusStore migrates a stale legacy file lock without weakening current lock ownership", async (t) => {
  const dataRoot = await mkdtemp(resolve(appRoot, ".test-bus-lock-legacy-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const runId = randomUUID();
  const bus = new BusStore({
    dataRoot,
    lockTimeoutMs: 500,
    lockStaleMs: 20,
    lockRetryMinMs: 2,
    lockRetryMaxMs: 4,
  });
  await mkdir(resolve(dataRoot, "bus"), { recursive: true });
  await writeFile(bus.lockFile(runId), `${JSON.stringify({
    pid: -1,
    nonce: randomUUID(),
    acquiredAt: "2000-01-01T00:00:00.000Z",
  })}\n`, { encoding: "utf8", flag: "wx" });
  const old = new Date("2000-01-01T00:00:00.000Z");
  await utimes(bus.lockFile(runId), old, old);

  const appended = await bus.append(runId, {
    id: "legacy-recovered",
    from: "lo",
    to: "team",
    kind: "system",
    text: "legacy stale lock recovered",
  });
  assert.equal(appended.id, "legacy-recovered");
  assert.equal((await jsonlRecords(dataRoot, runId)).length, 1);
  await assert.rejects(() => stat(bus.lockFile(runId)), { code: "ENOENT" });
});

test("stale reapers in separate processes cannot double-write a conflicting stable ID", async (t) => {
  const dataRoot = await mkdtemp(resolve(appRoot, ".test-bus-stale-reapers-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const runId = randomUUID();
  const bus = new BusStore({ dataRoot });
  await mkdir(resolve(dataRoot, "bus"), { recursive: true });
  await writeFile(bus.lockFile(runId), `${JSON.stringify({
    pid: -1,
    nonce: randomUUID(),
    acquiredAt: "2000-01-01T00:00:00.000Z",
  })}\n`, { encoding: "utf8", flag: "wx" });
  const old = new Date("2000-01-01T00:00:00.000Z");
  await utimes(bus.lockFile(runId), old, old);

  const stableId = "steer:stale-reaper-conflict";
  const messages = Array.from({ length: 6 }, (_, index) => ({
    id: stableId,
    from: "lo",
    to: "codex-technical",
    kind: "steer",
    text: `conflicting-payload-${index}`,
  }));
  const results = await raceChildren(t, dataRoot, runId, messages);

  assert.equal(results.filter((item) => item.ok).length, 1);
  assert.equal(results.filter((item) => item.code === "BUS_MESSAGE_CONFLICT").length, messages.length - 1);
  const records = await jsonlRecords(dataRoot, runId);
  assert.equal(records.length, 1);
  assert.equal(records.filter((record) => record.id === stableId).length, 1);
  assert.ok(messages.some((message) => message.text === records[0].text));
});

test("BusStore lock wait is bounded while a live owner holds the run", async (t) => {
  const dataRoot = await mkdtemp(resolve(appRoot, ".test-bus-lock-timeout-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const runId = randomUUID();
  const bus = new BusStore({
    dataRoot,
    lockTimeoutMs: 80,
    lockStaleMs: 10,
    lockRetryMinMs: 2,
    lockRetryMaxMs: 4,
  });
  await mkdir(resolve(dataRoot, "bus"), { recursive: true });
  await createLockDirectory(bus, runId, {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  });
  const startedAt = Date.now();
  await assert.rejects(
    () => bus.append(runId, { id: "blocked", from: "lo", text: "must wait" }),
    { code: "BUS_LOCK_TIMEOUT" },
  );
  assert.ok(Date.now() - startedAt < 1_000, "lock timeout exceeded its bounded wait");
});
