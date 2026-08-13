import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const source = await readFile(`${appRoot}/public/hosts-panel.js`, "utf8");

function sourceSection(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function evaluateSection(section, exports, dependencies = {}) {
  const names = Object.keys(dependencies);
  const values = Object.values(dependencies);
  const factory = new Function(...names, `${section}\nreturn { ${exports.join(", ")} };`);
  return factory(...values);
}

const esc = (text) => String(text ?? "").replace(/[&<>\"]/g, (ch) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '\"': "&quot;",
}[ch]));

function syncHelpers() {
  return evaluateSection(
    sourceSection("function resultRequiresRecovery", "async function refresh"),
    ["resultRequiresRecovery", "rememberSyncRecovery", "plannedSyncSelections", "configSyncResultMarkup"],
    {
      state: { localRecoveries: new Map() },
      recoveryBridge: () => null,
      esc,
    },
  );
}

function fakeSyncDialog(fileId = "codex-config") {
  const listeners = new Map();
  const push = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    async click() { return listeners.get("click")?.(); },
  };
  const cancel = { addEventListener() {} };
  const message = { textContent: "" };
  const body = { innerHTML: "" };
  const checkbox = { dataset: { syncFile: fileId }, checked: true };
  return {
    open: false,
    closed: false,
    innerHTML: "",
    showModal() { this.open = true; },
    close() { this.open = false; this.closed = true; },
    querySelector(selector) {
      if (selector === ".dialog-body") return body;
      if (selector === '[data-act="push"]') return push;
      if (selector === "#syncconfig-msg") return message;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-act="cancel"]') return [cancel];
      if (selector === "[data-sync-file]:checked") return checkbox.checked ? [checkbox] : [];
      return [];
    },
    push,
    message,
  };
}

test("sync selections preserve the server plan digest and explicit secret confirmation", () => {
  const { plannedSyncSelections } = syncHelpers();
  assert.deepEqual(
    plannedSyncSelections(
      [
        { id: "codex-config", digest: "a".repeat(64) },
        { id: "claude-config", digest: "b".repeat(64) },
      ],
      ["codex-config", "claude-config"],
      ["claude-config"],
    ),
    [
      { id: "codex-config", digest: "a".repeat(64), allowSecrets: false },
      { id: "claude-config", digest: "b".repeat(64), allowSecrets: true },
    ],
  );
});

test("HTTP 200 recovery_required is blocked, never reported complete, and remote result text is escaped", () => {
  const { configSyncResultMarkup, resultRequiresRecovery } = syncHelpers();
  const result = {
    complete: false,
    status: "recovery_required",
    recoveryRequired: true,
    home: "</strong><img src=x onerror=1>",
    results: [{
      ok: false,
      label: "<img src=x onerror=2>",
      remote: "</div><script>remote()</script>",
      error: "<svg onload=error()>",
    }, {
      ok: true,
      label: "safe",
      remote: "/remote/safe",
      bytes: "<img src=x onerror=3>",
    }],
  };
  const rendered = configSyncResultMarkup(result);
  assert.equal(resultRequiresRecovery(result), true);
  assert.equal(rendered.complete, false);
  assert.equal(rendered.recoveryRequired, true);
  assert.match(rendered.html, /同步状态不确定/);
  assert.doesNotMatch(rendered.html, /同步完成/);
  assert.doesNotMatch(rendered.html, /<script>|<img|<svg/);
  assert.match(rendered.html, /&lt;img src=x onerror=2&gt;/);
  assert.match(rendered.html, /&lt;\/div&gt;&lt;script&gt;remote\(\)&lt;\/script&gt;/);
  assert.match(rendered.html, /&lt;svg onload=error\(\)&gt;/);
  assert.match(rendered.html, /&lt;img src=x onerror=3&gt;B/);

  const empty = configSyncResultMarkup({ complete: true, status: "completed", results: [] });
  assert.equal(empty.complete, false);
  assert.match(empty.html, /同步未完成/);
});

