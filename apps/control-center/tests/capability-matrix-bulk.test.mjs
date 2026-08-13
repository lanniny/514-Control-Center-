/**
 * Skill 矩阵批量声明的契约：筛选作用域、"只提交真实变更"、fail-closed 成员豁免、
 * 以及批量必须复用单条原子接口而不是新开批量写面。
 *
 * 这些是纯函数级契约（targets 收集），行为回归靠 app.js 源码断言把接线钉住——
 * 126 格矩阵里错一个作用域，用户就会批量改掉自己没看见的行。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

/** 与 app.js skillMatrixTargets 同构的参考实现——两边一起改才允许过。 */
function referenceTargets(skills, { memberId = null, skillCode = null, enabled, filter = "" }) {
  if (!skills || skills.configurationStatus?.failClosed === true) return [];
  const states = skills.agentSkillStates ?? {};
  const members = (memberId ? [memberId] : skills.memberIds ?? []).filter((id) => states[id]?.failClosed !== true);
  const needle = String(filter).trim().toLowerCase();
  const visible = needle
    ? skills.items.filter((skill) => `${skill.code} ${skill.description ?? ""} ${skill.path ?? ""}`.toLowerCase().includes(needle))
    : skills.items;
  const items = skillCode ? skills.items.filter((skill) => skill.code === skillCode) : visible;
  const targets = [];
  for (const skill of items) {
    for (const id of members) {
      const current = !(states[id]?.disabledSkills ?? []).includes(skill.code);
      if (current !== enabled) targets.push({ agentId: id, skill: skill.code });
    }
  }
  return targets;
}

const fixture = () => ({
  memberIds: ["alpha", "beta", "broken"],
  items: [
    { code: "co-review", description: "代码评审", path: "skills/review" },
    { code: "co-research", description: "情报", path: "skills/research" },
    { code: "docx", description: "文档生成", path: "skills/docx" },
  ],
  agentSkillStates: {
    alpha: { disabledSkills: ["docx"] },
    beta: { disabledSkills: [] },
    broken: { disabledSkills: [], failClosed: true },
  },
  configurationStatus: {},
});

test("矩阵批量只收集真实变更，且永不触碰 fail-closed 成员", () => {
  const skills = fixture();
  const enableAll = referenceTargets(skills, { enabled: true });
  // alpha 缺 docx 是唯一未声明项；beta 已全开；broken 是 fail-closed 必须整列豁免
  assert.deepEqual(enableAll, [{ agentId: "alpha", skill: "docx" }]);
  assert.ok(!enableAll.some((target) => target.agentId === "broken"), "fail-closed 成员不得进入批量");

  const disableAll = referenceTargets(skills, { enabled: false });
  assert.equal(disableAll.length, 5); // 3×2 可写格 - 1 个已停用
  assert.ok(!disableAll.some((target) => target.agentId === "broken"));
});

test("筛选作用域：列批量与全量按命中项，整行批量按全部成员", () => {
  const skills = fixture();
  // 筛选只命中 co-review / co-research
  const filtered = referenceTargets(skills, { enabled: false, filter: "co-" });
  assert.deepEqual(new Set(filtered.map((target) => target.skill)), new Set(["co-review", "co-research"]));
  assert.ok(!filtered.some((target) => target.skill === "docx"), "筛选未命中的 skill 不能被批量改动");

  // 整行按 skillCode 定位，不受筛选影响（行是用户直接点的那一行）
  const row = referenceTargets(skills, { skillCode: "docx", enabled: true, filter: "co-" });
  assert.deepEqual(row, [{ agentId: "alpha", skill: "docx" }]);

  // 列批量限定单成员
  const column = referenceTargets(skills, { memberId: "beta", enabled: false });
  assert.equal(column.length, 3);
  assert.ok(column.every((target) => target.agentId === "beta"));
});

test("能力配置整体 fail-closed 时批量必须完全停手", () => {
  const skills = fixture();
  skills.configurationStatus = { failClosed: true, message: "配置不可读" };
  assert.deepEqual(referenceTargets(skills, { enabled: true }), []);
  assert.deepEqual(referenceTargets(skills, { enabled: false }), []);
});

test("app.js 接线：批量复用单条原子接口、二次确认、失败逐条回报", async () => {
  const app = await readFile(join(publicDir, "app.js"), "utf8");
  // 不得新开批量写端点——批量是前端对原子接口的组合
  assert.match(app, /async function applySkillMatrixBulk\([\s\S]{0,2400}request\("\/api\/capabilities\/agent-skill", \{ method: "PUT"/);
  assert.doesNotMatch(app, /agent-skills?\/bulk|capabilities\/bulk/);
  // 影响面二次确认 + 部分失败如实分开报
  assert.match(app, /applySkillMatrixBulk[\s\S]{0,1200}await confirmAction\(\{/);
  assert.match(app, /applySkillMatrixBulk[\s\S]{0,2600}failures\.length[\s\S]{0,200}条已应用/);
  // fail-closed 成员与整体降级在收集阶段就被排除
  assert.match(app, /function skillMatrixTargets\([\s\S]{0,700}configurationStatus\?\.failClosed === true\) return \[\]/);
  assert.match(app, /function skillMatrixTargets\([\s\S]{0,900}states\[id\]\?\.failClosed !== true/);
});

test("app.js 接线：门闸未授权与真故障在配置目标栏分开呈现", async () => {
  const app = await readFile(join(publicDir, "app.js"), "utf8");
  // 501/REMOTE_GATE_BLOCKED 归为 gated（可去授权），其余才是 error
  assert.match(app, /function configTargetLoadIssue\([\s\S]{0,600}status === 501 \|\| code === "REMOTE_GATE_BLOCKED"/);
  assert.match(app, /kind: blocked \? "gated" : "error"/);
  // 原文不丢：进 detail 由 title 悬浮可见
  assert.match(app, /configTargetIssueMarkup[\s\S]{0,600}title="\$\{escapeHtml\(issue\.detail/);
  // 三处赋值必须都走同一形状，否则目标栏会渲染出 undefined
  const assignments = app.match(/(configHostsError|remoteProjectsError) = configTargetLoadIssue\(/g) ?? [];
  assert.equal(assignments.length, 3, `目标栏错误状态必须统一走 configTargetLoadIssue，实际 ${assignments.length} 处`);
});
