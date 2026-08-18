import test from "node:test";
import assert from "node:assert/strict";
import { collectTeamInbox, INBOX_LIMITS, scopedInboxRuns } from "../src/collaboration-inbox.mjs";

const team = { id: "team-alpha", name: "Alpha" };
const run = (id, updatedAt, status = "running", teamId = "team-alpha") => ({
  id,
  teamId,
  status,
  title: `任务 ${id}`,
  updatedAt,
});

test("消息收发局只读取当前团队 run，并对 bus 读取施加并发上限", async () => {
  const runs = [
    run("run-new", "2026-08-17T00:00:03.000Z"),
    run("run-old", "2026-08-17T00:00:01.000Z", "waiting_approval"),
    run("run-other", "2026-08-17T00:00:04.000Z", "running", "team-beta"),
  ];
  assert.deepEqual(scopedInboxRuns("team-alpha", runs).map((item) => item.id), ["run-new", "run-old"]);

  let inflight = 0;
  let peak = 0;
  const result = await collectTeamInbox({
    teamId: team.id,
    team,
    runs,
    maxConcurrentReads: 1,
    readTail: async (runId) => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inflight -= 1;
      if (runId === "run-old") {
        return {
          diagnostics: { status: "degraded", issues: [{ code: "BUS_JSONL_TRUNCATED_LINE", message: "尾部截断" }] },
          messages: [
            { id: "ask-old", ts: "2026-08-17T00:00:02.000Z", runId, from: "codex-technical", to: "lo", kind: "ask", text: "已回答的问题" },
            { id: "answer-old", ts: "2026-08-17T00:00:03.000Z", runId, from: "lo", to: "codex-technical", kind: "answer", text: "采用方案", refs: { answerToAskId: "ask-old" } },
            { id: "ask-unresolved", ts: "2026-08-17T00:00:04.000Z", runId, from: "codex-technical", to: "lo", kind: "ask", text: "请 LO 决定下一步" },
          ],
        };
      }
      return {
        diagnostics: { status: "ok", parsedMessages: 3 },
        messages: [
          { id: "answer-new", ts: "2026-08-17T00:00:05.000Z", runId, from: "claude-fable", to: "lo", kind: "answer", text: "已完成" },
          { id: "memo-new", ts: "2026-08-17T00:00:06.000Z", runId, from: "claude-fable", to: "team", kind: "memo", text: "不会出现在收发局" },
          { id: "decide-new", ts: "2026-08-17T00:00:04.000Z", runId, from: "lo", to: "team", kind: "decide", text: "采用方案 A" },
        ],
      };
    },
  });

  assert.equal(peak, 1);
  assert.deepEqual(result.messages.map((item) => item.id), ["answer-new", "ask-unresolved", "decide-new", "answer-old", "ask-old"]);
  assert.equal(result.pendingAsks[0].id, "ask-unresolved");
  assert.equal(result.pendingAsks.some((item) => item.id === "ask-old"), false);
  assert.equal(result.recentAnswers[0].id, "answer-new");
  assert.equal(result.blockedRuns[0].id, "run-old");
  assert.equal(result.diagnostics.status, "partial");
  assert.equal(result.sources.length, 2);
  assert.equal(result.messages.some((item) => item.kind === "memo"), false);
});

test("消息收发局在空团队和单源失败时保持可解释的诊断", async () => {
  const empty = await collectTeamInbox({ teamId: team.id, team, runs: [], readTail: async () => ({ messages: [], diagnostics: { status: "missing" } }) });
  assert.equal(empty.diagnostics.status, "empty");
  assert.deepEqual(empty.messages, []);

  const failed = await collectTeamInbox({
    teamId: team.id,
    team,
    runs: [run("run-failed", "2026-08-17T00:00:01.000Z")],
    readTail: async () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); },
  });
  assert.equal(failed.diagnostics.status, "partial");
  assert.equal(failed.sources[0].diagnostics.issues[0].code, "EACCES");
  assert.doesNotMatch(JSON.stringify(failed), /[A-Z]:\\\\/);
});

test("消息收发局拒绝不匹配的团队投影", async () => {
  await assert.rejects(
    () => collectTeamInbox({ teamId: "team-beta", team, runs: [], readTail: async () => ({}) }),
    { code: "VALIDATION_FAILED" },
  );
});

test("不同 run 的相同 ask id 不会被其他 run 的 answer 错误关闭", async () => {
  const result = await collectTeamInbox({
    teamId: team.id,
    team,
    runs: [
      run("run-ask", "2026-08-17T00:00:02.000Z"),
      run("run-answer", "2026-08-17T00:00:01.000Z"),
    ],
    readTail: async (runId) => ({
      diagnostics: { status: "ok" },
      messages: runId === "run-ask"
        ? [{ id: "shared-id", ts: "2026-08-17T00:00:03.000Z", from: "codex-technical", to: "lo", kind: "ask", text: "仍需 LO 回答" }]
        : [{ id: "answer-other", ts: "2026-08-17T00:00:04.000Z", from: "lo", to: "claude-fable", kind: "answer", text: "回答另一个任务", refs: { answerToAskId: "shared-id" } }],
    }),
  });

  assert.deepEqual(result.pendingAsks.map((item) => [item.runId, item.id]), [["run-ask", "shared-id"]]);
});

test("run 上限截断会把 inbox 标记为 partial 而不是完整 ok", async () => {
  const runs = Array.from({ length: INBOX_LIMITS.maxRuns + 1 }, (_, index) => (
    run(`run-${index}`, new Date(index * 1_000).toISOString())
  ));
  const result = await collectTeamInbox({
    teamId: team.id,
    team,
    runs,
    readTail: async () => ({ messages: [], diagnostics: { status: "ok" } }),
  });

  assert.equal(result.diagnostics.runsRead, INBOX_LIMITS.maxRuns);
  assert.equal(result.diagnostics.runsTotal, INBOX_LIMITS.maxRuns + 1);
  assert.equal(result.diagnostics.runsTruncated, true);
  assert.equal(result.diagnostics.status, "partial");
});

test("stored answered 且 bus 无 answer 时 pendingAsks 必须留下", async () => {
  const askKey = "run-orphan\u0000ask-orphan";
  const result = await collectTeamInbox({
    teamId: team.id,
    team,
    runs: [run("run-orphan", "2026-08-18T01:00:00.000Z", "pendingAsk")],
    lifecycleByKey: {
      [askKey]: { state: "answered", revision: 2 },
    },
    readTail: async () => ({
      diagnostics: { status: "ok" },
      messages: [
        { id: "ask-orphan", ts: "2026-08-18T01:00:01.000Z", from: "codex-technical", to: "lo", kind: "ask", text: "账本写了已答，bus 上没有" },
      ],
    }),
  });

  assert.equal(result.messages[0].lifecycle, "answered");
  assert.deepEqual(result.pendingAsks.map((item) => item.id), ["ask-orphan"]);
});
