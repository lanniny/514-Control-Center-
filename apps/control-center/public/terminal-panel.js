/**
 * terminal-panel.js — Wave G 终端（xterm 多页签 + PTY 后端），已工厂化。
 *
 * 契约：
 *   - vendored xterm（/vendor/xterm/，离线无 CDN）；主题跟随 forge 明暗
 *   - 输出走 fetch 流式读（与 app.js consumeEvents 同款，可带 Authorization）
 *   - 输入 POST 单飞；ResizeObserver 自适应；会话退出标记页签
 *   - 门闸未开放 → 引导卡；零 emoji；lucideIcon；无内联 style 属性
 *
 * 工厂化（布局模仿波 2026-07-26）：
 *   createTerminalPanel(root) 返回独立实例（各自 tabs 台账），终端视图与协作台
 *   底部 dock 各持一份。PTY 后端 stream 是订阅制（replay + 广播），多实例同挂
 *   一个 session 等价 tmux 双 attach——输出全量各收，输入两路皆可达。
 */
import { request, apiReady, getAccessToken } from "./api.js";
import { lucideIcon } from "./lucide.js";
import { escapeHtml } from "./utils.js";
import { Terminal } from "./vendor/xterm/xterm.mjs";
import { FitAddon } from "./vendor/xterm/addon-fit.mjs";

function themeTokens() {
  const style = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    background: pick("--forge-bg-primary", "#1c1917"),
    foreground: pick("--forge-text-primary", "#e7e5e4"),
    cursor: pick("--forge-accent", "#e11d48"),
    cursorAccent: pick("--forge-bg-primary", "#1c1917"),
    selectionBackground: pick("--forge-accent-soft", "#57534e"),
    // 追加 Nerd Font 候选：oh-my-posh / starship 的提示符字形只有装了 Nerd Font 才不显示成方块；
    // 装了就自动生效，没装则按顺序回落到普通等宽字体。
    fontFamily: [
      pick("--forge-font-mono", ""),
      "'CaskaydiaCove Nerd Font'", "'CaskaydiaCove NF'", "'MesloLGS NF'", "'FiraCode Nerd Font'", "'JetBrainsMono Nerd Font'",
      "'Cascadia Mono'", "Consolas", "'Courier New'", "monospace",
    ].filter(Boolean).join(", "),
  };
}

function gateCard(root, gate, reason) {
  root.innerHTML = `
    <div class="forge-empty-waveg">
      ${lucideIcon("lock", "icon lucide icon-lg")}
      <h2>终端门闸未开放</h2>
      <p class="subtle">${gate ?? "pty"} · ${reason ?? "需要 LO 授权账本记录"}</p>
    </div>`;
}

