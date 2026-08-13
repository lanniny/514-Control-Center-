import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const publicRoot = resolve(import.meta.dirname, "../public");

test("composer target tabs are the only visible direct-recipient control", async () => {
  const [html, app, state, css] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "state.js"), "utf8"),
    readFile(resolve(publicRoot, "forge/workbench.css"), "utf8"),
  ]);

  const form = html.slice(html.indexOf('id="task-form"'), html.indexOf("</form>", html.indexOf('id="task-form"')));
  assert.match(form, /id="member-strip"[^>]+role="radiogroup"[^>]+aria-label="直接发送目标"/);
  assert.match(form, /id="composer-collaborators"[^>]+aria-label="额外协作者"[^>]+hidden/);
  assert.match(form, /id="composer-target-summary"[^>]+aria-live="polite"/);
  assert.match(form, /id="start-agent" hidden aria-hidden="true" tabindex="-1"/);
  assert.match(form, /id="followup-agent" hidden aria-hidden="true" tabindex="-1"/);
  assert.doesNotMatch(html, /id="start-agent-pick"|id="followup-agent-pick"/);
  assert.match(state, /composerTargetAgentId:\s*null/);
  assert.match(app, /function activeComposerTarget\(\)/);
  assert.match(app, /function defaultRunRecipient\(run\)/);
  assert.match(app, /function runRecipient\(run, requestedAgentId = null\)/);
  assert.match(app, /data-composer-target=/);
  assert.match(app, /role="radio"/);
  assert.match(app, /aria-checked=/);
  assert.match(app, /function renderRequestedAgentChips/);
  assert.match(app, /function keepActiveComposerTargetVisible/);
  assert.match(app, /strip\.scrollLeft \+=/);
  assert.match(app, /startAgentId:\s*composerTarget\.memberId/);
  assert.match(app, /agentId:\s*composerTarget\.memberId/);
  assert.match(app, /function captureComposerConfig/);
  assert.match(app, /requestedAgentIds:\s*submission\.requestedAgentIds\.length/);
  assert.doesNotMatch(app, /startAgentId:\s*elements\["start-agent"\]/);
  assert.doesNotMatch(app, /agentId:\s*elements\["followup-agent"\]/);
  assert.doesNotMatch(app, /data-composer-target=""/);
  assert.doesNotMatch(app, /data-pick-dismiss|团队协作 · 由/);
  assert.doesNotMatch(app, /openTab\([^\n]*,\s*null\)/);
  assert.match(app, /if \(focusAnswer\) selectComposerTarget\(focusAnswer\.dataset\.focusAnswer/);
  assert.match(css, /\.composer-target-tabs\s*\{/);
  assert.match(css, /data-target-agent="kimi-frontend"/);
});

test("mentions stay structured without changing the direct target", async () => {
  const app = await readFile(resolve(publicRoot, "app.js"), "utf8");
  const start = app.indexOf("function applyMention(agentId)");
  const end = app.indexOf("\nconst FORMAT_BADGES", start);
  const body = app.slice(start, end);
  assert.match(body, /state\.requestedAgentIds = addRequestedAgentId/);
  assert.doesNotMatch(body, /selectComposerTarget|start-agent|followup-agent/);
});

test("unsupported controls hide and continuing sessions expose an honest locked-state label", async () => {
  const [html, app] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
  ]);
  const visibility = app.slice(app.indexOf("function syncComposerControlVisibility"), app.indexOf("function staticControlContext"));
  assert.match(html, /id="composer-session-controls" hidden/);
  assert.match(visibility, /effortUnsupported/);
  assert.match(visibility, /task-effort-pick/);
  assert.match(visibility, /composer-session-controls/);
  assert.match(visibility, /hidden = !continuing/);
  assert.match(app, /沿用 \$\{memberName\} 会话配置/);
});