test("hosts panel consumes the shared host recovery bridge and fails closed when evidence is unreadable", () => {
  const state = { localRecoveries: new Map() };
  const bridge = { isReady: () => true, isHostBlocked: (hostId) => hostId === "blocked" };
  const helpers = evaluateSection(
    sourceSection("const CONFIG_REMOTE_RECOVERY_STORAGE_KEY", "function resultRequiresRecovery"),
    ["persistedRecoveriesForHost", "isHostRecoveryBlocked"],
    {
      state,
      window: { __514ccConfigRemoteRecovery: bridge },
      localStorage: { getItem: () => null },
      actionResult() {},
      esc,
    },
  );
  assert.equal(helpers.isHostRecoveryBlocked("blocked"), true);
  assert.equal(helpers.isHostRecoveryBlocked("clear"), false);

  const fallback = evaluateSection(
    sourceSection("const CONFIG_REMOTE_RECOVERY_STORAGE_KEY", "function resultRequiresRecovery"),
    ["isHostRecoveryBlocked"],
    {
      state: { localRecoveries: new Map() },
      window: {},
      localStorage: { getItem: () => "not-json" },
      actionResult() {},
      esc,
    },
  );
  assert.equal(fallback.isHostRecoveryBlocked("h1"), true);

  bridge.isReady = () => false;
  assert.equal(helpers.isHostRecoveryBlocked("clear"), true);
});

test("a recovery stays fail-closed until the shared bridge explicitly accepts and reports it", () => {
  const state = { localRecoveries: new Map() };
  let bridgeBlocked = false;
  const bridge = {
    isReady: () => true,
    remember: () => null,
    isHostBlocked: () => bridgeBlocked,
  };
  const helpers = evaluateSection(
    sourceSection("function recoveryBridge", "async function refresh"),
    ["rememberSyncRecovery", "isHostRecoveryBlocked"],
    {
      state,
      window: { __514ccConfigRemoteRecovery: bridge },
      localStorage: { getItem: () => JSON.stringify({ schema: 1, records: [] }) },
      actionResult() {},
      esc,
    },
  );
  const recovery = { status: "recovery_required", recoveryRequired: true, transactionId: "tx-1" };
  assert.equal(helpers.rememberSyncRecovery("h1", recovery), true);
  assert.equal(helpers.isHostRecoveryBlocked("h1"), true);
  assert.equal(state.localRecoveries.has("h1"), true);

  bridge.remember = () => ({ transactionId: "tx-1" });
  bridgeBlocked = true;
  assert.equal(helpers.isHostRecoveryBlocked("h1"), true);
  assert.equal(state.localRecoveries.has("h1"), false);
});

test("host rows disable arbitrary exec while recovery is blocked but keep read-only SFTP available", () => {
  const { rowHtml } = evaluateSection(
    sourceSection("function rowHtml", "function render"),
    ["rowHtml"],
    {
      state: { probes: new Map() },
      isHostRecoveryBlocked: () => true,
      esc,
      lucideIcon: () => "",
      statusInner: () => "未探测",
    },
  );
  const html = rowHtml({ id: "h1", name: "Host", user: "dev", host: "example.test", port: 22, enabled: true, trusted: true });
  const execButton = html.match(/<button[^>]+data-host-exec="h1"[^>]*>/)?.[0] ?? "";
  const sftpButton = html.match(/<button[^>]+data-host-sftp="h1"[^>]*>/)?.[0] ?? "";
  assert.match(execButton, /\bdisabled\b/);
  assert.match(execButton, /存在未核对的远端事务/);
  assert.doesNotMatch(sftpButton, /\bdisabled\b/);
  assert.equal((html.match(/data-host-toggle="h1"[^>]*\btitle=/g) ?? []).length, 1);
});

