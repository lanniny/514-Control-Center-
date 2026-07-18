import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGrokArgs, GrokBuildAdapter } from "../src/adapters/grok-build.mjs";
import { createLfCollector } from "../src/adapters/stream-utils.mjs";

test("buildGrokArgs places prompt, resume, model and streaming format in order", () => {
  assert.deepEqual(buildGrokArgs({ prompt: "hi" }), ["-p", "hi", "--permission-mode", "plan", "--output-format", "streaming-json"]);
  assert.deepEqual(buildGrokArgs({ prompt: "again", sessionId: "s1", model: "grok45-514" }), [
    "-p", "again", "-r", "s1", "-m", "grok45-514", "--permission-mode", "plan", "--output-format", "streaming-json",
  ]);
  // M8：主脑/只读轮锁 plan（只读），仅审批过的 build 专家轮映射 acceptEdits——coordinator-plan 不变量接线
  assert.deepEqual(buildGrokArgs({ prompt: "w", permissionMode: "workspace-write" }), [
    "-p", "w", "--permission-mode", "acceptEdits", "--output-format", "streaming-json",
  ]);
});

test("GrokBuildAdapter rejects prompts over the arg budget without spawning", async () => {
  const events = [];
  const adapter = new GrokBuildAdapter({ eventStore: { emit: (t, d) => events.push([t, d]) }, cwd: "." });
  await assert.rejects(() => adapter.send({ prompt: "x".repeat(25_000), runId: "r" }), { code: "INVALID_PROMPT" });
  assert.equal(events.length, 0, "no events emitted when the prompt is rejected up front");
});

test("streaming-json event shape: thought stream ignored, text accumulated, end carries sessionId", () => {
  // 复用生产 collector 解析真实 grok streaming-json 三段式（2026-07-17 实测格式）
  const seen = [];
  const collector = createLfCollector((event) => seen.push(event));
  const lines = [
    '{"type":"thought","data":"The"}',
    '{"type":"thought","data":" user"}',
    '{"type":"text","data":"O"}',
    '{"type":"text","data":"K"}',
    '{"type":"end","stopReason":"EndTurn","sessionId":"019f6e79-abcd","usage":{"total_tokens":42}}',
  ];
  collector.push(lines.join("\n") + "\n");
  collector.end();
  const thoughts = seen.filter((e) => e.type === "thought").length;
  const text = seen.filter((e) => e.type === "text").map((e) => e.data).join("");
  const end = seen.find((e) => e.type === "end");
  assert.equal(thoughts, 2);
  assert.equal(text, "OK");
  assert.equal(end.sessionId, "019f6e79-abcd");
  assert.equal(end.usage.total_tokens, 42);
});
