import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ProviderStore, PROVIDER_SCHEME_APPS } from "../src/providers.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const [appSource, html, css, stateSource] = await Promise.all([
  readFile(`${appRoot}/public/app.js`, "utf8"),
  readFile(`${appRoot}/public/index.html`, "utf8"),
  readFile(`${appRoot}/public/styles.css`, "utf8"),
  readFile(`${appRoot}/public/state.js`, "utf8"),
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
  const providerMeta = sourceSection("const PROVIDER_APP_META", "// 供应商列表聚焦 app");
  assert.doesNotMatch(providerMeta, /label:\s*"Claude Desktop"/);
  assert.match(providerMeta, /PROVIDER_STORAGE_APPS[^\n]+"claude-desktop"/);
  assert.doesNotMatch(html, /team-provider-claude-desktop|provider-models-claude-desktop|provider-claude-desktop-model/);
  assert.doesNotMatch(html, />Claude Desktop</);
  assert.doesNotMatch(appSource, /"team-provider-claude-desktop"|"provider-models-claude-desktop"|"provider-claude-desktop-model"/);
  assert.match(appSource, /const existing = teamById\(state\.editingTeamId\)\?\.providers \?\? \{\}/);
  assert.match(appSource, /const value = select \? select\.value : existing\[app\] \?\? ""/);
  assert.match(appSource, /body: \{ teamId, apps: bindings\.map\(\(\[app\]\) => app\) \}/);
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
