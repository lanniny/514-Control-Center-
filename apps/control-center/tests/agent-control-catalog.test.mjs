import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import {
  ADAPTER_TEMPLATES,
  adapterTemplateCatalog,
  runtimeDiagnosticAction,
  runtimeControlCatalog,
} from "../src/adapters/manifest.mjs";
import { ModelDiscovery, parseKimiCatalog, parseOpencodeCatalog, parsePiCatalog } from "../src/model-discovery.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

const kimiProviderCatalog = JSON.stringify({
  models: {
    "kimi-code/kimi-for-coding": {
      displayName: "K2.7 Coding",
      maxContextSize: 262144,
      capabilities: ["thinking", "always_thinking"],
    },
    "kimi-code/kimi-for-coding-highspeed": {
      displayName: "K2.7 Coding Highspeed",
      maxContextSize: 262144,
    },
    "kimi-code/k3": {
      displayName: "K3",
      maxContextSize: 1048576,
      supportEfforts: ["low", "high", "max"],
      defaultEffort: "high",
    },
    "kimi-code/k3-256k": {
      displayName: "K3-256k",
      maxContextSize: 262144,
      supportEfforts: ["low", "high", "max"],
      defaultEffort: "high",
    },
  },
});

test("adapter manifest declares every runtime/editor control surface", () => {
  const modes = new Set(["none", "executable-only", "argv", "stdin", "rpc", "thread-start", "turn-start", "session-start", "env"]);
  for (const template of ADAPTER_TEMPLATES) {
    assert.ok(template.id);
    assert.ok(modes.has(template.commandMode), `${template.id} commandMode`);
    assert.ok(modes.has(template.promptMode), `${template.id} promptMode`);
    assert.ok(modes.has(template.modelMode), `${template.id} modelMode`);
    assert.ok(modes.has(template.effortMode), `${template.id} effortMode`);
    assert.ok(Array.isArray(template.permissionModes) && template.permissionModes.length, `${template.id} permissionModes`);
    assert.ok(template.permissionModes.includes(template.defaultPermissionMode), `${template.id} default permission`);
    assert.ok(["per-turn", "process-fixed"].includes(template.cwdMode), `${template.id} cwdMode`);
    if (template.effortMode === "none") assert.deepEqual(template.effortLevels, []);
    assert.ok(template.routingDefaults, `${template.id} routingDefaults`);
    assert.ok(template.diagnosticActions.some((action) => action.id === "version"), `${template.id} version diagnostic`);
    assert.equal(new Set(template.diagnosticActions.map((action) => action.id)).size, template.diagnosticActions.length, `${template.id} diagnostic ids`);
    for (const key of ["quality", "speed"]) {
      assert.ok(template.routingDefaults[key] >= 0 && template.routingDefaults[key] <= 1, `${template.id} routingDefaults.${key} within [0,1]`);
    }
    assert.ok(
      Number.isInteger(template.routingDefaults.costTier) && template.routingDefaults.costTier >= 1 && template.routingDefaults.costTier <= 5,
      `${template.id} routingDefaults.costTier within 1-5`,
    );
  }

  const browserCatalog = adapterTemplateCatalog();
  assert.ok(browserCatalog.every((template) => template.diagnosticActions.every((action) => !Object.hasOwn(action, "args"))));
});

