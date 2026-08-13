/**
 * workbench-chrome.js — 布局模仿波（2026-07-26）：协作台 chrome 三件套。
 *
 * 对齐 codeg / LiveAgent 的工作区 DNA：
 *   ① 底部终端抽屉（2026-08-08 图4）——不设常驻条，默认隐藏，由右上角角位开关 /
 *      Ctrl+` / 右栏工具菜单打开后懒挂载，与终端视图共享 PTY 台账（createTerminalPanel
 *      工厂实例，stream 订阅制双挂安全）；关闭只隐藏，不销毁会话
 *   ② Mission Control 右栏折叠（codeg aux-panel / LiveAgent RightDock）——收起成
 *      34px 细条，展开恢复拖前宽度；右 splitter 折叠期自动失效
 *   ③ run-rail 分组折叠（两家共同的侧栏特征）——chevron 注入各 rail-block 头，
 *      折叠状态 localStorage 记忆（已归档块自带原生 toggle，不动）
 *   ⑤ 会话流 chrome（2026-08-02 布局对照波）——回到底部 sticky 浮钮 +
 *      超长用户消息折叠（codeg collapsible-user-message 同款）+
 *      消息行 hover 复制钮（codeg hover copy / LiveAgent RowActions 同款）
 *
 * 契约：零 emoji；lucide sprite 引用；只走 CSSOM setProperty（CSP 安全路径）；
 *      键盘可达（grip ↑/↓ 步进、Ctrl+` 切终端抽屉）；容器不存在时静默跳过。
 */

import { createTerminalPanel } from "./terminal-panel.js";

/* ── ① 底部终端抽屉（2026-08-08 图4：左图标开下侧终端）───────

   与上一版的区别：不再有常驻折叠条——抽屉默认隐藏，只由右上角角位开关、
   Ctrl+\` 或右栏工具菜单的「终端」打开，关闭走抽屉右上角的 ×。
   PTY 实例懒挂载且不随关闭销毁，与终端视图共享同一台账。 */

const TERM_KEYS = { open: "514cc-wb-term-open", height: "514cc-wb-term-height" };
const TERM_DEFAULT_HEIGHT = 240;
const TERM_MIN = 140;

function bootTerminalDrawer() {
  const drawer = document.getElementById("terminal-drawer");
  const body = document.getElementById("workbench-terminal-container");
  const grip = document.getElementById("terminal-drawer-grip");
  const closeButton = document.getElementById("terminal-drawer-close");
  if (!drawer || !body || !grip) return;

  const globalToggle = document.getElementById("global-terminal-toggle");
  const pane = drawer.closest(".conversation-pane");

  const maxHeight = () => {
    const rect = pane?.getBoundingClientRect();
    return Math.max(TERM_MIN, Math.round((rect?.height ?? 640) * 0.6));
  };
  const clampHeight = (px) => Math.min(maxHeight(), Math.max(TERM_MIN, Math.round(px)));
  const applyHeight = (px, { persist = false } = {}) => {
    const clamped = clampHeight(px);
    body.style.setProperty("height", `${clamped}px`);
    grip.dataset.height = String(clamped);
    if (persist) localStorage.setItem(TERM_KEYS.height, String(clamped));
    return clamped;
  };

  const isOpen = () => !drawer.hidden;

  function syncGlobalToggle() {
    if (!globalToggle) return;
    globalToggle.setAttribute("aria-pressed", String(isOpen()));
    globalToggle.classList.toggle("is-active", isOpen());
  }

  let panel = null;

  function setOpen(open, { persist = true } = {}) {
    drawer.hidden = !open;
    if (open && !panel) {
      // 懒挂载：没打开过就不提前占 PTY 会话；ResizeObserver 会在可见时自动 fit
      panel = createTerminalPanel(body);
      void panel.mount().then(() => panel?.focusActive?.());
    } else if (open) {
      // 重新展开：xterm 在隐藏容器里的焦点会丢，不重新聚焦用户就得先点一下才能打字
      panel.focusActive?.();
    }
    if (persist) localStorage.setItem(TERM_KEYS.open, open ? "1" : "0");
    syncGlobalToggle();
  }

  const savedHeight = Number.parseFloat(localStorage.getItem(TERM_KEYS.height) || "");
  applyHeight(Number.isFinite(savedHeight) ? savedHeight : TERM_DEFAULT_HEIGHT);
  setOpen(localStorage.getItem(TERM_KEYS.open) === "1", { persist: false });

  closeButton?.addEventListener("click", () => setOpen(false));

  // 角位开关是终端的常驻入口：非协作台时先切回协作台
  globalToggle?.addEventListener("click", () => {
    if (!drawer.closest(".view")?.classList.contains("is-active")) {
      document.querySelector('.topbar-nav [data-view="workbench"]')?.click();
    }
    setOpen(!isOpen());
  });

  grip.addEventListener("pointerdown", (event) => {
    if (!isOpen()) return;
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    document.documentElement.classList.add("forge-splitting");
    const startY = event.clientY;
    const startHeight = Number.parseFloat(grip.dataset.height || "") || TERM_DEFAULT_HEIGHT;
    const onMove = (moveEvent) => applyHeight(startHeight + (startY - moveEvent.clientY));
    const onUp = () => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onUp);
      document.documentElement.classList.remove("forge-splitting");
      localStorage.setItem(TERM_KEYS.height, grip.dataset.height || String(TERM_DEFAULT_HEIGHT));
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onUp);
  });

  grip.addEventListener("dblclick", () => {
    localStorage.removeItem(TERM_KEYS.height);
    applyHeight(TERM_DEFAULT_HEIGHT);
  });

  grip.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const current = Number.parseFloat(grip.dataset.height || "") || TERM_DEFAULT_HEIGHT;
    applyHeight(current + (event.key === "ArrowUp" ? 16 : -16), { persist: true });
  });

  // Ctrl+\` 切换（codeg toggle_terminal 等价）；与 Ctrl+K 面板无冲突
  document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || event.shiftKey || event.altKey || event.key !== "\`") return;
    if (!drawer.closest(".view")?.classList.contains("is-active")) return;
    event.preventDefault();
    setOpen(!isOpen());
  });
}