test("remote exec checks the host recovery gate before opening and again before POST", async () => {
  const section = sourceSection("async function execOnHost", "async function deleteHost");
  let prompts = 0;
  let requests = 0;
  let guardChecks = 0;
  const dependencies = {
    state: { hosts: [{ id: "h1", name: "Host" }] },
    promptCommandDialog: async () => { prompts += 1; return "printf ready"; },
    guardHostWrite: () => ++guardChecks > 1,
    request: async () => { requests += 1; return { code: 0, stdout: "ready", stderr: "" }; },
    actionResult() {},
    esc,
    lucideIcon: () => "",
  };
  const { execOnHost } = evaluateSection(section, ["execOnHost"], dependencies);
  await execOnHost({}, "h1");
  assert.equal(guardChecks, 2);
  assert.equal(prompts, 1);
  assert.equal(requests, 0);

  prompts = 0;
  requests = 0;
  guardChecks = 0;
  dependencies.guardHostWrite = () => { guardChecks += 1; return true; };
  const blocked = evaluateSection(section, ["execOnHost"], dependencies);
  await blocked.execOnHost({}, "h1");
  assert.equal(guardChecks, 1);
  assert.equal(prompts, 0);
  assert.equal(requests, 0);
});

test("sync dialog posts planned objects and persists a successful HTTP recovery response", async () => {
  const dialog = fakeSyncDialog();
  const calls = [];
  const results = [];
  const recoveries = [];
  const planFile = {
    id: "codex-config",
    label: "Codex",
    local: ".codex/config.toml",
    remote: ".codex/config.toml",
    exists: true,
    size: 12,
    containsSecrets: false,
    digest: "d".repeat(64),
  };
  const recovery = {
    complete: false,
    status: "recovery_required",
    recoveryRequired: true,
    transactionId: "tx-1",
    results: [{ ok: false, label: "<img src=x>", remote: "<script>x</script>", error: "<svg onload=x>" }],
  };
  const helpers = syncHelpers();
  const { openSyncConfigDialog } = evaluateSection(
    sourceSection("async function openSyncConfigDialog", "/* —— 既有能力"),
    ["openSyncConfigDialog"],
    {
      ensureModal: () => dialog,
      guardHostWrite: () => false,
      request: async (path, options) => {
        calls.push({ path, options });
        return calls.length === 1 ? { files: [planFile] } : recovery;
      },
      esc,
      lucideIcon: () => "",
      confirmRemoteAction: async () => true,
      plannedSyncSelections: helpers.plannedSyncSelections,
      configSyncResultMarkup: helpers.configSyncResultMarkup,
      rememberSyncRecovery: (hostId, value) => { recoveries.push({ hostId, value }); return true; },
      actionResult: (_root, html) => results.push(html),
      render() {},
    },
  );

  await openSyncConfigDialog({}, { id: "h1", name: "Host" });
  await dialog.push.click();

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], {
    path: "/api/ssh/hosts/h1/env-sync",
    options: {
      method: "POST",
      body: { files: [{ id: "codex-config", digest: "d".repeat(64), allowSecrets: false }] },
    },
  });
  assert.equal(dialog.closed, true);
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].hostId, "h1");
  assert.match(results.at(-1), /同步状态不确定/);
  assert.doesNotMatch(results.at(-1), /同步完成|<script>|<img|<svg/);
});