test("selected CLI exposes a real command, defaults and diagnostics console", async () => {
  const [html, app, api, css] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "api.js"), "utf8"),
    readFile(resolve(publicRoot, "forge/workbench.css"), "utf8"),
  ]);
  const form = html.slice(html.indexOf('id="task-form"'), html.indexOf("</form>", html.indexOf('id="task-form"')));

  assert.match(form, /id="composer-cli-console"/);
  assert.match(form, /data-composer-cli-tab="commands"/);
  assert.match(form, /data-composer-cli-tab="defaults"/);
  assert.match(form, /data-composer-cli-tab="connection"/);
  assert.match(form, /id="composer-cli-default-model"/);
  assert.match(form, /id="composer-cli-default-effort"/);
  assert.match(form, /id="composer-cli-default-permission"/);
  assert.match(form, /id="composer-cli-open-capabilities"/);
  assert.match(form, /id="composer-cli-diagnostic-actions"/);
  assert.doesNotMatch(form, /composer-cli-(?:shell|argv|command)-input/);

  assert.match(api, /agentActions:\s*"\/api\/agents\/actions"/);
  assert.match(app, /request\(API\.agentActions,\s*\{\s*method:\s*"POST"/s);
  assert.match(app, /composer-cli-default-permission[\s\S]*?\{ includeEmpty: false \}/);
  assert.match(app, /request\(`\$\{API\.runtimeSeats\}\/\$\{encodeURIComponent\(runtimeProfileId\)\}`/);
  const saveDefaults = app.slice(app.indexOf("async function saveComposerCliDefaults"), app.indexOf("async function openComposerCliSeat"));
  assert.ok(saveDefaults.indexOf("const patch =") < saveDefaults.indexOf("beginComposerCliOperation(context)"));
  assert.ok(saveDefaults.indexOf("beginComposerCliOperation(context)") < saveDefaults.indexOf("body: patch"));
  assert.match(app, /const disabled = cliBusy \|\| \(continuing && !hotReachable\);/);
  assert.match(app, /function composerControlKey\(memberId, runtimeProfileId = null\)/);
  assert.match(app, /composerControlDrafts\.set\(key/);
  assert.match(app, /composerCliActionStates\.set\(key/);
  assert.match(app, /nativePermissionToComposer/);
  assert.doesNotMatch(app, /state\.composerCliBusy/);
  assert.match(app, /Codex 沙箱轴随原生会话固化；模型、Effort、权限降档与 ask↔auto 可热调，下一轮生效。/);
  assert.match(app, /surface:\s*"capabilities"/);
  assert.match(app, /output\.dataset\.context = cliContextState\.key/);
  assert.match(css, /composer-cli-diagnostic-output\[data-status="failed"\]/);
});

test("a stale composer blur timer cannot close a newly reopened command menu", async () => {
  const app = await readFile(resolve(publicRoot, "app.js"), "utf8");
  const start = app.indexOf('taskInput.addEventListener("blur"');
  const end = app.indexOf("byId(\"slash-menu\")", start);
  const blurHandler = app.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(blurHandler, /document\.activeElement === taskInput/);
  assert.match(blurHandler, /document\.activeElement\?\.closest\?\.\("#mention-menu, #slash-menu"\)/);
  assert.match(blurHandler, /hideMentionMenu\(\);\s*hideSlashMenu\(\);/s);
});

// LO 2026-08-10：发送键随工作状态双态——活跃 run + 空输入 = 停止键（级联取消）；
// 有输入 = 发送键（轮间插话不被吃掉）；审批挂起时停止键保持可用。
test("the send button becomes a stop key while the run is active and the input is empty", async () => {
  const [app, css, html] = await Promise.all([
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "styles.css"), "utf8"),
    readFile(resolve(publicRoot, "index.html"), "utf8"),
  ]);
  // 双态计算：续聊 + 活跃（ACTIVE_RUN_STATES）+ 非预览 + 空输入 = stop
  assert.match(app, /function syncSubmitButtonMode\(\)/);
  assert.match(app, /const running = Boolean\(run\) && !state\.sessionPreview && ACTIVE_RUN_STATES\.has\(run\.status\);/);
  assert.match(app, /const stopMode = running && !hasInput;/);
  // 停止态实心方块（官方同款语义）；发送态还原 lucide 箭头
  assert.match(app, /<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" \/>/);
  assert.match(app, /: '<svg class="icon lucide"><use href="#lucide-arrow-up"><\/use><\/svg>';/);
  // 状态翻页链路：loadRuns 是 run.completed/failed 等纯状态事件的唯一通道，必须连会话视图一起刷
  assert.match(app, /renderOverview\(\);\s*\n\s*\/\/ 状态翻页必须连会话视图一起刷[\s\S]*?renderSelectedRun\(\);/);
  // 停止路径：submit 入口拦截走级联取消（既有确认弹窗），不进发送路径
  assert.match(app, /if \(elements\["submit-task-button"\]\?\.dataset\.mode === "stop"\) \{\s*\n\s*void cancelSelectedRun\(\);/);
  // 审批挂起：输入禁用，但停止键必须可用——它是此时唯一有意义的动作
  assert.match(app, /elements\["submit-task-button"\]\.disabled = waitingApproval && elements\["submit-task-button"\]\.dataset\.mode !== "stop";/);
  // 联动：composer 重算（setComposerMode）与输入事件都刷新双态
  assert.match(app, /syncSubmitButtonMode\(\); \/\/ 发送\/停止双态/);
  assert.match(app, /syncSubmitButtonMode\(\); \/\/ 输入有无决定发送\/停止双态/);
  // 停止模式跳过原生 required 校验（空输入正是停止场景），否则浏览器先弹「请填写此字段」
  assert.match(app, /button\.toggleAttribute\("formnovalidate", stopMode\);/);
  // 图标引用方式与既有取消按钮同款 + 停止态样式
  assert.match(html, /#lucide-circle-stop/);
  assert.ok(css.includes(".send-button.is-stop {"), "缺少停止态样式");
});