test("Kimi provider JSON yields four model choices; effort rides the adapter env wire, not model metadata", () => {
  const discovered = parseKimiCatalog(kimiProviderCatalog);
  assert.deepEqual(discovered.models.map((model) => model.id), [
    "kimi-code/kimi-for-coding",
    "kimi-code/kimi-for-coding-highspeed",
    "kimi-code/k3",
    "kimi-code/k3-256k",
  ]);
  assert.deepEqual(discovered.models.find((model) => model.id === "kimi-code/k3")?.nativeEffortLevels, ["low", "high", "max"]);
  assert.deepEqual(discovered.effortLevels, [], "model metadata is not an Adapter effort wire");

  const catalog = runtimeControlCatalog({
    id: "kimi-frontend",
    label: "Kimi Frontend",
    adapter: "kimi-headless-resume",
    modelOptions: [],
    effortLevels: [],
  }, { ...discovered, source: "dynamic" });
  assert.equal(catalog.controls.model.supported, true);
  // 档位目录来自 Adapter 模板（managed k3 实测 low/high/max），经 KIMI_MODEL_THINKING_EFFORT env 透传
  assert.equal(catalog.controls.effort.supported, true);
  assert.equal(catalog.controls.effort.mode, "env");
  assert.deepEqual(catalog.controls.effort.options.map((option) => option.value), ["low", "high", "max"]);
  assert.equal(catalog.sources.effort, "adapter-manifest");
  assert.equal(catalog.commands.filter((command) => command.token === "/model").length, 5);
  assert.equal(catalog.commands.filter((command) => command.token === "/effort").length, 3);
  assert.equal(catalog.commands.some((command) => command.token === "/build"), false);
  // 统一供应商绑定已开通：providerApp=kimi + 序列化 live 投影 + 连接编辑入口
  assert.equal(catalog.context.providerApp, "kimi");
  assert.equal(catalog.connection.mode, "serialized-live-projection");
  assert.ok(catalog.actions.some((action) => action.id === "open-connection"));
});

test("Codex control catalog exposes the native ultra effort, not the 514cc ultracode workflow", () => {
  const catalog = runtimeControlCatalog({
    id: "codex-technical",
    label: "Codex",
    adapter: "codex-app-server",
    modelOptions: [],
    effortLevels: [],
  }, {
    models: [{ id: "gpt-5.6-sol", label: "GPT-5.6-Sol" }],
    effortLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultModel: "gpt-5.6-sol",
    source: "dynamic",
  });
  assert.ok(catalog.controls.effort.options.some((option) => option.value === "ultra"));
  assert.ok(catalog.commands.some((command) => command.label === "/effort ultra"));
  assert.equal(catalog.commands.some((command) => command.label.includes("ultracode")), false);
  assert.deepEqual(catalog.sources, { model: "dynamic", effort: "dynamic" });
});

test("OpenCode and Pi native model listings normalize into stable provider/model ids", () => {
  assert.deepEqual(parseOpencodeCatalog(`\nopenai/gpt-5.6-sol\nanthropic/claude-opus-4-1\nopenai/gpt-5.6-sol\ninvalid model\n`).models, [
    { id: "openai/gpt-5.6-sol", label: "openai/gpt-5.6-sol" },
    { id: "anthropic/claude-opus-4-1", label: "anthropic/claude-opus-4-1" },
  ]);

  const pi = parsePiCatalog(`warning: offline catalog\nprovider model context\nopenai gpt-5.6-sol 400000\nanthropic claude-opus-4-1 200000\nopenai gpt-5.6-sol 400000\n`);
  assert.deepEqual(pi.models, [
    { id: "openai/gpt-5.6-sol", label: "openai/gpt-5.6-sol" },
    { id: "anthropic/claude-opus-4-1", label: "anthropic/claude-opus-4-1" },
  ]);
  assert.deepEqual(pi.effortLevels, []);
});

test("OpenCode exposes only explicitly declared provider variants as effort", () => {
  const profile = {
    id: "swift-responder",
    builtin: false,
    label: "OpenCode",
    adapter: "opencode-run-json",
    modelOptions: [{ id: "openai/gpt-5.6-sol", label: "GPT-5.6" }],
    effortLevels: [],
  };
  const honest = runtimeControlCatalog(profile, { models: profile.modelOptions, effortLevels: [], source: "dynamic" });
  assert.equal(honest.controls.effort.supported, false);
  assert.deepEqual(honest.effortLevels, []);
  assert.equal(honest.commands.some((command) => command.token === "/effort"), false);

  const declared = runtimeControlCatalog({ ...profile, effortLevels: ["fast", "reasoning"] }, { models: profile.modelOptions, source: "fallback" });
  assert.equal(declared.controls.effort.supported, true);
  assert.deepEqual(declared.effortLevels, ["fast", "reasoning"]);
  assert.ok(declared.commands.some((command) => command.label === "/effort reasoning"));
});

