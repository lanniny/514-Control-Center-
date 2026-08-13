/**
 * Lucide icon helper for 514 Forge (offline sprite in lucide-sprite.svg).
 * Usage: lucideIcon("search") or lucideIcon("sparkles", "icon icon-lg")
 * Optional size (px number or CSS length) sets explicit width/height:
 * lucideIcon("loader-circle", "icon forge-spin", 14)
 * Names must exist in lucide-icons.json (regenerate via scripts/vendor-lucide.mjs).
 */
export function lucideIcon(name, className = "icon lucide", size = null) {
  const id = String(name || "").replace(/^lucide-/, "");
  const dimension = size == null ? "" : Number.isFinite(size) ? `${size}px` : String(size);
  const sizeAttr = dimension ? ` width="${dimension}" height="${dimension}"` : "";
  return `<svg class="${className}"${sizeAttr} aria-hidden="true" focusable="false"><use href="#lucide-${id}"></use></svg>`;
}

/** Map legacy sprite ids to Lucide names for gradual migration. */
export const LEGACY_ICON_MAP = Object.freeze({
  "icon-overview": "layout-dashboard",
  "icon-workbench": "messages-square",
  "icon-config": "settings",
  "icon-route": "route",
  "icon-shield": "shield",
  "icon-refresh": "refresh-cw",
  "icon-play": "play",
  "icon-check": "check",
  "icon-diff": "list",
  "icon-save": "file-text",
  "icon-history": "history",
  "icon-search": "search",
  "icon-stop": "circle-stop",
  "icon-chevron": "chevron-right",
  "icon-file": "file-text",
  "icon-folder": "folder",
  "icon-lock": "lock",
  "icon-copy": "copy",
  "icon-close": "x",
  "icon-pulse": "activity",
  "icon-capabilities": "grid-2x2",
  "icon-sessions": "messages-square",
  "icon-sun": "sun",
  "icon-moon": "moon",
});

export async function mountLucideSprite() {
  if (document.getElementById("lucide-sprite-host")) return;
  const host = document.createElement("div");
  host.id = "lucide-sprite-host";
  host.setAttribute("hidden", ""); // CSP：隐藏走 hidden 属性，不用 cssText（style-src 拦截）
  try {
    const response = await fetch("./lucide-sprite.svg", { cache: "force-cache" });
    if (!response.ok) throw new Error(`lucide sprite ${response.status}`);
    host.innerHTML = await response.text();
    document.body.prepend(host);
  } catch (error) {
    console.warn("Lucide sprite failed to load:", error);
  }
}

/** Rewrite <use href="#icon-..."> to Lucide when possible. */
export function remapLegacyIconUses(root = document) {
  root.querySelectorAll("use").forEach((use) => {
    const href = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
    const mapped = LEGACY_ICON_MAP[href.replace(/^#/, "")];
    if (mapped) use.setAttribute("href", `#lucide-${mapped}`);
  });
}
