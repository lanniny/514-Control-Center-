import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function source(path) {
  // Windows 工作区源码是 CRLF：统一归一化为 LF，避免多行匹配踩空（同 codex-process-visibility）
  return (await readFile(`${root}/${path}`, "utf8")).replace(/\r\n/g, "\n");
}

// 源文件 500KB+，正则断言失败会把整份文件打进输出——一律用 includes 断言字面片段
function assertIncludes(source, snippet, message) {
  assert.ok(source.includes(snippet), message ?? `缺少：${snippet}`);
}

// LO 2026-08-16 实拍：control/runBuild/requestApproval 的审批卡把 runId / promptSha256 /
// member-uuid / policySha256 等 20+ 行技术字段平铺成一堵墙。正面必须是人话摘要
// （工作区/隔离/协作规模/执行成员），全量字段收进「技术详情」折叠保持审计可见。
test("runBuild approval renders a human summary with technical details folded away", async () => {
  const app = await source("public/app.js");
  assertIncludes(app, "function approvalRunBuildMarkup(params) {");
  // runBuild 分支在通用 key/value 兜底之前
  const branch = app.indexOf('if (method.includes("runBuild")) {');
  assert.ok(branch > 0, "approvalParamsMarkup 缺少 runBuild 分支");
  const fallback = app.indexOf('if (method.includes("commandExecution") || method === "execCommandApproval") {');
  assert.ok(branch < fallback, "runBuild 分支必须排在 commandExecution/fallback 之前");
  // 人话摘要四要素 + 工作区 basename 全路径入 title
  assertIncludes(app, '["工作区", workspaceName, workspace]');
  assertIncludes(app, '["隔离", String(params.isolation) === "git-worktree" ? "git 工作树"');
  assertIncludes(app, '["协作", collaboration]');
  assertIncludes(app, '["执行成员", approvalMemberShort(owner)]');
  // 成员运行实例 id 只露短码
  assertIncludes(app, "function approvalMemberShort(id) {");
  // 全量字段折叠进技术详情，条数可见
  assertIncludes(app, '<details class="approval-tech"><summary>技术详情 · ${entries.length} 字段</summary>');
});

test("runBuild approval summary styles live in console-form.css", async () => {
  const css = await source("public/forge/console-form.css");
  assertIncludes(css, ".approval-facts {");
  assertIncludes(css, ".approval-fact > code {");
  assertIncludes(css, ".approval-tech > summary {");
});

// 同批实拍：meta pill 横贯顶栏——「独立页 · 只看 X」与 tab 条重复，wt 段与会话头分支 chip
// 重复（chip 数据缺失时 title 悬停仍给出 worktree 全路径）。两段都不进 metaParts。
// 第六轮（2026-08-17）再收敛：可见 pill 只留步骤预算，run id/创建时间/总轮次收 tooltip。
test("conversation meta drops the member-focus and worktree segments", async () => {
  const app = await source("public/app.js");
  const start = app.indexOf("const metaParts = [maxSteps > 0");
  const end = app.indexOf('metaParts.join(" · ")', start);
  assert.ok(start > 0 && end > start, "定位不到 metaParts 构造段");
  const meta = app.slice(start, end);
  assert.ok(!meta.includes("metaParts.push(`独立页"), "meta 仍推入成员聚焦段");
  assert.ok(!meta.includes("wt ${"), "meta 仍推入 wt 段");
  // 审计序号与步骤预算仍在（codex-process-visibility 同口径）：步骤在可见 pill，总轮次在 tooltip
  assertIncludes(meta, "`本次步骤 ${interactionStep}/${maxSteps}`");
  assertIncludes(meta, "`总轮次 ${totalRounds}`");
});
