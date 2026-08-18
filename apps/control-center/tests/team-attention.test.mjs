import test from "node:test";
import assert from "node:assert/strict";
import { collectTeamInbox } from "../src/collaboration-inbox.mjs";
import { classifySeatPresence, collectTeamAttention, presenceTone } from "../src/team-attention.mjs";

const team = {
  id: "team-alpha",
  name: "Alpha",
  members: ["claude-fable", "codex-technical"],
};

test("四态不得涂绿，busy 优先于 health", () => {
  assert.equal(classifySeatPresence({ health: { status: "online", available: true }, activeJobCount: 1 }), "busy");
  assert.equal(classifySeatPresence({ health: { status: "degraded", available: true } }), "degraded");
  assert.equal(classifySeatPresence({ health: { status: "offline", available: false } }), "offline");
  assert.equal(classifySeatPresence({}), "unknown");
  assert.notEqual(presenceTone("busy"), "ok");
  assert.notEqual(presenceTone("degraded"), "ok");
  assert.notEqual(presenceTone("offline"), "ok");
  assert.notEqual(presenceTone("unknown"), "ok");
});

test("attention counts come from the same inbox projection", async () => {
  const runs = [
    { id: "run-active", teamId: team.id, status: "running", title: "在跑", startAgentId: "codex-technical", updatedAt: "2026-08-18T01:00:00.000Z", turnAttempts: [{ agentId: "codex-technical", phase: "running" }] },
    { id: "run-queued", teamId: team.id, status: "queued", title: "排队", updatedAt: "2026-08-18T01:00:01.000Z" },
    { id: "run-blocked", teamId: team.id, status: "waiting_approval", title: "待批", updatedAt: "2026-08-18T01:00:02.000Z" },
    { id: "run-other", teamId: "team-beta", status: "running", title: "别人的", updatedAt: "2026-08-18T01:00:03.000Z" },
  ];
  const inbox = await collectTeamInbox({
    teamId: team.id,
    team,
    runs,
    lifecycleByKey: {},
    readTail: async (runId) => ({
      diagnostics: { status: "ok" },
      messages: runId === "run-blocked"
        ? [{ id: "ask-1", ts: "2026-08-18T01:00:04.000Z", from: "codex-technical", to: "lo", kind: "ask", text: "请 LO 决定" }]
        : [],
    }),
  });
  const attention = collectTeamAttention({
    teamId: team.id,
    team,
    inbox,
    runs,
    healthItems: [
      { id: "claude-fable", status: "degraded", available: true },
      { id: "codex-technical", status: "online", available: true },
    ],
    roster: { agents: { "codex-technical": { lastSeenAt: "2026-08-18T00:59:00.000Z" } } },
    now: "2026-08-18T01:01:00.000Z",
  });

  assert.equal(attention.schema, "514cc.team-attention/v1");
  assert.equal(attention.counts.pendingAskCount, inbox.pendingAsks.length);
  assert.equal(attention.counts.blockedCount, inbox.blockedRuns.length);
  assert.equal(attention.counts.queueDepth, 1);
  assert.equal(attention.counts.activeJobs, 1);
  assert.equal(attention.counts.activeSeats, 1);
  assert.equal(attention.queue.activeJobId, "run-active");
  assert.equal(attention.seats.find((item) => item.id === "claude-fable").presence, "degraded");
  assert.equal(attention.seats.find((item) => item.id === "codex-technical").presence, "busy");
  assert.equal(attention.seats.find((item) => item.id === "codex-technical").lastSeen, "2026-08-18T00:59:00.000Z");
  assert.equal(attention.notifications.some((group) => group.runId === "run-blocked"), true);
  assert.equal(attention.inbox, inbox);
});
