import test from "node:test";
import assert from "node:assert/strict";
import { resumeHintsFromSessions, resumeHintsMarkup } from "../public/modules/resume-hints.js";

test("resume hints map provider-native commands only", () => {
  const hints = resumeHintsFromSessions({
    "claude-fable": "sess-c1",
    "codex-technical": "sess-x1",
    "kimi-frontend": "sess-k1",
    "pi-resident": "sess-p1",
  });
  assert.equal(hints.find((h) => h.agentId === "claude-fable").command, "claude -r sess-c1");
  assert.equal(hints.find((h) => h.agentId === "codex-technical").command, "codex exec resume sess-x1");
  assert.equal(hints.find((h) => h.agentId === "kimi-frontend").command, "kimi -S sess-k1");
  assert.equal(hints.find((h) => h.agentId === "pi-resident").canResume, false);
});

test("resume hints markup only lists canResume commands", () => {
  const html = resumeHintsMarkup(
    resumeHintsFromSessions({ "claude-fable": "abc", "pi-resident": "nope" }),
    { escapeHtml: (value) => String(value) },
  );
  assert.match(html, /claude -r abc/);
  assert.doesNotMatch(html, /pi-resident/);
  assert.match(html, /data-copy-resume/);
});
