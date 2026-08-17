import test from "node:test";
import assert from "node:assert/strict";

import {
  breakerStateMeta,
  cliEnvFailureDetail,
  cliEnvPulse,
  formatAuthResource,
  mountCcSwitchPanel,
  syncChannelMeta,
  workbenchPulse,
} from "../public/modules/ccswitch-panel.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createRoot() {
  const body = { innerHTML: "" };
  const status = { textContent: "", dataset: {} };
  const listeners = new Map();
  return {
    body,
    status,
    innerHTML: "",
    addEventListener(type, listener) {
      const registered = listeners.get(type) ?? [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    contains: () => true,
    dispatch(type, target) {
      for (const listener of listeners.get(type) ?? []) listener({ target });
    },
    querySelector(selector) {
      if (selector === "[data-ccs-body]") return body;
      if (selector === "[data-ccs-status]") return status;
      return null;
    },
    querySelectorAll: () => [],
    scrollIntoView() {},
  };
}

function responseFor(path) {
  if (path === "/api/ccswitch/domain") return { state: {}, configPaths: {} };
  if (path === "/api/ccswitch/proxy/status") return { status: {} };
  if (path === "/api/providers") return { providers: [] };
  if (path.includes("usage/summary")) return { summary: {} };
  if (path.includes("/logs")) return { items: [] };
  if (path.includes("/health")) return { items: [] };
  if (path.includes("/pricing")) return { pricing: {} };
  if (path === "/api/ccswitch/auth") return { providers: [] };
  throw new Error(`unexpected request: ${path}`);
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("CLI 环境失败信息保留服务端 outputTail 中的可行动诊断", () => {
  const error = Object.assign(new Error("Grok Build install exited 1"), {
    payload: {
      code: "CLI_ENV_INSTALL_FAILED",
      outputTail: [
        "npm error code EBADPLATFORM",
        "npm error notsup Unsupported platform for @xai-official/grok",
        "npm error notsup Actual os: win32",
      ].join("\n"),
    },
  });

  const detail = cliEnvFailureDetail(error);
  assert.match(detail, /install exited 1/);
  assert.match(detail, /EBADPLATFORM/);
  assert.match(detail, /Actual os: win32/);
});

test("provider workbench omits Claude Desktop while retaining storage compatibility", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const root = createRoot();
    mountCcSwitchPanel({ root, request: (path) => Promise.resolve(responseFor(path)) });
    await settle();

    assert.match(root.body.innerHTML, /data-ccs-takeover="codex"/);
    assert.doesNotMatch(root.body.innerHTML, /Claude Desktop|data-ccs-takeover="claude-desktop"/);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("openDeeplink stays pending through parsing so a slow A and fast B drain in FIFO order", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const root = createRoot();
    const parseA = deferred();
    const parseB = deferred();
    const calls = [];
    const request = (path, options = {}) => {
      if (path !== "/api/ccswitch/domain/deeplink/parse") return Promise.resolve(responseFor(path));
      const url = options.body.url;
      calls.push(url);
      return url === "ccswitch://a" ? parseA.promise : parseB.promise;
    };
    const panel = mountCcSwitchPanel({ root, request });
    await settle();

    let queue = Promise.resolve();
    const enqueue = (url) => (queue = queue.then(() => panel.openDeeplink(url)));
    const first = enqueue("ccswitch://a");
    const second = enqueue("ccswitch://b");
    await settle();

    assert.deepEqual(calls, ["ccswitch://a"]);
    const pendingButton = root.body.innerHTML.match(/<button[^>]+data-ccs-action="deeplink-preview"[^>]*>/)?.[0] ?? "";
    assert.match(pendingButton, / disabled/);
    assert.match(pendingButton, /aria-busy="true"/);

    parseB.resolve({ resource: "skill", preview: { name: "B" } });
    await settle();
    assert.deepEqual(calls, ["ccswitch://a"], "B must not start before A settles");

    parseA.resolve({ resource: "mcp", preview: { name: "A" } });
    await first;
    await second;
    assert.deepEqual(calls, ["ccswitch://a", "ccswitch://b"]);
    assert.deepEqual(panel.state.deeplink, { url: "ccswitch://b", resource: "skill", preview: { name: "B" } });
    const readyButton = root.body.innerHTML.match(/<button[^>]+data-ccs-action="deeplink-preview"[^>]*>/)?.[0] ?? "";
    assert.doesNotMatch(readyButton, / disabled|aria-busy/);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("openDeeplink restores the preview button and rejects parse failures", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const root = createRoot();
    const request = (path) => path === "/api/ccswitch/domain/deeplink/parse"
      ? Promise.reject(new Error("parse unavailable"))
      : Promise.resolve(responseFor(path));
    const panel = mountCcSwitchPanel({ root, request });
    await settle();

    await assert.rejects(panel.openDeeplink("ccswitch://broken"), /parse unavailable/);
    assert.equal(panel.state.deeplinkLoading, false);
    assert.deepEqual(panel.state.deeplink, { url: "ccswitch://broken", resource: null, preview: null });
    assert.equal(root.status.textContent, "parse unavailable");
    assert.equal(root.status.dataset.tone, "error");
    const button = root.body.innerHTML.match(/<button[^>]+data-ccs-action="deeplink-preview"[^>]*>/)?.[0] ?? "";
    assert.doesNotMatch(button, / disabled|aria-busy/);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("refresh exposes partial Promise.allSettled failures as a Forge load result", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const root = createRoot();
    let failLogs = false;
    const request = (path) => {
      if (failLogs && path === "/api/ccswitch/proxy/logs?limit=50") return Promise.reject(new Error("logs unavailable"));
      return Promise.resolve(responseFor(path));
    };
    const panel = mountCcSwitchPanel({ root, request });
    await settle();

    const success = await panel.refresh();
    assert.deepEqual(success, { __forgeLoadResult: true, ok: true, errors: [] });

    failLogs = true;
    const result = await panel.refresh();
    assert.equal(result.__forgeLoadResult, true);
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].path, "/api/ccswitch/proxy/logs?limit=50");
    assert.match(result.errors[0].error.message, /logs unavailable/);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("refresh click handler warns instead of reporting success after a partial failure", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const root = createRoot();
    let failLogs = false;
    let notification = null;
    const request = (path) => {
      if (failLogs && path === "/api/ccswitch/proxy/logs?limit=50") return Promise.reject(new Error("logs unavailable"));
      return Promise.resolve(responseFor(path));
    };
    const panel = mountCcSwitchPanel({
      root,
      request,
      notify: (text, tone) => notification?.resolve({ text, tone }),
    });
    await panel.refresh();

    failLogs = true;
    notification = deferred();
    const button = { dataset: { ccsAction: "refresh" } };
    root.dispatch("click", { closest: () => button });
    const notice = await notification.promise;

    assert.deepEqual(notice, { text: "刷新未完全成功：1 项加载失败", tone: "warning" });
    assert.equal(root.status.textContent, notice.text);
    assert.equal(root.status.dataset.tone, "warning");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("native invoke failures are included in the Forge load result", async () => {
  const previousWindow = globalThis.window;
  const invocations = [];
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke(command) {
        invocations.push(command);
        return Promise.reject(new Error("native bridge unavailable"));
      },
    },
  };
  try {
    const root = createRoot();
    const panel = mountCcSwitchPanel({ root, request: (path) => Promise.resolve(responseFor(path)) });
    const result = await panel.refresh();

    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].path, "tauri:native");
    assert.match(result.errors[0].error.message, /native bridge unavailable/);
    assert.deepEqual(invocations, ["get_native_capabilities", "get_auto_launch_status", "is_lightweight_mode"]);
    assert.deepEqual(panel.state.native, { error: "native bridge unavailable" });
  } finally {
    globalThis.window = previousWindow;
  }
});

test("mount load and concurrent refresh calls share one in-flight request set", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const root = createRoot();
    const initial = deferred();
    const calls = [];
    const request = (path) => {
      calls.push(path);
      return initial.promise.then(() => responseFor(path));
    };
    const panel = mountCcSwitchPanel({ root, request });
    const first = panel.refresh();
    const second = panel.refresh();

    assert.strictEqual(first, second);
    assert.equal(calls.length, 8, "overlapping refresh must reuse the mount load");
    initial.resolve();
    await first;

    const next = panel.refresh();
    assert.notStrictEqual(next, first);
    await next;
    assert.equal(calls.length, 16, "a settled load must allow the next refresh");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("CLI 环境 busy 态：安装/升级中渲染动态按钮，头部全部升级联动", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const root = createRoot();
    const panel = mountCcSwitchPanel({ root, request: (path) => Promise.resolve(responseFor(path)) });
    await panel.refresh();
    panel.state.cliEnv = {
      platform: "win32",
      generatedAt: "2026-08-03T00:00:00Z",
      tools: [
        { id: "pi", label: "Pi", brand: null, status: "upgrade-available", currentVersion: "1.0.0", latestVersion: "1.1.0", packageName: "@514cc/pi", install: { display: "npm i -g @514cc/pi" } },
        { id: "grok", label: "Grok Build", brand: null, status: "up-to-date", currentVersion: "2.0.0", latestVersion: "2.0.0", packageName: "@xai/grok", install: { display: "npm i -g @xai/grok" } },
      ],
    };
    panel.state.cliEnvBusy = { pi: true };
    panel.state.tab = "env";
    await panel.refresh();
    const html = root.body.innerHTML;
    // busy 按钮两处：卡片「处理中」（带跳点）+ 头部「全部升级」联动
    const busyButtons = html.match(/<button[^>]+ccs-cli-busy[^>]*>[\s\S]*?<\/button>/g) ?? [];
    assert.equal(busyButtons.length, 2, "卡片按钮 + 全部升级各一处 busy");
    const cardButton = busyButtons.find((markup) => markup.includes("处理中")) ?? "";
    assert.match(cardButton, /ccs-cli-busy-dots/);
    assert.match(cardButton, /loader-circle/);
    assert.match(cardButton, / disabled/);
    const headButton = busyButtons.find((markup) => markup.includes("全部升级")) ?? "";
    assert.match(headButton, /loader-circle/);
    const refreshButton = html.match(/<button[^>]+data-ccs-action="clienv-refresh"[^>]*>/)?.[0] ?? "";
    assert.doesNotMatch(refreshButton, /ccs-cli-busy/);
    // 非 busy 卡片仍是普通状态文本
    assert.doesNotMatch(html.match(/data-ccs-cli-card="grok"[\s\S]*?<\/section>/)?.[0] ?? "", /ccs-cli-busy/);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("syncChannelMeta 区分未配置 / 已关闭 / 已同步 / 错误", () => {
  assert.deepEqual(syncChannelMeta({}), { tone: "muted", label: "未配置", detail: "" });
  assert.equal(syncChannelMeta({ enabled: false, baseUrl: "https://dav.example" }).label, "已关闭");
  assert.equal(syncChannelMeta({ enabled: true }).label, "已启用");
  assert.equal(syncChannelMeta({ enabled: true, status: { lastSuccessAt: "2026-08-16T00:00:00Z" } }).tone, "ok");
  assert.equal(syncChannelMeta({ enabled: true, status: { lastError: "401" } }).label, "错误");
});

test("breakerStateMeta 把 closed/open 译成正常/熔断", () => {
  assert.deepEqual(breakerStateMeta("closed"), { tone: "is-ok", label: "正常" });
  assert.deepEqual(breakerStateMeta("open"), { tone: "is-error", label: "熔断" });
  assert.equal(breakerStateMeta("half-open").label, "试探");
});

test("cliEnvPulse 与 workbenchPulse 用真实计数而不是占位", () => {
  const pulse = cliEnvPulse([
    { status: "up-to-date" },
    { status: "upgrade-available" },
    { status: "not-installed" },
    { status: "broken" },
  ]);
  assert.deepEqual(pulse, { ready: 1, upgrade: 1, missing: 1, broken: 1, total: 4 });
  const tabs = workbenchPulse({
    cliEnv: { tools: [{ status: "upgrade-available" }] },
    proxy: { running: true, takeover: { claude: true } },
    domain: { prompts: { claude: { a: {} } }, mcps: {}, skills: {}, profiles: {}, settings: { webdav: {}, s3: {} } },
    auth: { providers: [{ accounts: [{ id: "1" }] }] },
  });
  assert.equal(tabs.env.badge, "1 可升级");
  assert.equal(tabs.proxy.badge, "运行中");
  assert.equal(tabs.resources.badge, "1");
  assert.equal(tabs.sync.badge, "未配置");
  assert.equal(tabs.accounts.badge, "1 已登录");
});

test("formatAuthResource 把模型列表收成 chips，额度收成键值，密钥字段不露", () => {
  const models = formatAuthResource("models", { data: [{ id: "gpt-5" }, { slug: "claude-opus" }] });
  assert.deepEqual(models, { mode: "models", items: ["gpt-5", "claude-opus"] });
  const quota = formatAuthResource("quota", { copilot_plan: "pro", access_token: "secret", nested: { remaining: 12 } });
  assert.equal(quota.mode, "quota");
  assert.deepEqual(quota.items, [["copilot_plan", "pro"], ["nested.remaining", "12"]]);
});

test("代理面显示成功率与中文熔断状态，接管格带品牌图标", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const root = createRoot();
    const panel = mountCcSwitchPanel({
      root,
      request: (path) => {
        if (path === "/api/ccswitch/proxy/status") return Promise.resolve({ status: { running: true, listenAddress: "127.0.0.1", listenPort: 15721, takeover: { claude: true } } });
        if (path.includes("usage/summary")) return Promise.resolve({ summary: { windowDays: 30, requests: 9, failedRequests: 1, totalRequests: 10, successRate: 0.9, inputTokens: 1200, outputTokens: 800, costUsd: 0.12 } });
        if (path.includes("/health")) return Promise.resolve({ items: [{ app: "claude", providerId: "p1", state: "open", consecutiveFailures: 3, lastFailure: "timeout" }] });
        return Promise.resolve(responseFor(path));
      },
    });
    await panel.refresh();
    const html = root.body.innerHTML;
    assert.match(html, /成功率/);
    assert.match(html, /90\.0%/);
    assert.match(html, />熔断</);
    assert.match(html, /ccs-takeover is-on/);
    assert.match(html, /icon-cli-claude/);
    assert.doesNotMatch(html, />open</);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("同步面把空通道标成未配置而不是未同步", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const root = createRoot();
    const panel = mountCcSwitchPanel({ root, request: (path) => Promise.resolve(responseFor(path)) });
    await panel.refresh();
    panel.state.tab = "sync";
    await panel.refresh();
    assert.match(root.body.innerHTML, /未配置/);
    assert.doesNotMatch(root.body.innerHTML, /未同步/);
    assert.match(root.body.innerHTML, /云端备份/);
    assert.match(root.body.innerHTML, /本机健康/);
  } finally {
    globalThis.window = previousWindow;
  }
});