test("sync dialog rechecks the recovery gate before POST", async () => {
  const dialog = fakeSyncDialog();
  const calls = [];
  let guardChecks = 0;
  const helpers = syncHelpers();
  const { openSyncConfigDialog } = evaluateSection(
    sourceSection("async function openSyncConfigDialog", "/* —— 既有能力"),
    ["openSyncConfigDialog"],
    {
      ensureModal: () => dialog,
      guardHostWrite: () => ++guardChecks > 1,
      request: async (path, options) => {
        calls.push({ path, options });
        return { files: [{
          id: "codex-config", label: "Codex", local: "a", remote: "b", exists: true,
          size: 1, containsSecrets: false, digest: "e".repeat(64),
        }] };
      },
      esc,
      lucideIcon: () => "",
      confirmRemoteAction: async () => true,
      plannedSyncSelections: helpers.plannedSyncSelections,
      configSyncResultMarkup: helpers.configSyncResultMarkup,
      rememberSyncRecovery: () => false,
      actionResult() {},
      render() {},
    },
  );
  await openSyncConfigDialog({}, { id: "h1", name: "Host" });
  await dialog.push.click();
  assert.equal(calls.length, 1);
  assert.equal(dialog.message.textContent, "该主机出现未核对事务，本次同步已阻止。");
});

test("CLI install rechecks recovery after confirmation and never starts a blocked request", async () => {
  let guardChecks = 0;
  let requestCount = 0;
  const { installCliRemote } = evaluateSection(
    sourceSection("async function installCliRemote", "/** 通用远程操作确认框"),
    ["installCliRemote"],
    {
      state: {
        hosts: [{ id: "h1", name: "Host" }],
        envProbes: new Map([["h1", { data: { os: "Linux", clis: [{ id: "codex", label: "Codex", command: "codex" }] } }]]),
      },
      guardHostWrite: () => ++guardChecks > 1,
      confirmRemoteAction: async () => true,
      actionResult() {},
      request: async () => { requestCount += 1; return { ok: true }; },
      probeHostEnv: async () => {},
      esc,
      lucideIcon: () => "",
    },
  );
  await installCliRemote({}, "h1", "codex");
  assert.equal(guardChecks, 2);
  assert.equal(requestCount, 0);
});

test("delete requires an explicit dialog confirmation and exposes DELETE failures", async () => {
  const actions = [];
  const requests = [];
  let confirmation;
  const { deleteHost } = evaluateSection(
    sourceSection("async function deleteHost", "/** 从 ~/.ssh/config"),
    ["deleteHost"],
    {
      state: { hosts: [{ id: "h1", name: "<Host>" }] },
      guardHostWrite: () => false,
      confirmRemoteAction: async (options) => { confirmation = options; return true; },
      request: async (path, options) => { requests.push({ path, options }); throw new Error("<delete failed>"); },
      refresh: async () => {},
      actionResult: (_root, html) => actions.push(html),
      esc,
      lucideIcon: () => "",
    },
  );
  await deleteHost({}, "h1");
  assert.equal(confirmation.confirmLabel, "确认移除");
  assert.match(confirmation.body, /&lt;Host&gt;/);
  assert.deepEqual(requests, [{ path: "/api/ssh/hosts/h1", options: { method: "DELETE" } }]);
  assert.match(actions.at(-1), /移除失败/);
  assert.match(actions.at(-1), /&lt;delete failed&gt;/);
  assert.doesNotMatch(actions.at(-1), /<delete failed>/);
});

test("delete and ssh-config sync are both no-op while the host recovery gate is blocked", async () => {
  let requests = 0;
  let confirmations = 0;
  const dependencies = {
    state: { hosts: [{ id: "h1", name: "Host" }], probes: new Map() },
    guardHostWrite: () => true,
    confirmRemoteAction: async () => { confirmations += 1; return true; },
    request: async () => { requests += 1; return {}; },
    refresh: async () => {},
    actionResult() {},
    esc,
    lucideIcon: () => "",
  };
  const { deleteHost } = evaluateSection(
    sourceSection("async function deleteHost", "/** 从 ~/.ssh/config"),
    ["deleteHost"],
    dependencies,
  );
  const { syncConfig } = evaluateSection(
    sourceSection("async function syncConfig", "async function sftpList"),
    ["syncConfig"],
    dependencies,
  );

  await deleteHost({}, "h1");
  await syncConfig({}, "h1");
  assert.equal(confirmations, 0);
  assert.equal(requests, 0);
});
