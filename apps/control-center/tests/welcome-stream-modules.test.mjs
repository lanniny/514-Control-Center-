import test from "node:test";
import assert from "node:assert/strict";
import {
  nextStreamEpochState,
  readStreamEpochFromHeaders,
  readStreamEpochFromReadyPayload,
} from "../public/modules/stream-epoch.js";
import {
  WELCOME_TIPS,
  pickWelcomeTip,
  welcomeTipMarkup,
} from "../public/modules/welcome-tips.js";
import { AGENT_ROLE_BLURB, roleBlurbFor } from "../public/modules/agent-roles.js";

test("stream epoch reset only when epoch actually changes", () => {
  assert.deepEqual(nextStreamEpochState(null, "e1"), {
    changed: false,
    epoch: "e1",
    resetSequence: false,
  });
  assert.deepEqual(nextStreamEpochState("e1", "e1"), {
    changed: false,
    epoch: "e1",
    resetSequence: false,
  });
  assert.deepEqual(nextStreamEpochState("e1", "e2"), {
    changed: true,
    epoch: "e2",
    resetSequence: true,
  });
  assert.equal(readStreamEpochFromHeaders({ get: (k) => (k === "x-514cc-stream-epoch" ? "epoch-x" : null) }), "epoch-x");
  assert.equal(readStreamEpochFromReadyPayload({ streamEpoch: "epoch-y" }), "epoch-y");
});

test("welcome tips catalog is non-empty and markup embeds tip html", () => {
  assert.ok(WELCOME_TIPS.length >= 6);
  const tip = pickWelcomeTip(() => 0);
  assert.equal(tip, WELCOME_TIPS[0]);
  const html = welcomeTipMarkup({ iconHtml: "<svg></svg>", random: () => 0 });
  assert.match(html, /welcome-tip/);
  assert.match(html, /@/);
  assert.match(html, /原生 CLI/);
});

test("agent role blurbs cover multi-CLI governance identities", () => {
  assert.match(roleBlurbFor("claude-fable"), /规划编排席/);
  assert.doesNotMatch(roleBlurbFor("claude-fable"), /主脑/);
  assert.match(roleBlurbFor("codex-technical"), /烛|评审/);
  assert.match(roleBlurbFor("grok-search"), /织|情报/);
  assert.equal(Object.keys(AGENT_ROLE_BLURB).length >= 5, true);
});
