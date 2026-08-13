import test from "node:test";
import assert from "node:assert/strict";
import {
  eventForUi,
  UI_EVENT_COLLECTION_LIMIT,
  UI_EVENT_NODE_BUDGET,
  UI_EVENT_STRING_BUDGET,
} from "../src/event-view.mjs";

test("UI event projection replaces oversized conversation payloads with bounded metadata", () => {
  const secret = "token=ui-projection-secret";
  const text = `${secret}\n${"A".repeat(80 * 1024)}`;
  const input = `${secret}\n${"I".repeat(12 * 1024)}`;
  const event = {
    eventId: "ui-large-event",
    type: "assistant.message",
    sequence: 7,
    data: {
      text,
      tools: [{ name: "shell", input }],
      results: Array.from({ length: UI_EVENT_COLLECTION_LIMIT + 5 }, (_, index) => ({ text: `result ${index}` })),
    },
  };

  const projected = eventForUi(event);
  assert.equal(projected.data.text, "");
  assert.equal(projected.data.textLength, text.length);
  assert.equal(projected.data.textOmitted, true);
  assert.equal(projected.data.tools[0].input, "");
  assert.equal(projected.data.tools[0].inputLength, input.length);
  assert.equal(projected.data.tools[0].inputOmitted, true);
  assert.equal(projected.data.results.length, UI_EVENT_COLLECTION_LIMIT);
  assert.equal(projected.data.resultsTotal, UI_EVENT_COLLECTION_LIMIT + 5);
  assert.equal(JSON.stringify(projected).includes(secret), false);
  assert.equal(event.data.text, text, "projection must not mutate the durable event");
});

test("UI event projection hashes adversarially long identities without losing stable equality", () => {
  const rawId = "x".repeat(2_000);
  const left = eventForUi({ eventId: rawId, type: "runtime.heartbeat", data: { status: "ok" } });
  const right = eventForUi({ eventId: rawId, type: "runtime.heartbeat", data: { status: "ok" } });
  assert.match(left.eventId, /^sha256:/);
  assert.equal(left.eventId, right.eventId);
  assert.ok(left.eventId.length < 100);
});

test("UI event projection enforces one total budget across adversarial breadth", () => {
  const branch = () => Object.fromEntries(Array.from(
    { length: 64 },
    (_, index) => [`field-${index}`, "v".repeat(4 * 1024)],
  ));
  const projected = eventForUi({
    eventId: "ui-budget-event",
    type: "runtime.heartbeat",
    data: {
      branches: Array.from({ length: UI_EVENT_COLLECTION_LIMIT }, branch),
      ["k".repeat(8 * 1024)]: "must-not-retain-an-unbounded-key",
    },
  });
  const serialized = JSON.stringify(projected);

  assert.ok(serialized.length < 256 * 1024, `projection escaped its total budget: ${serialized.length}`);
  assert.equal(serialized.includes("k".repeat(512)), false);
  assert.ok(UI_EVENT_STRING_BUDGET <= 64 * 1024);
  assert.ok(UI_EVENT_NODE_BUDGET <= 1_024);
});

test("UI event projection preserves protocol identity after an earlier payload exhausts the node budget", () => {
  const data = {
    branches: Array.from(
      { length: UI_EVENT_COLLECTION_LIMIT },
      (_, branchIndex) => Object.fromEntries(Array.from(
        { length: 64 },
        (_, fieldIndex) => [`field-${branchIndex}-${fieldIndex}`, fieldIndex],
      )),
    ),
  };
  const event = {
    data,
    eventId: "late-event-id",
    type: "runtime.heartbeat",
    runId: "late-run-id",
  };
  const left = eventForUi(event);
  const right = eventForUi(event);

  assert.ok(left.data.branches.length < UI_EVENT_COLLECTION_LIMIT, "fixture must exhaust the node budget");
  assert.equal(left.data.branchesTotal, UI_EVENT_COLLECTION_LIMIT);
  assert.ok(left.eventId);
  assert.equal(left.eventId, right.eventId);
  assert.equal(left.type, "runtime.heartbeat");
  assert.equal(left.runId, "late-run-id");
});