/* ── ② Mission Control 右栏折叠 ──────────────────────── */

const MC_KEYS = { collapsed: "514cc-mc-collapsed-v2" };

function bootMissionControlCollapse() {
  const shell = document.querySelector(".workbench-shell");
  const rail = document.getElementById("mission-control-dock");
  if (!shell || !rail) return;

  // 折叠态细条：纵向图标钮（注入一次，CSS 只在 .mc-collapsed 下显示）
  const strip = document.createElement("button");
  strip.type = "button";
  strip.className = "mc-expand-strip";
  strip.title = "展开 Mission Control";
  strip.setAttribute("aria-label", "展开 Mission Control");
  strip.innerHTML = '<svg class="icon lucide" aria-hidden="true"><use href="#lucide-panel-right"></use></svg>';
  rail.prepend(strip);

  // 折叠钮：注入 registry-dock-header 末尾
  const collapseButton = document.createElement("button");
  collapseButton.type = "button";
  collapseButton.className = "icon-button mc-collapse-button";
  collapseButton.title = "折叠 Mission Control";
  collapseButton.setAttribute("aria-label", "折叠 Mission Control");
  collapseButton.innerHTML = '<svg class="icon lucide" aria-hidden="true"><use href="#lucide-panel-right"></use></svg>';
  // 折叠钮挂 rail 标签条的动作区：registry-dock-header 已迁入「任务上下文」工具页内部，
  // 挂在那里会随标签切换消失，折叠入口必须常驻。
  rail.querySelector(".rail-tabbar-actions")?.appendChild(collapseButton);

  // 右上角全局开关同步器（函数声明提升，setCollapsed 出口统一调用）
  const globalMcToggle = document.getElementById("global-mc-toggle");
  function syncGlobalMcToggle() {
    if (!globalMcToggle) return;
    const open = !shell.classList.contains("mc-collapsed");
    globalMcToggle.setAttribute("aria-pressed", String(open));
    globalMcToggle.classList.toggle("is-active", open);
  }

  const setCollapsed = (collapsed, { persist = true } = {}) => {
    shell.classList.toggle("mc-collapsed", collapsed);
    rail.inert = collapsed;
    rail.setAttribute("aria-hidden", String(collapsed));
    rail.setAttribute("aria-busy", "false");
    if (persist) localStorage.setItem(MC_KEYS.collapsed, collapsed ? "1" : "0");
    syncGlobalMcToggle();
  };

  collapseButton.addEventListener("click", () => setCollapsed(true));
  strip.addEventListener("click", () => setCollapsed(false));

  // 右上角角位开关：非协作台时先切回协作台（MC 是协作台右栏）
  globalMcToggle?.addEventListener("click", () => {
    const workbenchActive = shell.closest(".view")?.classList.contains("is-active");
    if (!workbenchActive) {
      document.querySelector('.topbar-nav [data-view="workbench"]')?.click();
    }
    setCollapsed(!shell.classList.contains("mc-collapsed"));
  });

  setCollapsed(localStorage.getItem(MC_KEYS.collapsed) !== "0", { persist: false });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || shell.classList.contains("mc-collapsed")) return;
    if (document.querySelector("dialog[open], .cmd-palette-overlay.is-open, .app-shell.nav-open")) return;
    event.preventDefault();
    setCollapsed(true);
  });
}

