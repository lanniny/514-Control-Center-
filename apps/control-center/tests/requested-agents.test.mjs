import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REQUESTED_AGENTS,
  addRequestedAgentId,
  composerDraftMatches,
  emptyComposerDraft,
  pruneRequestedAgentIds,
  removeRequestedAgentMention,
} from "../public/state.js";

test("requested agent selection is stable, deduplicated and bounded", () => {
  let selected = [];
  for (const id of ["claude", "codex", "grok", "kimi", "pi"]) {
    selected = addRequestedAgentId(selected, id);
  }
  assert.equal(MAX_REQUESTED_AGENTS, 4);
  assert.deepEqual(selected, ["claude", "codex", "grok", "kimi"]);
  assert.deepEqual(addRequestedAgentId(selected, "codex"), selected);
});

test("editing mention text only removes selected ids and never infers recipients", () => {
  const labels = { claude: "Fable", codex: "Codex", grok: "Grok" };
  const pruned = pruneRequestedAgentIds(
    ["claude", "codex"],
    "请 @Codex 和 @Grok 复核",
    (id) => labels[id],
  );
  assert.deepEqual(pruned, ["codex"], "manual @Grok text must not invent a stable recipient id");
});

test("removing a collaborator chip removes only its complete visible mention token", () => {
  assert.equal(
    removeRequestedAgentMention("请 @Codex 复核，保留 @CodexPlus 和 Codex 正文", "Codex"),
    "请 复核，保留 @CodexPlus 和 Codex 正文",
  );
});

test("composer draft ownership compares text and collaborators without sharing mutable state", () => {
  const submitted = { text: "  修复竞态  ", requestedAgentIds: ["codex", "grok"] };
  assert.equal(composerDraftMatches({ text: "修复竞态", requestedAgentIds: ["codex", "grok"] }, submitted), true);
  assert.equal(composerDraftMatches({ text: "修复竞态", requestedAgentIds: ["grok", "codex"] }, submitted), false);
  assert.equal(composerDraftMatches({ text: "修复竞态", requestedAgentIds: ["codex"] }, submitted), false);
  const empty = emptyComposerDraft();
  empty.requestedAgentIds.push("later");
  assert.deepEqual(emptyComposerDraft(), { text: "", requestedAgentIds: [] });
});