export function createTerminalPanel(root) {
  const tabs = new Map(); // id → { session, term, fit, paneEl, tabEl, streamCtl, observer, exited }

  /**
   * 订阅一条会话流。断线后自动重连，且重连一律 `replay=0`：
   *   - 不重连 → 流一断就再也收不到输出，表现是"终端打不出字"（输入其实发出去了）
   *   - 重连时重放 → 每断一次就多一整份首屏，表现是"打开终端有很多条"
   * 只有首次订阅才允许重放缓冲，后续重连只接实时增量。
   */
  async function fetchStream(sessionId, tab, { attempt = 0 } = {}) {
    const headers = { Accept: "text/event-stream" };
    if (getAccessToken()) headers.Authorization = `Bearer ${getAccessToken()}`;
    const query = attempt === 0 ? "" : "?replay=0";
    try {
      const response = await fetch(`/api/pty/${sessionId}/stream${query}`, { headers, signal: tab.streamCtl.signal });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        while (true) {
          const match = /\r?\n\r?\n/.exec(buffer);
          if (!match) break;
          const frame = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          for (const line of frame.split(/\r?\n/)) {
            if (!line.startsWith("data: ")) continue;
            try {
              // 服务端 JSON.stringify 输出本无真实换行（其 replace 是 no-op），
              // 这里必须直接 parse——先反转义会让 JSON 含非法控制字符，含 \n 的 chunk 全丢。
              const payload = JSON.parse(line.slice(6));
              if (payload.exited) {
                tab.exited = true;
                markTabExited(tab);
              } else if (typeof payload.chunk === "string") {
                tab.term.write(payload.chunk);
              }
            } catch { /* 单帧解析失败不炸流 */ }
          }
        }
      }
      // 服务端正常收尾（进程退出）会先推 exited 帧；否则视为连接断开，重连续听
      if (!tab.exited && !tab.streamCtl.signal.aborted) {
        void reconnectStream(sessionId, tab, attempt, "连接结束");
      }
    } catch (error) {
      if (!tab.streamCtl.signal.aborted) {
        void reconnectStream(sessionId, tab, attempt, error.message);
      }
    }
  }

  /** 指数退避重连（上限 5 次 / 8 秒）。用尽后才把中断如实写进终端，不静默假死。 */
  async function reconnectStream(sessionId, tab, attempt, reason) {
    if (tab.exited || tab.streamCtl.signal.aborted) return;
    if (attempt >= 5) {
      tab.term?.write(`\r\n\x1b[31m[连接中断：${String(reason ?? "未知").replace(/[\r\n]+/g, " ")}；请关闭该标签后重开]\x1b[0m\r\n`);
      return;
    }
    const delay = Math.min(8000, 400 * 2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (tab.exited || tab.streamCtl.signal.aborted) return;
    void fetchStream(sessionId, tab, { attempt: attempt + 1 });
  }

  function markTabExited(tab) {
    tab.tabEl?.classList.add("is-exited");
    tab.term?.write("\r\n\x1b[2m[进程已退出]\x1b[0m\r\n");
  }

  function activateTab(id) {
    // 先按 DOM 全量清一遍 is-active：只遍历 tabs 会漏掉"已从 Map 移除但 DOM 还在"的孤儿面板，
    // 那些孤儿会一直保留 is-active 而与当前面板同时可见（LO 2026-08-08：同一份首屏并排出现很多条）。
    for (const pane of root.querySelectorAll(".terminal-pane")) pane.classList.remove("is-active");
    for (const [tabId, tab] of tabs) {
      const active = tabId === id;
      tab.tabEl?.classList.toggle("is-active", active);
      tab.paneEl?.classList.toggle("is-active", active);
      if (active) {
        requestAnimationFrame(() => {
          tab.fit.fit();
          // 从隐藏态切回可见时 xterm 不会自己补画，必须显式 refresh，否则是一片空白
          try { tab.term.refresh(0, Math.max(0, tab.term.rows - 1)); } catch { /* 尺寸未就绪 */ }
          tab.term.focus();
        });
      }
    }
    root.querySelector(".terminal-new-input")?.classList.add("is-hidden");
  }

  async function closeTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    tab.streamCtl.abort();
    tab.observer?.disconnect();
    try {
      await request(`/api/pty/${id}`, { method: "DELETE" });
    } catch { /* 已死 */ }
    disposeTab(tab); // 与重复挂载走同一条释放路径，避免两处清理逻辑各漏一半
    tabs.delete(id);
    const remaining = [...tabs.keys()];
    if (remaining.length) activateTab(remaining[remaining.length - 1]);
    else renderTabStrip();
  }

  /** 给既有/新建 session 挂 DOM + xterm + 流（spawn 与恢复共用）。 */
  /** 释放一个 tab 的流、观察者与 xterm 实例（重复挂载与关闭共用，避免残留订阅重放缓冲）。 */
  function disposeTab(tab) {
    if (!tab) return;
    tab.streamCtl.abort();
    tab.observer?.disconnect();
    window.clearTimeout(tab.resizeTimer); // 去抖中的 resize 不能打到已释放的会话上
    try { tab.term.dispose(); } catch { /* 已释放 */ }
    tab.paneEl?.remove();
    tab.tabEl?.remove();
  }

  function attachSession(session) {
    // 幂等：同一 session 被重复 attach 时先拆旧的。每条 SSE 连接都会重放整个环形缓冲，
    // 残留订阅会把同一份首屏一遍遍写进终端（LO 2026-08-08：打开终端看到很多条重复）。
    const existing = tabs.get(session.id);
    if (existing) {
      disposeTab(existing);
      tabs.delete(session.id);
    }
    const panesRoot = root.querySelector(".terminal-panes");
    const paneEl = document.createElement("div");
    // xterm 硬性约束：open() 必须在元素可见时调用，否则渲染器按 0 尺寸初始化，
    // 之后 write() 的内容不会被绘出来——表现就是"终端里打不出字"。
    // .terminal-pane 默认 display:none，所以这里先让新面板可见（其余面板由 activateTab 统一收敛）。
    paneEl.className = "terminal-pane";
    for (const other of root.querySelectorAll(".terminal-pane")) other.classList.remove("is-active");
    paneEl.classList.add("is-active");
    panesRoot.appendChild(paneEl);

    const tokens = themeTokens();
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: tokens.fontFamily,
      theme: tokens,
      scrollback: 2000,
      convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(paneEl);
    const tab = {
      id: session.id,
      session,
      term,
      fit,
      paneEl,
      tabEl: null,
      streamCtl: new AbortController(),
      exited: Boolean(session.exited),
      resizeTimer: 0,
      lastSize: `${session.cols ?? 0}x${session.rows ?? 0}`, // 与服务端已知尺寸对齐，首帧不做无谓上报
    };
    tabs.set(session.id, tab);

    // 输入失败绝不静默：用户看到的表象是"终端打不出字"，必须把真实原因打进终端。
    // 只在由通到断的那一次提示，避免每个按键刷一行。
    term.onData((data) => {
      if (tab.exited) return;
      void request(`/api/pty/${session.id}/input`, { method: "POST", body: JSON.stringify({ data }) })
        .then(() => { tab.inputBroken = false; })
        .catch((error) => {
          if (tab.inputBroken) return;
          tab.inputBroken = true;
          tab.term.write(`\r\n\x1b[31m[输入未送达：${String(error?.message ?? "未知错误").replace(/[\r\n]+/g, " ")}]\x1b[0m\r\n`);
        });
    });
    // 点击面板任意处都聚焦：xterm 只在自己的画布上自动聚焦，点到内边距会打不进字
    paneEl.addEventListener("mousedown", () => term.focus());
    // ConPTY 每收到一次 resize 就让 shell 重绘整屏（oh-my-posh 提示符尤其明显）。
    // 拖动外框时 ResizeObserver 逐帧触发，逐帧上报会把几十份重绘追加进滚动缓冲——
    // 表现就是"反复拉伸终端会出现重复显示"（LO 2026-08-08）。
    // 因此：fit 立即执行保证视觉跟手，上报去抖到静止后一次，且尺寸没变就完全不打扰 ConPTY。
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        return; // 隐藏态 fit 失败可忽略
      }
      window.clearTimeout(tab.resizeTimer);
      tab.resizeTimer = window.setTimeout(() => {
        const size = `${term.cols}x${term.rows}`;
        if (size === tab.lastSize) return;
        tab.lastSize = size;
        // 尺寸同步失败不阻断可用性；真正的会话级故障由 input 与 stream 两条路径报出
        void request(`/api/pty/${session.id}/resize`, { method: "POST", body: { cols: term.cols, rows: term.rows } }).catch(() => {});
      }, 140);
    });
    observer.observe(paneEl);
    tab.observer = observer;

    void fetchStream(session.id, tab);
    renderTabStrip();
    activateTab(session.id);
  }

  async function spawnTab(shell = "") {
    const payload = shell ? { shell } : {};
    const { session } = await request("/api/pty", { method: "POST", body: JSON.stringify(payload) });
    attachSession(session);
  }

  function renderTabStrip() {
    const strip = root.querySelector(".terminal-tabs");
    if (!strip) return;
    strip.innerHTML = "";
    for (const [id, tab] of tabs) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `terminal-tab${tab.exited ? " is-exited" : ""}`;
      item.innerHTML = `${lucideIcon("square-terminal", "icon lucide")}<span>${escapeHtml(tab.session.title ?? tab.session.shell.split(/[\\/]/).pop())} · ${id}</span>`;
      item.addEventListener("click", () => activateTab(id));
      const close = document.createElement("span");
      close.className = "terminal-tab-close";
      close.innerHTML = lucideIcon("x", "icon lucide");
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        void closeTab(id);
      });
      item.appendChild(close);
      tab.tabEl = item;
      strip.appendChild(item);
    }
    const add = document.createElement("button");
    add.type = "button";
    add.className = "terminal-tab terminal-tab-add";
    add.innerHTML = `${lucideIcon("plus", "icon lucide")}<span>新建</span>`;
    add.addEventListener("click", () => void spawnTab());
    strip.appendChild(add);
  }

  let mounting = null;

  /** 并发/重复挂载保护：抽屉展开、重试按钮、宿主自举都可能触发 mount，
      不串行化就会各自 spawn 一个 pwsh 并各自重放缓冲。 */
  function mount() {
    if (mounting) return mounting;
    mounting = mountOnce().finally(() => { mounting = null; });
    return mounting;
  }

  async function mountOnce() {
    // 首个请求必须等 token 自举完成（api.js:62 的 401 竞态）。底部终端抽屉会在启动时
    // 恢复上次的打开态并立刻 mount，这条 await 是它不被渲染成「终端服务异常」的唯一保证。
    await apiReady;
    // 重挂载前清干净：innerHTML 会换掉 DOM，但旧 tab 的 SSE 订阅与 xterm 实例不会自己消失
    for (const tab of tabs.values()) disposeTab(tab);
    tabs.clear();
    let sessions = [];
    try {
      const payload = await request("/api/pty");
      sessions = payload?.sessions ?? [];
    } catch (error) {
      if (error?.status === 501 || /REMOTE_GATE/.test(error?.message || "")) {
        gateCard(root, "pty", error.message);
        return;
      }
      // 带重试入口：竞态类故障重试即恢复，真实故障则由 message 指认，不让用户只看到一句空泛的异常
      root.innerHTML = `<div class="forge-empty-waveg">${lucideIcon("triangle-alert", "icon lucide icon-lg")}<h2>终端服务异常</h2><p class="subtle">${escapeHtml(String(error?.message ?? "未知错误"))}</p><button class="button secondary" type="button" data-terminal-retry>重试</button></div>`;
      root.querySelector("[data-terminal-retry]")?.addEventListener("click", () => void mount(), { once: true });
      return;
    }
    root.innerHTML = `
      <div class="terminal-shell">
        <div class="terminal-tabs" role="tablist" aria-label="终端会话"></div>
        <div class="terminal-panes"></div>
      </div>`;
    renderTabStrip();
    const live = sessions.filter((session) => !session.exited);
    if (live.length === 0) {
      await spawnTab();
    } else {
      for (const session of live) attachSession(session);
    }
  }

  /** 抽屉展开后由宿主调用：xterm 在隐藏容器里 focus 无效，必须等可见再聚焦。 */
  function focusActive() {
    const active = [...tabs.values()].find((tab) => tab.paneEl?.classList.contains("is-active")) ?? [...tabs.values()].at(-1);
    if (!active) return;
    requestAnimationFrame(() => {
      try {
        active.fit.fit();
        active.term.focus();
      } catch { /* 尺寸未就绪时忽略，下一次展开会再试 */ }
    });
  }

  // 迟到会话接入（「新会话 → 远程」创建的 SSH 终端）：面板已挂载就直接 attach 新页签；
  // 未挂载/门闸卡则忽略——mountOnce 本来就会全量列会话。attachSession 幂等，重复事件安全。
  window.addEventListener("forge:pty-session-created", (event) => {
    const session = event.detail?.session;
    if (!session?.id) return;
    if (!root.querySelector(".terminal-panes")) return;
    attachSession(session);
  });

  return { mount, root, focusActive };
}

function bootWhenReady() {
  if (typeof document === "undefined") return;
  const start = () => {
    const root = document.getElementById("terminal-container");
    if (!root) return;
    // 终端视图必须等真正可见才挂载。此前是页面一加载就 mount：用户从没打开过终端视图，
    // 也会白起一个 pwsh（还要加载 profile 一秒多），并且底部抽屉随后会 attach 同一会话，
    // 于是同一个 PTY 上挂了两条 SSE、各重放一次缓冲——就是「打开终端有很多条」的来源。
    // 协作台底部抽屉由 workbench-chrome.js 自己懒挂载，两边都不提前占 PTY 会话。
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void apiReady.then(() => createTerminalPanel(root).mount());
    });
    observer.observe(root);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

bootWhenReady();