test("Pi catalog exposes session-start thinking levels even when the profile fallback is empty", () => {
  const catalog = runtimeControlCatalog({
    id: "pi-resident",
    label: "Pi",
    adapter: "pi-rpc",
    effortLevels: [],
  }, {
    models: [{ id: "anthropic/claude-fable-5", label: "anthropic/claude-fable-5" }],
    effortLevels: [],
    source: "dynamic",
  });
  assert.equal(catalog.controls.effort.mode, "session-start");
  assert.deepEqual(catalog.effortLevels, ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  assert.ok(catalog.commands.some((command) => command.label === "/effort max"));
  assert.ok(catalog.actions.some((action) => action.id === "open-capabilities" && action.execution === "frontend-capability-editor"));
  assert.equal(catalog.controls.effort.source, "adapter-manifest");
});

test("model discovery coalesces identical cold reads and stale generations cannot overwrite refreshed cache", async () => {
  const profile = {
    id: "seat-codex",
    builtin: false,
    label: "Codex seat",
    adapter: "codex-app-server",
    command: "codex",
    modelOptions: [],
    effortLevels: [],
  };
  const discovery = new ModelDiscovery({ profiles: [profile], maxConcurrentDiscoveries: 2 });
  let calls = 0;
  let releaseFirst;
  const firstGate = new Promise((resolveGate) => { releaseFirst = resolveGate; });
  discovery.discover = async () => {
    calls += 1;
    const current = calls;
    if (current === 1) await firstGate;
    return {
      models: [{ id: current === 1 ? "old-model" : "new-model", label: "model" }],
      effortLevels: [],
      defaultModel: null,
    };
  };

  const first = discovery.forAgent(profile.id);
  const coalesced = discovery.forAgent(profile.id);
  await new Promise((resolveTick) => setImmediate(resolveTick));
  assert.equal(calls, 1);
  discovery.invalidate(profile.id);
  const refreshed = await discovery.forAgent(profile.id);
  assert.equal(refreshed.models[0].id, "new-model");
  releaseFirst();
  await Promise.all([first, coalesced]);
  const cached = await discovery.forAgent(profile.id);
  assert.equal(cached.models[0].id, "new-model");
  assert.equal(calls, 2);
});

test("model discovery globally caps concurrent CLI probes", async () => {
  const profiles = ["a", "b", "c", "d"].map((id) => ({
    id,
    builtin: false,
    label: id,
    adapter: "codex-app-server",
    command: "codex",
    modelOptions: [],
    effortLevels: [],
  }));
  const discovery = new ModelDiscovery({ profiles, maxConcurrentDiscoveries: 2 });
  let active = 0;
  let peak = 0;
  discovery.discover = async (profile) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 20));
    active -= 1;
    return { models: [{ id: `model-${profile.id}`, label: profile.id }], effortLevels: [], defaultModel: null };
  };
  await Promise.all(profiles.map((profile) => discovery.forAgent(profile.id)));
  assert.equal(peak, 2);
});

test("diagnostic action resolution returns only manifest argv and rejects unknown actions", () => {
  const profile = { id: "codex-technical", adapter: "codex-app-server", command: "codex" };
  const version = runtimeDiagnosticAction(profile, "version");
  assert.equal(version.command, "codex");
  assert.deepEqual(version.args, ["--version"]);
  assert.deepEqual(runtimeDiagnosticAction(profile, "doctor").args, ["doctor", "--json"]);
  assert.deepEqual(runtimeDiagnosticAction(profile, "features").args, ["features", "list"]);
  assert.throws(() => runtimeDiagnosticAction(profile, "shell"), {
    code: "AGENT_ACTION_UNSUPPORTED",
    actionId: "shell",
  });
});

