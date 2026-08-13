/**
 * rich-render.js v2 — 富内容本地后处理器（CSP-safe，零 CDN，零依赖）
 *
 * v1 曾从 jsdelivr 懒加载 marked/KaTeX/Mermaid/highlight.js——在 server CSP
 * `script-src 'self'` 下必然失败，已整体移除。KaTeX/Mermaid 实时渲染待 vendored
 * 库落地后再启；本版把 mermaid/math 代码块升级为带类型徽标的精致源码块。
 *
 * 职责：在 renderMarkdown（markdown.js）产出的 DOM 上做幂等升级——
 *   1. 代码块加头部条（语言徽标 + Lucide 复制钮，copied→check 反馈，clipboard 带降级）
 *   2. 超过 16 行的代码块折叠为 max-h + 底部渐隐遮罩 + “展开 N 行”开关
 *   3. mermaid / math fence 加类型徽标（workflow / type 图标）与源码美化处理
 *   4. 外链追加 arrow-up-right 图标提示
 *   5. 未包裹的 table 补卡片式滚动容器
 *
 * 幂等：处理过的节点打 data-rich-* 标记，重复调用安全。所有挂载点均 null-guard。
 *
 * 用法：
 *   import { renderRichContent } from "./rich-render.js";
 *   renderRichContent(messageStreamEl); // 渲染完成后调用，可反复调用
 */

import { lucideIcon } from "./lucide.js";

const COLLAPSE_LINE_THRESHOLD = 16;
const MATH_LANGS = new Set(["math", "latex", "katex", "tex"]);

function icon(name, className = "icon lucide") {
  try {
    return lucideIcon(name, className);
  } catch {
    return ""; // lucide 不可用时不阻塞内容呈现
  }
}

/** 复制到剪贴板：navigator.clipboard 优先，execCommand 兜底。返回是否成功。 */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落入降级路径（非安全上下文 / 权限拒绝）
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = "rich-copy-proxy"; // CSP：样式走 class（见 markdown.css），不用 cssText
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function bindCopyButton(button, codeEl) {
  const resetDelay = 1500;
  let timer = 0;
  button.addEventListener("click", async () => {
    const text = codeEl?.textContent ?? "";
    const ok = await copyText(text);
    window.clearTimeout(timer);
    button.classList.toggle("is-copied", ok);
    button.classList.toggle("is-failed", !ok);
    button.innerHTML = icon(ok ? "check" : "x");
    button.setAttribute("aria-label", ok ? "已复制" : "复制失败");
    timer = window.setTimeout(() => {
      button.classList.remove("is-copied", "is-failed");
      button.innerHTML = icon("copy");
      button.setAttribute("aria-label", "复制代码");
    }, resetDelay);
  });
}

/** 代码块头部条 + 类型徽标 + 折叠。幂等：已处理节点带 data-rich-code。 */
function upgradeCodeBlocks(rootEl) {
  rootEl.querySelectorAll(".code-wrap:not([data-rich-code])").forEach((wrap) => {
    wrap.setAttribute("data-rich-code", "1");
    const pre = wrap.querySelector("pre");
    const codeEl = pre?.querySelector("code") || pre;
    if (!pre || !codeEl) return;

    const lang = String(pre.getAttribute("data-lang") || "").trim().toLowerCase();
    const isMermaid = lang === "mermaid";
    const isMath = MATH_LANGS.has(lang);
    const badgeIcon = isMermaid ? "workflow" : isMath ? "type" : "terminal";
    const badgeLabel = isMermaid ? "Mermaid" : isMath ? "LaTeX" : (lang || "code");

    wrap.classList.add("rich-code");
    if (isMermaid) wrap.classList.add("is-mermaid");
    if (isMath) wrap.classList.add("is-math");

    // v1 的文字复制钮（app.js 委托 [data-copy-code]）由头部条接管，避免双份 UI
    wrap.querySelector(".code-copy")?.remove();

    const header = document.createElement("div");
    header.className = "rich-code-header";
    header.innerHTML = `<span class="rich-code-badge">${icon(badgeIcon)}<span>${badgeLabel}</span></span>`;
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "rich-copy-btn";
    copyButton.setAttribute("aria-label", "复制代码");
    copyButton.innerHTML = icon("copy");
    header.appendChild(copyButton);
    wrap.insertBefore(header, pre);
    bindCopyButton(copyButton, codeEl);

    // 长块折叠：超过阈值行数时收起到 max-h + 渐隐遮罩 + 展开开关
    const lineCount = (codeEl.textContent || "").replace(/\n$/, "").split("\n").length;
    if (lineCount > COLLAPSE_LINE_THRESHOLD) {
      wrap.classList.add("is-collapsed");
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "rich-expand-btn";
      const label = () => `${icon("chevron-down")}<span>${wrap.classList.contains("is-expanded") ? "收起" : `展开 ${lineCount} 行`}</span>`;
      toggle.innerHTML = label();
      toggle.setAttribute("aria-expanded", "false");
      toggle.addEventListener("click", () => {
        const expanded = wrap.classList.toggle("is-expanded");
        toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
        toggle.innerHTML = label();
      });
      wrap.appendChild(toggle);
    }
  });
}

/** 外链追加箭头图标提示。幂等：data-rich-link。 */
function upgradeExternalLinks(rootEl) {
  rootEl.querySelectorAll('a[target="_blank"]:not([data-rich-link])').forEach((anchor) => {
    anchor.setAttribute("data-rich-link", "1");
    anchor.insertAdjacentHTML("beforeend", `<span class="rich-link-icon" aria-hidden="true">${icon("arrow-up-right")}</span>`);
  });
}

/** 未包裹的 table 补圆角边框滚动容器。幂等：data-rich-table。 */
function upgradeTables(rootEl) {
  rootEl.querySelectorAll("table:not([data-rich-table])").forEach((table) => {
    table.setAttribute("data-rich-table", "1");
    const parent = table.parentElement;
    if (!parent || parent.classList.contains("md-table-wrap") || parent.classList.contains("rich-table-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "rich-table-wrap";
    parent.insertBefore(wrap, table);
    wrap.appendChild(table);
  });
}

/**
 * 对 rootEl 内已渲染的 Markdown DOM 做富内容升级。幂等、null-guard、可反复调用。
 * @param {Element|null} rootEl 消息流容器（或任何含 renderMarkdown 产物的子树）
 * @returns {Element|null} 原样返回 rootEl，便于链式
 */
export function renderRichContent(rootEl) {
  if (!rootEl || typeof rootEl.querySelectorAll !== "function") return rootEl ?? null;
  try {
    upgradeCodeBlocks(rootEl);
    upgradeExternalLinks(rootEl);
    upgradeTables(rootEl);
  } catch (error) {
    console.warn("rich-render: 后处理失败（不影响原始内容）", error);
  }
  return rootEl;
}

/**
 * @deprecated v1 CDN 装载器的兼容空壳——app.js 现行 import 仍引用此名，
 * 在 app.js 完成改线前保留为立即 resolve 的 no-op，避免模块加载期炸掉整站。
 */
export async function ensureRenderDeps() {
  return undefined;
}
