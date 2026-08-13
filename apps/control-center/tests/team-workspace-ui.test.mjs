import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { normalizeRunSessions } from "../public/team-panel.js";
import { unwrapList } from "../public/utils.js";
import { memberRuntimeFactValues, normalizeMemberModelOptions } from "../public/modules/member-library.js";

const publicRoot = resolve(import.meta.dirname, "../public");

test("member model options preserve ids and labels without stringifying catalog objects", () => {
  assert.deepEqual(normalizeMemberModelOptions([
    { id: "", label: "CLI 默认" },
    { id: "kimi-code/k3", label: "K3" },
    "kimi-code/k3-256k",
    { id: "kimi-code/k3", label: "重复项" },
  ], "kimi-code/kimi-for-coding"), [
    { id: "kimi-code/k3", label: "K3" },
    { id: "kimi-code/k3-256k", label: "kimi-code/k3-256k" },
    { id: "kimi-code/kimi-for-coding", label: "kimi-code/kimi-for-coding" },
  ]);
});

test("member runtime facts follow the newly selected runtime profile instead of stale member projection", () => {
  assert.deepEqual(memberRuntimeFactValues({
    id: "codex-technical",
    provider: "openai",
    adapterLabel: "Codex",
    providerBindingMode: "serialized-live-projection",
  }, {
    id: "kimi-frontend",
    provider: "moonshot",
    adapterLabel: "Kimi Code",
    providerBindingMode: "cli-managed",
  }), {
    provider: "moonshot",
    adapter: "Kimi Code",
    connectionScope: "cli-managed",
  });
});

test("team route owns activation, settings and runtime surfaces without a separate dialog", async () => {
  const index = await readFile(resolve(publicRoot, "index.html"), "utf8");
  const teamStart = index.indexOf('id="view-team"');
  const configStart = index.indexOf('id="view-config"');
  assert.ok(teamStart > 0 && configStart > teamStart, "team and config routes must exist in order");

  const teamView = index.slice(teamStart, configStart);
  for (const id of [
    "team-settings-panel",
    "team-switch-select",
    "team-active-status",
    "team-activate-button",
    "team-apply-providers-button",
    "team-form",
    "team-roster-summary",
    "team-hero-root",
    "team-roster-root",
    "team-flow-root",
  ]) {
    assert.match(teamView, new RegExp(`id="${id}"`), `${id} must live inside #view-team`);
  }
  assert.doesNotMatch(index, /<dialog[^>]+id="team-dialog"/, "team settings must not regress to a detached modal");
  assert.doesNotMatch(index, /默认 Claude|claude-fable 席位不可移除/);
  assert.doesNotMatch(index, /src="\.\/collab-flow\.js"/, "app.js must own team runtime refresh instead of a second auto-boot script");
});

