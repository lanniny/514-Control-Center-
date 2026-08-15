import test from "node:test";
import assert from "node:assert/strict";

import { cliEnvFailureDetail, mountCcSwitchPanel } from "../public/modules/ccswitch-panel.js";

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
