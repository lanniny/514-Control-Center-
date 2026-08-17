import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ProviderStore, PROVIDER_SCHEME_APPS } from "../src/providers.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const [appSource, html, css, stateSource, panelSource, routesSource, providerSource] = await Promise.all([
  readFile(`${appRoot}/public/app.js`, "utf8"),
  readFile(`${appRoot}/public/index.html`, "utf8"),
  readFile(`${appRoot}/public/styles.css`, "utf8"),
  readFile(`${appRoot}/public/state.js`, "utf8"),
  readFile(`${appRoot}/public/modules/ccswitch-panel.js`, "utf8"),
  readFile(`${appRoot}/src/ccswitch/routes.mjs`, "utf8"),
  readFile(`${appRoot}/src/providers.mjs`, "utf8"),
]);

function sourceSection(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return appSource.slice(start, end);
}

test("new provider targets only the selected provider-deck application", () => {
  const PROVIDER_APPS = ["claude", "codex", "gemini"];
  const PROVIDER_STORAGE_APPS = [...PROVIDER_APPS, "claude-desktop"];
  const factory = new Function(
    "PROVIDER_APPS",
    "PROVIDER_STORAGE_APPS",
    "providerActiveApp",
    `${sourceSection("function providerDialogSelection", "function fillProviderDialog")}\nreturn providerDialogSelection;`,
  );
  const select = factory(PROVIDER_APPS, PROVIDER_STORAGE_APPS, () => "gemini");

  assert.deepEqual(select(null, "codex"), {
    targetApp: "codex",
    apps: { claude: false, codex: true, gemini: false, "claude-desktop": false },
  });
  assert.deepEqual(select(null), {
    targetApp: "gemini",
    apps: { claude: false, codex: false, gemini: true, "claude-desktop": false },
  });
});

test("editing keeps existing application links and selects a valid preview target", () => {
  const PROVIDER_APPS = ["claude", "codex", "gemini"];
  const PROVIDER_STORAGE_APPS = [...PROVIDER_APPS, "claude-desktop"];
  const factory = new Function(
    "PROVIDER_APPS",
    "PROVIDER_STORAGE_APPS",
    "providerActiveApp",
    `${sourceSection("function providerDialogSelection", "function fillProviderDialog")}\nreturn providerDialogSelection;`,
  );
  const select = factory(PROVIDER_APPS, PROVIDER_STORAGE_APPS, () => "gemini");
  const provider = { apps: { claude: true, codex: true, gemini: false, "claude-desktop": true } };

  assert.deepEqual(select(provider), {
    targetApp: "claude",
    apps: { claude: true, codex: true, gemini: false, "claude-desktop": true },
  });
  assert.deepEqual(select(provider, "codex"), {
    targetApp: "codex",
    apps: { claude: true, codex: true, gemini: false, "claude-desktop": true },
  });
});

