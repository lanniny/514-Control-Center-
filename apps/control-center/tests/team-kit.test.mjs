import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { classifyTeamMcp, classifyTeamSkill } from "../public/modules/team-kit.js";

test("team kit classifies skills against the live capability matrix", () => {
  const catalogCodes = ["co-review", "ssh"];
  const memberIds = ["claude-fable", "codex-technical"];
  const agentSkillStates = {
    "claude-fable": { disabledSkills: ["ssh"] },
    "codex-technical": { disabledSkills: ["ssh", "co-review"] },
  };
  assert.equal(classifyTeamSkill("missing", { catalogCodes, memberIds, agentSkillStates }), "ghost");
  assert.equal(classifyTeamSkill("ssh", { catalogCodes, memberIds, agentSkillStates }), "gated");
  assert.equal(classifyTeamSkill("co-review", { catalogCodes, memberIds, agentSkillStates }), "partial");
  assert.equal(classifyTeamSkill("co-review", { catalogCodes, memberIds: ["claude-fable"], agentSkillStates }), "ok");
});

test("team kit classifies MCP against quarantine", () => {
  const servers = [
    { name: "serena", disabled: true },
    { name: "exa", disabled: false },
  ];
  assert.equal(classifyTeamMcp("ghost-mcp", { servers }), "ghost");
  assert.equal(classifyTeamMcp("serena", { servers }), "off");
  assert.equal(classifyTeamMcp("exa", { servers }), "ok");
});

test("team page treats the kit as a live menu, not a second inventory", async () => {
  const html = await readFile(resolve(import.meta.dirname, "../public/index.html"), "utf8");
  const app = await readFile(resolve(import.meta.dirname, "../public/app.js"), "utf8");
  assert.match(html, /能力配结/);
  assert.match(html, /id="team-kit-note"/);
  assert.match(app, /classifyTeamSkill/);
  assert.match(app, /showToggle: !readOnly/);
});