/* ── ③ run-rail 分组折叠 ─────────────────────────────── */

const RAIL_GROUPS_KEY = "514cc-rail-groups";
const RAIL_GROUPS = [
  { selector: ".rail-block-team", key: "team", label: "团队" },
  { selector: "#rail-pinned", key: "pinned", label: "置顶" },
  { selector: ".rail-block-runs", key: "runs", label: "会话" },
  { selector: "#rail-working", key: "working", label: "正在工作" },
  { selector: "#rail-automations", key: "automations", label: "自动化" },
];

function loadRailGroupState() {
  try {
    return JSON.parse(localStorage.getItem(RAIL_GROUPS_KEY) || "{}") ?? {};
  } catch {
    return {};
  }
}

function bootRailGroupCollapse() {
  const state = loadRailGroupState();
  for (const group of RAIL_GROUPS) {
    const block = document.querySelector(group.selector);
    const heading = block?.querySelector(":scope > .pane-heading");
    if (!block || !heading) continue;

    const chevron = document.createElement("button");
    chevron.type = "button";
    chevron.className = "rail-group-chevron";
    chevron.title = `折叠/展开「${group.label}」`;
    chevron.setAttribute("aria-label", `折叠/展开「${group.label}」分组`);
    chevron.innerHTML = '<svg class="icon lucide" aria-hidden="true"><use href="#lucide-chevron-down"></use></svg>';
    heading.prepend(chevron);

    const apply = (collapsed) => {
      block.classList.toggle("is-group-collapsed", collapsed);
      chevron.setAttribute("aria-expanded", String(!collapsed));
    };
    apply(state[group.key] === true);

    chevron.addEventListener("click", (event) => {
      event.stopPropagation();
      const collapsed = !block.classList.contains("is-group-collapsed");
      apply(collapsed);
      state[group.key] = collapsed;
      localStorage.setItem(RAIL_GROUPS_KEY, JSON.stringify(state));
    });
  }
}

/* ── ④ 团队筛选行折叠（工程逻辑波 2026-07-26）─────────────
   团队 pane-heading 曾一行挤 4 toggle + 设置 + 计数共 7 控件；4 个筛选 toggle
   收进独立 .rail-filters 行，由标题行 list-filter 钮开合，状态 localStorage 记忆 */

const RAIL_FILTERS_KEY = "514cc-rail-filters-open";

function bootRailFilters() {
  const toggle = document.getElementById("rail-filters-toggle");
  const panel = document.getElementById("team-rail-filters");
  if (!toggle || !panel) return;

  // 任一筛选处于非默认态时，按钮常驻高亮——折叠后也能看出列表被过滤过
  const defaults = { "recent-only-toggle": true, "project-summaries-toggle": false, "subagents-toggle": false, "show-hidden-toggle": false };
  const inputs = Object.keys(defaults)
    .map((id) => document.getElementById(id))
    .filter((el) => el instanceof HTMLInputElement);
  const syncActive = () => {
    const dirty = inputs.some((el) => el.checked !== defaults[el.id]);
    toggle.classList.toggle("is-active", dirty);
  };
  for (const el of inputs) el.addEventListener("change", syncActive);
  syncActive();
  // app.js 的 init*Toggle 在各自 DOMContentLoaded 里从 sessionStorage 回填 checked，
  // 注册顺序不保证先于本模块——延迟对账一次，避免初始高亮态竞态
  setTimeout(syncActive, 600);

  const setOpen = (open, { persist = true } = {}) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (persist) localStorage.setItem(RAIL_FILTERS_KEY, open ? "1" : "0");
  };
  setOpen(localStorage.getItem(RAIL_FILTERS_KEY) === "1", { persist: false });
  toggle.addEventListener("click", () => setOpen(panel.hidden));
}

/* ── ⑤ 会话流 chrome（布局对照波 2026-08-02）─────────────
   对齐 LiveAgent ChatTranscript / codeg message-thread 的会话流特征：
   ⑤a 回到底部浮钮——sticky 哨兵挂在滚动内容末尾（height:0，不撑排版），
      脱底超过阈值浮出圆形 ↓ 钮，点击平滑回底；渲染器 innerHTML 重排后由
      MutationObserver 自动挂回。app.js 的滚动保持逻辑（capture/restore）
      不动，本钮只补"翻上去后回不来"的可达性缺口。
   ⑤b 超长用户消息折叠（codeg collapsible-user-message）——气泡正文超过
      CLAMP_LIMIT 才钳高 + 底部渐隐遮罩 + 展开/收起钮；短消息零侵入。
   ⑤c 消息行 hover 复制钮（codeg hover copy / LiveAgent RowActions）——行右上角
      浮动复制钮，hover/focus-within 才显；复制渲染后正文，成功换 check 1.2s。 */