test("provider dialog has no duplicate application selector and all flows use the target state", () => {
  assert.doesNotMatch(html, /provider-apps-field|provider-app-(?:claude|codex|gemini)/);
  assert.doesNotMatch(html, /启用应用（至少一项/);
  assert.doesNotMatch(css, /\.provider-apps-field|\.provider-app-check/);
  assert.match(stateSource, /providerDialogTargetApp:\s*"claude"/);
  assert.match(stateSource, /providerDialogApps:\s*\{\}/);
  assert.match(appSource, /provider-add-button"\]\?\.addEventListener\("click", \(\) => openProviderDialog\(null, \{ app: providerActiveApp\(\) \}\)\)/);
  assert.match(appSource, /const apps = Object\.fromEntries\(PROVIDER_STORAGE_APPS\.map\(\(app\) => \[app, Boolean\(state\.providerDialogApps\?\.\[app\]\)\]\)\)/);
  assert.match(appSource, /const app = state\.providerDialogTargetApp;/);
  assert.doesNotMatch(appSource, /elements\[`provider-app-\$\{app\}`\]/);
});

test("Claude Desktop is absent from provider-scheme UI but retained as a storage compatibility key", () => {
  const providerMeta = sourceSection("const PROVIDER_APP_META", "const MCP_TARGET_META");
  const mcpTargetMeta = sourceSection("const MCP_TARGET_META", "function providerBelongsToScheme");
  assert.doesNotMatch(providerMeta, /label:\s*"Claude Desktop"/);
  assert.match(providerMeta, /PROVIDER_STORAGE_APPS[^\n]+"claude-desktop"/);
  assert.match(mcpTargetMeta, /app:\s*"claude-desktop",\s*label:\s*"Claude Desktop"/);
  assert.doesNotMatch(html, /team-provider-claude-desktop|provider-models-claude-desktop|provider-claude-desktop-model/);
  assert.doesNotMatch(html, />Claude Desktop</);
  assert.doesNotMatch(appSource, /"team-provider-claude-desktop"|"provider-models-claude-desktop"|"provider-claude-desktop-model"/);
  assert.match(appSource, /const existing = teamById\(state\.editingTeamId\)\?\.providers \?\? \{\}/);
  assert.match(appSource, /const value = select \? select\.value : existing\[app\] \?\? ""/);
  assert.match(appSource, /body: \{ teamId, apps: bindings\.map\(\(\[app\]\) => app\) \}/);
  assert.match(panelSource, /domain\/sync-live[^\n]+body: \{ apps: PROVIDER_SCHEME_APPS \}/);
  assert.match(panelSource, /backups\/\$\{encodeURIComponent\(button\.dataset\.ccsBackupRestore\)\}\/restore[^\n]+apps: PROVIDER_SCHEME_APPS/);
  assert.match(panelSource, /sync\/\$\{kind\}\/\$\{verb\}[^\n]+syncLive: true, apps: PROVIDER_SCHEME_APPS/);
  assert.match(routesSource, /domain\.syncAllLive\(input\)/);
});

test("Codex provider dialog keeps only custom, OpenAI Official, Azure OpenAI and Micu", () => {
  const section = sourceSection("function codexPresetAllowed", "/** 网格过滤");
  assert.match(section, /name === "OpenAI Official"/);
  assert.match(section, /name === "Azure OpenAI"/);
  assert.match(section, /name\.toLowerCase\(\) === "micu"/);
  assert.doesNotMatch(section, /category === "official"|isOfficial === true|cn_official/);
  assert.match(appSource, /syntheticCustom: true/);

  const rank = new Function(`${section}\nreturn codexPresetRank;`)();
  assert.deepEqual([
    { name: "Micu" },
    { name: "Azure OpenAI", isOfficial: true },
    { name: "OpenAI Official" },
    { name: "自定义配置", syntheticCustom: true },
  ].sort((a, b) => rank(a) - rank(b)).map((preset) => preset.name), [
    "自定义配置",
    "OpenAI Official",
    "Azure OpenAI",
    "Micu",
  ]);
});

test("Codex advanced options stay in the basic panel as a details disclosure", () => {
  assert.match(html, /<div id="provider-codex-advanced-slot"><\/div>/);
  assert.match(html, /<details class="provider-advanced-section" id="provider-advanced-details"/);
  assert.match(appSource, /compactSlot\.append\(advancedDetails\)/);
  assert.match(appSource, /elements\["provider-tabs"\]\.hidden = compactMode/);
  assert.match(css, /\.provider-dialog\.is-codex/);
});

test("Grok Build dialog keeps only custom, Grok Official and Micu, with compact advanced options", () => {
  const section = sourceSection("function grokbuildPresetAllowed", "function compactPresetRank");
  assert.match(section, /name === "Grok Official"/);
  assert.match(section, /name\.toLowerCase\(\) === "micu"/);
  assert.doesNotMatch(section, /PackyCode|ZetaAPI/);
  assert.match(html, /id="provider-grokbuild-profile"/);
  assert.match(html, /id="provider-grokbuild-backend"/);
  assert.match(html, /id="provider-grokbuild-context"/);
  assert.match(appSource, /classList\.toggle\("is-grokbuild", grokMode\)/);
  assert.match(css, /\.provider-grok-field-grid/);

  const rankSection = sourceSection("function compactPresetRank", "/** 网格过滤");
  const rank = new Function(`${rankSection}\nreturn grokbuildPresetRank;`)();
  assert.deepEqual([
    { name: "Micu" },
    { name: "Grok Official" },
    { name: "自定义配置", syntheticCustom: true },
  ].sort((a, b) => rank(a) - rank(b)).map((preset) => preset.name), [
    "自定义配置",
    "Grok Official",
    "Micu",
  ]);
});

test("OpenAI Official is a fixed virtual row and cannot be saved as a duplicate", () => {
  const row = sourceSection("function officialLiveRowMarkup", "/** 单个供应商行");
  assert.match(row, /OpenAI Official/);
  assert.match(row, /provider-row-actions" aria-label="内置供应商，无可用操作"><\/div>/);
  assert.doesNotMatch(row, /data-provider-edit|data-provider-delete|data-provider-duplicate/);
  assert.match(appSource, /provider-save-button"\]\.disabled = immutableOfficial/);
  assert.match(appSource, /card\.dataset\.presetKey === "codex:OpenAI Official" \|\| card\.dataset\.presetKey === "grokbuild:Grok Official"\) return/);
});

test("Grok Official is a fixed virtual row with enable action and cannot be saved as a duplicate", () => {
  const row = sourceSection("function officialLiveRowMarkup", "/** 单个供应商行");
  assert.match(row, /Grok Official/);
  assert.match(row, /data-provider-switch="grokbuild::__official__"/);
  assert.match(row, /https:\/\/x\.ai\/grok/);
  assert.doesNotMatch(row, /data-provider-edit|data-provider-delete|data-provider-duplicate/);
  assert.match(appSource, /preset\.name === "Grok Official"/);
  assert.match(appSource, /data-provider-duplicate=/);
  assert.match(appSource, /data-provider-usage-config=/);
  assert.match(appSource, /#lucide-pencil/);
});

test("provider ids cannot collide with the frontend :: action protocol", () => {
  const patternLiteral = providerSource.match(/const PROVIDER_ID_PATTERN = (\/[^\n]+\/);/)?.[1];
  assert.ok(patternLiteral, "missing backend provider ID contract");
  const pattern = new Function(`return ${patternLiteral};`)();

  assert.equal(pattern.test("provider-target:shadow"), true, "a single colon remains a valid provider ID character");
  assert.equal(pattern.test("provider-target::shadow"), false, "the frontend action delimiter must be reserved");
  assert.equal(pattern.test("provider-target:"), false, "a trailing colon would collide with the move action suffix");
  assert.match(appSource, /data-provider-switch="\$\{escapeHtml\(app\)\}::\$\{escapeHtml\(item\.id\)\}/);
  assert.match(appSource, /dataset\.providerSwitch\)\.split\("::"\)/);

  const [app, providerId, direction] = "codex::provider-target:shadow::-1".split("::");
  assert.deepEqual({ app, providerId, direction: Number(direction) }, {
    app: "codex",
    providerId: "provider-target:shadow",
    direction: -1,
  });
});

test("team form preserves a hidden legacy Claude Desktop binding", () => {
  const PROVIDER_STORAGE_APPS = ["claude", "codex", "claude-desktop"];
  const elements = {
    "team-provider-claude": { value: "claude-new" },
    "team-provider-codex": { value: "" },
  };
  const state = { editingTeamId: "team-legacy" };
  const teamById = () => ({ providers: { claude: "claude-old", "claude-desktop": "desktop-old" } });
  const factory = new Function(
    "PROVIDER_STORAGE_APPS",
    "elements",
    "state",
    "teamById",
    `${sourceSection("function collectTeamProviderBindings", "function populateTeamProviderSelects")}\nreturn collectTeamProviderBindings;`,
  );

  assert.deepEqual(factory(PROVIDER_STORAGE_APPS, elements, state, teamById)(), {
    claude: "claude-new",
    "claude-desktop": "desktop-old",
  });
});

test("OpenCode provider dialog exposes identifier, format, headers, options and model table", () => {
  assert.match(html, /id="provider-opencode-fields"/);
  assert.match(html, /id="provider-opencode-key"/);
  assert.match(html, /id="provider-opencode-format"/);
  assert.match(html, />OpenAI Compatible</);
  assert.match(html, /id="provider-opencode-headers"/);
  assert.match(html, /id="provider-opencode-options"/);
  assert.match(html, /id="provider-opencode-models"/);
  assert.match(html, /id="provider-opencode-model"/);
  assert.match(stateSource, /providerOpencodeHeaders:\s*\[\]/);
  assert.match(stateSource, /providerOpencodeOptions:\s*\[\]/);
  assert.match(stateSource, /providerOpencodeModels:\s*\[\]/);
  assert.match(appSource, /function collectProviderOpencodeAppConfig/);
  assert.match(appSource, /function fillProviderOpencodeAppConfig/);
  assert.match(appSource, /X-Title/);
  assert.match(appSource, /600000/);
  assert.match(appSource, /OPENCODE_OPTION_RESERVED/);
  assert.match(appSource, /settingsConfig\.options/);
  assert.match(appSource, /providerKey/);
  assert.match(appSource, /elements\["provider-opencode-fields"\]\.hidden = app !== "opencode"/);
  assert.match(providerSource, /OPENCODE_NPM_BY_FORMAT/);
  assert.match(providerSource, /settings\.options\.baseURL = provider\.baseUrl/);
});

test("backend team scheme skips legacy Claude Desktop bindings by default", async () => {
  assert.equal(PROVIDER_SCHEME_APPS.includes("claude-desktop"), false);
  const switched = [];
  const report = await ProviderStore.prototype.applyTeamBindings.call({
    async switchTo(app, providerId) {
      switched.push([app, providerId]);
      return { app, providerId };
    },
  }, {
    id: "team-legacy",
    name: "旧团队",
    providers: { claude: "claude-provider", "claude-desktop": "desktop-provider", codex: "codex-provider" },
  });

  assert.deepEqual(switched, [["claude", "claude-provider"], ["codex", "codex-provider"]]);
  assert.deepEqual(report.applied.map((entry) => entry.app), ["claude", "codex"]);
});