test("team workspace contains a first-class editable member registry wired back into team composition", async () => {
  const [index, app, api, memberLibrary, runtimeSeatManager, teamCss] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "api.js"), "utf8"),
    readFile(resolve(publicRoot, "modules/member-library.js"), "utf8"),
    readFile(resolve(publicRoot, "modules/runtime-seat-manager.js"), "utf8"),
    readFile(resolve(publicRoot, "forge/team.css"), "utf8"),
  ]);
  const teamStart = index.indexOf('id="view-team"');
  const configStart = index.indexOf('id="view-config"');
  const teamView = index.slice(teamStart, configStart);

  for (const id of [
    "team-surface-tabs",
    "team-surface-orchestration",
    "team-surface-members",
    "member-library-list",
    "member-new-button",
    "member-form",
    "member-runtime-profile-select",
    "member-seat-picker",
    "member-seat-picker-trigger",
    "member-seat-picker-panel",
    "member-seat-picker-search-input",
    "member-seat-picker-options",
    "member-default-model-input",
    "member-default-effort-select",
    "member-description-input",
    "member-capabilities-wall",
    "member-system-prompt-input",
    "member-main-brain-input",
    "member-main-brain-reason",
    "member-team-toggle-button",
    "member-open-config-button",
    "member-new-runtime-button",
    "member-open-capabilities-button",
  ]) {
    assert.match(teamView, new RegExp(`id="${id}"`), `${id} must remain inside the unified team workspace`);
  }

  assert.match(api, /teamMembers:\s*"\/api\/team-members"/);
  assert.match(api, /adapterTemplates:\s*"\/api\/adapter-templates"/);
  assert.match(api, /runtimeSeats:\s*"\/api\/runtime-seats"/);
  assert.match(app, /createMemberLibrary\(\{/);
  assert.match(app, /createRuntimeSeatManager\(\{/);
  assert.match(app, /data-edit-team-member/);
  assert.match(app, /onMemberSaved:[\s\S]{0,520}memberLibrary\?\.updateTeamToggle\(\)/);
  assert.match(app, /memberLibrary\?\.open\(edit\.dataset\.editTeamMember\)/);
  // 脏状态判断已从单行组合表达式收口为 hasUnsavedConfigChanges()（并多覆盖远程真源草稿与运行席位）。
  // 断语义而非断字面：收口必须覆盖各脏源，且离开页面的守护必须实际调用它。
  assert.match(app, /function hasUnsavedConfigChanges\(\)[\s\S]{0,400}configIsDirty\(\)[\s\S]{0,240}teamFormDirty[\s\S]{0,240}memberLibrary\?\.isDirty\(\)/);
  assert.match(app, /beforeunload[\s\S]{0,280}hasUnsavedConfigChanges\(\)/);
  assert.match(memberLibrary, /method: source\?\.id \? "PUT" : "POST"/);
  assert.match(memberLibrary, /method: "DELETE"/);
  assert.match(memberLibrary, /onToggleTeamMember\?\.\(source\.id/);
  assert.match(memberLibrary, /surface: "runtime"[\s\S]{0,160}runtimeProfileId: draft\?\.runtimeProfileId/);
  assert.match(memberLibrary, /surface: "capabilities"[\s\S]{0,120}memberId: source\?\.id/);
  assert.match(memberLibrary, /if \(!runtimeCatalog\(\)\.some[\s\S]{0,180}await refreshCatalog\(\)/);
  assert.match(memberLibrary, /renderEditor\(blankMember\(\), \{ isNew: true \}\)/);
  assert.match(memberLibrary, /byId\("member-description-input"\)\.value = member\.description \|\| ""/);
  assert.match(memberLibrary, /byId\("member-system-prompt-input"\)\.value = member\.systemPrompt \|\| ""/);
  assert.match(memberLibrary, /mainBrainAllowed && profile\.coordinatorEligible === true/);
  assert.match(memberLibrary, /member\.coordinatorEligibilityReason/);
  assert.match(memberLibrary, /"label", "shortLabel", "role", "description", "systemPrompt", "capabilities"/);
  assert.match(memberLibrary, /member-new-runtime-button[\s\S]{0,220}create: true/);
  assert.match(app, /async function openMemberConfigTarget/);
  assert.match(app, /runtimeSeatManager\.setMode\("seats", \{ focus: false \}\)/);
  assert.match(app, /if \(create\) await runtimeSeatManager\.create\(\)/);
  assert.match(app, /await runtimeSeatManager\.load\(\)[\s\S]{0,100}runtimeSeatManager\.focus\(runtimeProfileId\)/);
  assert.match(app, /invalidateCapabilitiesCatalog\(\)[\s\S]{0,180}reconcileTeamFormCatalog/);
  assert.match(app, /loadCapabilities\(\{ fresh: true \}\)/);
  assert.match(app, /configRouteHash\(state\.configSurface/);
  assert.match(app, /scope="col" tabindex="-1"[\s\S]{0,180}data-member-column/);
  assert.doesNotMatch(app, /selectSource\("control\.models"\)/, "member runtime deep links must use the structured seat editor");
  // 同上：运行席位的脏状态也归入 hasUnsavedConfigChanges() 收口，不再是独立的取反表达式
  assert.match(app, /function hasUnsavedConfigChanges\(\)[\s\S]{0,480}runtimeSeatManager\?\.isDirty\(\)/);
  assert.match(app, /data-member-column="\$\{escapeHtml\(id\)\}"/);
  assert.match(runtimeSeatManager, /let loadPromise = null/);
  assert.match(runtimeSeatManager, /const result = await loadPromise/);
  assert.match(runtimeSeatManager, /draft\.providerId = null/);
  // 运行席位自定义选择器：原生 select 仍是真源，选择回写后派发 change 走既有换绑链
  assert.match(memberLibrary, /select\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
  assert.match(memberLibrary, /function renderSeatPickerOptions\(\)/);
  assert.match(memberLibrary, /function applySeatPickerFilter\(\)/);
  assert.match(memberLibrary, /event\.stopPropagation\(\); \/\/ 搜索输入不算表单修改/);
  assert.match(teamCss, /\.member-seat-picker-trigger\s*\{/);
  assert.match(teamCss, /\.member-seat-picker-panel\s*\{/);
  assert.match(teamCss, /\.member-seat-picker-option\s*\{/);
  assert.match(teamCss, /\.member-library\s*\{/);
  assert.match(teamCss, /@media \(max-width: 680px\)/);
  assert.match(teamCss, /\.team-settings-form \.team-members-list,\s*\.tm-group-body,\s*\.team-runtime-overview \.cf-hero,[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(teamCss, /@media \(min-width: 681px\) and \(max-width: 1120px\)\s*\{\s*\.tm-group-body\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});

test("team entry points and refresh path converge on the unified workspace", async () => {
  const app = await readFile(resolve(publicRoot, "app.js"), "utf8");
  assert.match(app, /function openTeamWorkspace\(/);
  assert.match(app, /manage-teams-button[^\n]+openTeamWorkspace/);
  assert.match(app, /state\.view === "team"[\s\S]{0,260}jobs\.push\(loadTeams\(\)\.then\(async \(teamsResult\)[\s\S]{0,180}const flowResult = await refreshCollabFlow\(\)[\s\S]{0,140}loadResultFailed\(teamsResult\) \? teamsResult : flowResult/);
  assert.match(app, /function applyTeamProviders\(teamId =/);
  assert.doesNotMatch(app, /openTeamDialog|closeTeamDialog|team-dialog/);
});

test("team writes force a fresh read without implicitly activating newly saved teams", async () => {
  const app = await readFile(resolve(publicRoot, "app.js"), "utf8");
  const saveStart = app.indexOf("async function saveTeamForm");
  const deleteStart = app.indexOf("async function deleteEditingTeam");
  const providerStart = app.indexOf("// ── 供应商方案", deleteStart);
  const saveBody = app.slice(saveStart, deleteStart);
  const deleteBody = app.slice(deleteStart, providerStart);

  assert.match(saveBody, /loadTeams\(\{ fresh: true \}\)/);
  assert.match(deleteBody, /loadTeams\(\{ fresh: true \}\)/);
  assert.doesNotMatch(saveBody, /selectTeam\(created\.id\)/, "save/copy must remain browse-only until explicit activation");
  assert.match(app, /epoch !== teamsLoadEpoch[\s\S]{0,100}stale: true/);
  assert.match(app, /while \(teamsFreshRequested\)[\s\S]{0,120}startTeamsLoad\(\)/);
  assert.match(app, /loadTeams\(\)\.then\(\(result\) => \{[\s\S]{0,220}shouldHydrateTeamFormAfterLoad\(result/);
});

test("team draft state guards switching, activation and provider application", async () => {
  const app = await readFile(resolve(publicRoot, "app.js"), "utf8");
  assert.match(app, /function markTeamFormDirty\(\)/);
  assert.match(app, /async function confirmDiscardTeamDraft\(\)/);
  assert.match(app, /team-switch-select[^\n]+addEventListener\("change", async[\s\S]{0,180}confirmDiscardTeamDraft\(\)/);
  assert.match(app, /applyButton\.disabled = !editing \|\| bindingCount === 0 \|\| teamFormDirty/);
  assert.match(app, /const bindings = teamFormDirty \? collectTeamProviderBindings\(\) : \(editing\?\.providers \?\? \{\}\)/);
  assert.match(app, /aria-label="将 \$\{escapeHtml\(name\)\} 设为团队主脑"/);
  assert.match(app, /state\.bootstrap\?\.teamCatalog/);
  assert.match(app, /coordinatorEligible: profile\.coordinatorEligible === true/);
  assert.match(app, /teamMemberEligible: profile\.teamMemberEligible === true/);
  assert.doesNotMatch(app, /const COORDINATOR_ELIGIBLE|Boolean\(String\(profile\.command/);
  assert.doesNotMatch(app, /mandatory = id === "claude-fable"|members\.unshift\("claude-fable"\)/);
  assert.match(app, /toast\("至少选择一名团队成员"/);
  assert.match(app, /toast\("请从已选成员中指定团队主脑"/);
  assert.match(app, /if \(coordinator && !members\.includes\(coordinator\)\) members\.push\(coordinator\)/);
  assert.match(app, /reconcileTeamFormCatalog\(previousTeamCatalog\)/);
  assert.match(app, /团队成员目录已更新；当前未保存草稿已保留/);
  assert.match(app, /await loadBootstrap\(\);[\s\S]{0,80}await loadTeams\(\{ fresh: true \}\)/);
  // 切换 / 激活 / 应用供应商三处各自的脏状态守护（重构后不再是一行组合判断，
  // 但三道闸必须都在——这条断言盯的是守护点存在，不是某行文本长什么样）。
  assert.match(app, /team-switch-select"\]\?\.addEventListener\("change"[\s\S]{0,240}await confirmDiscardTeamDraft\(\)/);
  assert.match(app, /function activateEditingTeam\(\)[\s\S]{0,200}teamFormDirty[\s\S]{0,160}先保存团队修改，再设为当前团队/);
  assert.match(app, /async function applyTeamProviders\([\s\S]{0,220}teamFormDirty[\s\S]{0,200}先保存团队修改，再应用供应商方案/);
});

test("team UI derives coordinator identity instead of branding Claude as the permanent brain", async () => {
  const [app, panel, roles, palette, state] = await Promise.all([
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "team-panel.js"), "utf8"),
    readFile(resolve(publicRoot, "modules/agent-roles.js"), "utf8"),
    readFile(resolve(publicRoot, "command-palette.js"), "utf8"),
    readFile(resolve(publicRoot, "state.js"), "utf8"),
  ]);
  for (const source of [app, panel, roles, palette, state]) assert.doesNotMatch(source, /Claude 主脑/);
  assert.match(panel, /"claude-fable": \{ name: "Claude Fable", title: "规划编排席"/);
  assert.match(panel, /agentId === coordinatorId[\s\S]{0,80}"orchestrator"/);
  assert.match(app, /const coordinatorName = coordinatorId \? agentLabel\(coordinatorId\) : "团队主脑"/);
  assert.doesNotMatch(app, /run\.coordinatorId \|\| "claude-fable"|members\[0\] \?\? "claude-fable"/);
  assert.doesNotMatch(app, /builtin\?\.members \?\? \["claude-fable"\]/);
  assert.match(app, /team-catalog-loading/);
  assert.match(app, /catalog\.find\(\(profile\) => profile\.id === id\)\?\.label/);
  assert.match(app, /const brand = resolveCatalogBrand\(provider,/);
  assert.doesNotMatch(app, /const cli = agentCli\(id\) \|\| meta\.provider/);
});

test("legacy snake-case run identity normalizes both coordinator and start agent", async () => {
  const app = await readFile(resolve(publicRoot, "app.js"), "utf8");
  const blockStart = app.indexOf("function normalizeRun(item, index)");
  const blockEnd = app.indexOf("\nfunction normalizeComponent", blockStart);
  assert.ok(blockStart >= 0 && blockEnd > blockStart, "normalizeRun block is missing");

  const context = { normalizeRunSessions, unwrapList };
  runInNewContext(`${app.slice(blockStart, blockEnd)}\nglobalThis.__normalizeRun = normalizeRun;`, context);
  const run = context.__normalizeRun({
    run_id: "legacy-run",
    coordinator_id: "codex-technical",
    start_agent_id: "kimi-frontend",
    sessions: {},
  }, 0);
  assert.equal(run.coordinatorId, "codex-technical");
  assert.equal(run.startAgentId, "kimi-frontend");
});