const JUMP_THRESHOLD = 160;
const CLAMP_LIMIT = 240;

async function copyRowText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 降级：非安全上下文 / 权限拒绝时走 execCommand
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.setProperty("position", "fixed");
    area.style.setProperty("opacity", "0");
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

function bootStreamChrome() {
  const stream = document.getElementById("conversation-stream");
  if (!stream) return;

  // ⑤a 回到底部浮钮
  const sentinel = document.createElement("div");
  sentinel.className = "jump-to-latest";
  sentinel.hidden = true;
  const jumpButton = document.createElement("button");
  jumpButton.type = "button";
  jumpButton.className = "jump-to-latest-button";
  jumpButton.title = "回到底部";
  jumpButton.setAttribute("aria-label", "回到底部");
  jumpButton.innerHTML = '<svg class="icon lucide" aria-hidden="true"><use href="#lucide-arrow-down"></use></svg>';
  sentinel.appendChild(jumpButton);
  stream.appendChild(sentinel);

  const distanceFromBottom = () => stream.scrollHeight - stream.scrollTop - stream.clientHeight;
  const syncJump = () => { sentinel.hidden = distanceFromBottom() < JUMP_THRESHOLD; };
  jumpButton.addEventListener("click", () => {
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    stream.scrollTo({ top: stream.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  });
  stream.addEventListener("scroll", syncJump, { passive: true });

  // ⑤b 超长用户消息折叠：一次性判定，处理过打 data 标记；重渲染产生的新节点自然未标记
  const processUserBodies = () => {
    stream.querySelectorAll(".message-row.is-user .message-body:not([data-clamp-checked])").forEach((body) => {
      body.dataset.clampChecked = "1";
      if (body.scrollHeight <= CLAMP_LIMIT) return;
      body.classList.add("is-clamped");
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "text-button msg-expand-toggle";
      toggle.textContent = "展开全文";
      toggle.setAttribute("aria-expanded", "false");
      body.insertAdjacentElement("afterend", toggle);
    });
  };
  // ⑤c 消息行 hover 复制钮：一次性注入，处理过打 data 标记
  const processRowActions = () => {
    stream.querySelectorAll(".message-row:not([data-actions-checked])").forEach((row) => {
      row.dataset.actionsChecked = "1";
      if (!row.querySelector(".message-body")) return;
      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "msg-row-copy";
      copyButton.title = "复制消息";
      copyButton.setAttribute("aria-label", "复制消息");
      copyButton.innerHTML = '<svg class="icon lucide" aria-hidden="true"><use href="#lucide-copy"></use></svg>';
      row.appendChild(copyButton);
    });
  };
  stream.addEventListener("click", (event) => {
    const copyButton = event.target.closest(".msg-row-copy");
    if (copyButton) {
      const body = copyButton.closest(".message-row")?.querySelector(".message-body");
      const text = body?.innerText?.trim() ?? "";
      if (!text) return;
      void copyRowText(text).then((ok) => {
        if (!ok) return;
        copyButton.classList.add("is-copied");
        copyButton.innerHTML = '<svg class="icon lucide" aria-hidden="true"><use href="#lucide-check"></use></svg>';
        setTimeout(() => {
          copyButton.classList.remove("is-copied");
          copyButton.innerHTML = '<svg class="icon lucide" aria-hidden="true"><use href="#lucide-copy"></use></svg>';
        }, 1200);
      });
      return;
    }
    const toggle = event.target.closest(".msg-expand-toggle");
    if (!toggle) return;
    const body = toggle.previousElementSibling;
    if (!(body instanceof HTMLElement)) return;
    const clamped = body.classList.toggle("is-clamped");
    toggle.textContent = clamped ? "展开全文" : "收起";
    toggle.setAttribute("aria-expanded", String(!clamped));
  });

  // 渲染器 replaceConversationStream 走 innerHTML 全量替换：哨兵会被抹掉、
  // 新消息体未处理——统一在 childList 变更后对账（处理过/已挂载的节点自动跳过，不会死循环）
  const observer = new MutationObserver(() => {
    if (sentinel.parentNode !== stream) stream.appendChild(sentinel);
    processUserBodies();
    processRowActions();
    syncJump();
  });
  observer.observe(stream, { childList: true });
  processUserBodies();
  processRowActions();
  syncJump();
}

/* ── 自举 ────────────────────────────────────────────── */

function boot() {
  if (typeof document === "undefined") return;
  const start = () => {
    bootTerminalDrawer();
    bootMissionControlCollapse();
    bootRailGroupCollapse();
    bootRailFilters();
    bootStreamChrome();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

boot();
