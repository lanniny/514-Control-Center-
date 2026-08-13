/**
 * splitter.js — Wave G 可拖分栏（codeg 面板拖柄的 vanilla 等价，pointer 捕获 + 像素轨）。
 *
 * 契约：
 *   - 只走 CSSOM setProperty（CSP style-src 'self' 下安全，xterm 同路径已验证）
 *   - 宽度持久化 localStorage；双击复位；键盘 ←/→ 步进 16px（role=separator）
 *   - 拖动中给 <html> 挂 .forge-splitting（关选择 + 统一 col-resize 光标）
 *   - reduced-motion 不影响（无动画）；移动端窄屏（容器 < 720px）自动禁用
 */

const HANDLE_CLASS = "forge-splitter-handle";

function parseColumns(container) {
  // 读三栏 grid 的左右像素轨；读不到就用渲染宽兜底
  const template = getComputedStyle(container).gridTemplateColumns.split(" ");
  const first = Number.parseFloat(template[0]);
  const last = Number.parseFloat(template.at(-1));
  const rect = container.getBoundingClientRect();
  return {
    left: Number.isFinite(first) ? first : 248,
    right: Number.isFinite(last) ? last : 292,
    total: rect.width,
  };
}

export function attachSplitter(container, options = {}) {
  const {
    side = "left", // 拖柄控制哪条轨：left=第一轨，right=末轨
    storageKey = "",
    min = 180,
    max = 520,
    defaultWidth = null,
  } = options;
  if (!container || container.dataset[`splitter${side}`]) return null;
  container.dataset[`splitter${side}`] = "1";

  const saved = storageKey ? Number.parseFloat(localStorage.getItem(storageKey) || "") : NaN;
  const initial = Number.isFinite(saved) ? saved : (defaultWidth ?? parseColumns(container)[side]);

  const handle = document.createElement("div");
  handle.className = `${HANDLE_CLASS} is-${side}`;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.tabIndex = 0;

  // 插到对应栏后：left 轨把手放第一个孩子后，right 轨放最后一个孩子前
  if (side === "left") container.firstElementChild?.after(handle);
  else container.lastElementChild?.before(handle);

  const apply = (width) => {
    const clamped = Math.min(max, Math.max(min, Math.round(width)));
    const { left, right } = parseColumns(container);
    const next = side === "left"
      ? `${clamped}px minmax(0, 1fr) ${right}px`
      : `${left}px minmax(0, 1fr) ${clamped}px`;
    container.style.setProperty("grid-template-columns", next);
    container.style.setProperty(`--forge-split-${side}`, `${clamped}px`);
    handle.dataset.width = String(clamped);
    return clamped;
  };

  const persist = () => {
    if (!storageKey) return;
    const width = Number.parseFloat(handle.dataset.width || "");
    if (Number.isFinite(width)) localStorage.setItem(storageKey, String(width));
  };

  const reset = () => {
    const width = apply(defaultWidth ?? parseColumns(container)[side]);
    if (storageKey) localStorage.removeItem(storageKey);
    return width;
  };

  handle.addEventListener("pointerdown", (event) => {
    if (container.getBoundingClientRect().width < 720) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    document.documentElement.classList.add("forge-splitting");
    const startX = event.clientX;
    const startWidth = parseColumns(container)[side];
    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      apply(side === "left" ? startWidth + delta : startWidth - delta);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      document.documentElement.classList.remove("forge-splitting");
      persist();
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });

  handle.addEventListener("dblclick", () => reset());

  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = parseColumns(container)[side];
    const step = event.key === "ArrowLeft" ? -16 : 16;
    apply(current + (side === "left" ? step : -step));
    persist();
  });

  // 初始：仅有持久化值时应用（否则尊重 CSS 默认轨）
  if (Number.isFinite(saved)) apply(saved);
  return { handle, apply, reset };
}

/* —— 自举：协作台三栏左右缝（与其它 panel 的 bootWhenReady 同惯例）—— */
function bootSplitters() {
  if (typeof document === "undefined") return;
  const start = () => {
    const shell = document.querySelector(".workbench-shell");
    if (!shell) return;
    attachSplitter(shell, { side: "left", storageKey: "514cc-split-left", min: 180, max: 420, defaultWidth: 248 });
    attachSplitter(shell, { side: "right", storageKey: "514cc-split-right", min: 220, max: 480, defaultWidth: 292 });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

bootSplitters();
