import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createLatestRequestGate } from "../public/modules/request-ownership.js";

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

test("latest request gate rejects late runs snapshots without aborting useful work", async () => {
  const gate = createLatestRequestGate();
  const state = { value: null };
  const first = deferred();
  const second = deferred();
  const load = async (pending, value) => {
    const token = gate.begin();
    await pending.promise;
    if (gate.isCurrent(token)) state.value = value;
  };
  const firstRun = load(first, "old");
  const secondRun = load(second, "new");
  second.resolve();
  await secondRun;
  first.resolve();
  await firstRun;
  assert.equal(state.value, "new");
});

test("invalidating a request prevents its response from committing", () => {
  const gate = createLatestRequestGate();
  const token = gate.begin();
  gate.invalidate();
  assert.equal(gate.isCurrent(token), false);
});

test("loadRuns commits state only while it owns the latest generation", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function loadRuns()"), source.indexOf("async function loadApprovals()"));
  assert.ok(body.indexOf("const generation = loadRunsRequestGate.begin()") < body.indexOf("await request(API.runs)"));
  assert.ok(body.indexOf("if (!loadRunsRequestGate.isCurrent(generation)) return payload") < body.indexOf("state.runs ="));
});

test("loadHealth commits state only while it owns the latest generation", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function loadHealth()"), source.indexOf("async function loadUsageOverview"));
  assert.ok(body.indexOf("const generation = loadHealthRequestGate.begin()") < body.indexOf("await request(API.health)"));
  assert.ok(body.indexOf("if (!loadHealthRequestGate.isCurrent(generation)) return payload") < body.indexOf("state.health ="));
  assert.match(body, /if \(loadHealthRequestGate\.isCurrent\(generation\)\)/);
});