test("every selectable CLI maps its verified read-only command surface into the console", () => {
  const expected = {
    "claude-stream-json": ["version", "doctor", "auth-status", "agent-list", "mcp-list", "plugin-list"],
    "codex-app-server": ["version", "doctor", "login-status", "features", "mcp-list", "plugin-list"],
    "gemini-stream-json": ["version", "mcp-list", "extension-list", "skill-list"],
    "grok-build-headless": ["version", "doctor", "inspect", "models", "mcp-list", "plugin-list", "session-list"],
    "kimi-headless-resume": ["version", "doctor", "doctor-tui", "provider-list"],
    "opencode-run-json": ["version", "usage", "mcp-list", "agent-list", "models", "session-list"],
    "pi-rpc": ["version", "extensions", "models"],
  };
  const allowedRisks = new Set(["local-read", "network-probe", "process-probe"]);
  for (const [templateId, actionIds] of Object.entries(expected)) {
    const template = ADAPTER_TEMPLATES.find((item) => item.id === templateId);
    assert.ok(template, templateId);
    assert.deepEqual(template.diagnosticActions.map((action) => action.id), actionIds, templateId);
    for (const action of template.diagnosticActions) {
      assert.ok(allowedRisks.has(action.risk), `${templateId}.${action.id} risk`);
      assert.equal(action.provenance, "native-cli-help");
    }
  }
});

test("control catalog states the safe subset boundary instead of claiming full CLI parity", () => {
  const catalog = runtimeControlCatalog({
    id: "codex-technical",
    adapter: "codex-app-server",
    command: "codex",
  });
  assert.deepEqual(catalog.coverage, {
    commands: "composer-native-controls",
    diagnostics: "allowlisted-read-only-subset",
    configuration: "transactional-deep-links",
  });
  const prohibitedActionIds = new Set(["install", "update", "delete", "login", "logout", "shell"]);
  assert.equal(catalog.actions.some((action) => prohibitedActionIds.has(action.id) && action.execution === "allowlisted-cli"), false);
  assert.ok(catalog.actions.some((action) => action.id === "login-status" && action.execution === "allowlisted-cli"));
});

test("composer slash catalog stays adapter-driven and accepts parameter-stage queries", async () => {
  const [html, appSource] = await Promise.all([
    readFile(`${appRoot}/public/index.html`, "utf8"),
    readFile(`${appRoot}/public/app.js`, "utf8"),
  ]);
  assert.doesNotMatch(appSource, /const\s+SLASH_COMMANDS\s*=/);
  assert.match(appSource, /catalog\.commands\.map/);
  assert.match(appSource, /catalog\?\.context\?\.memberId === agentId/);
  assert.equal((appSource.match(/task-effort-pick"\]\?\.hidden \? undefined/g) || []).length, 1, "composer controls must be read once at the immutable snapshot boundary");
  assert.match(appSource, /function captureComposerConfig/);
  assert.equal((appSource.match(/<section class="provider-global-empty"/g) || []).length, 1);
  assert.match(appSource, /provider-add-button"\]\.hidden = globallyEmpty \|\| storeBlocked/);
  assert.doesNotMatch(html, /option value="ultracode"/);

  const start = appSource.indexOf("function slashQueryAtCursor");
  const end = appSource.indexOf("\nfunction syncSlashActiveOption", start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  runInNewContext(`${appSource.slice(start, end)}\nthis.querySlash = slashQueryAtCursor;`, context);
  assert.equal(context.querySlash({ value: "/model ", selectionStart: 7 }).query, "model ");
  assert.equal(context.querySlash({ value: "run /effort xh", selectionStart: 14 }).query, "effort xh");
});
