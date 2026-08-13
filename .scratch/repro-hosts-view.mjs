#!/usr/bin/env node
/* 复现：切到 hosts 视图后旧视图是否仍未隐藏（拼接在主页面下面） */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: ["I:/514claude/514cc/apps/control-center"] }));

const base = process.argv[2] || "http://127.0.0.1:51400";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => { if (msg.type() === "error") console.log("[console.error]", msg.text()); });
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const dumpPanels = async (label) => {
  const info = await page.evaluate(() => {
    const panels = [...document.querySelectorAll("[data-view-panel]")].map((panel) => {
      const rect = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      return {
        id: panel.id,
        hiddenAttr: panel.hasAttribute("hidden"),
        hiddenProp: panel.hidden,
        display: style.display,
        isActive: panel.classList.contains("is-active"),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      };
    });
    const hostsContainer = document.getElementById("hosts-container");
    const footer = document.querySelector(".global-statusbar");
    const hostsRect = hostsContainer?.getBoundingClientRect();
    const footerRect = footer?.getBoundingClientRect();
    return {
      url: location.href,
      viewTitle: document.getElementById("current-view-title")?.textContent,
      panels: panels.filter((p) => p.display !== "none" || !p.hiddenAttr),
      hostsContainerY: hostsRect ? Math.round(hostsRect.top + scrollY) : null,
      footerY: footerRect ? Math.round(footerRect.top + scrollY) : null,
      footerPosition: footer ? getComputedStyle(footer).position : null,
      bodyScrollH: document.body.scrollHeight,
      docScrollH: document.documentElement.scrollHeight,
    };
  });
  console.log(`\n== ${label} ==`);
  console.log(JSON.stringify(info, null, 2));
};

await dumpPanels("initial");

// 切到 hosts 视图：优先顶栏入口，不可见则走 DOM click（复现目标是 setView 行为而非导航可用性）
const topnav = page.locator('.topnav-item[data-view="hosts"]');
if (await topnav.count() && await topnav.isVisible()) {
  await topnav.click();
} else {
  await page.evaluate(() => document.querySelector('[data-view="hosts"]')?.click());
}
await page.waitForTimeout(2000);
await dumpPanels("after click hosts");

await page.screenshot({ path: ".scratch/repro-hosts-view.png", fullPage: true });

// 再切回 workbench:确认协作台布局没被 :not([hidden]) 破坏
await page.evaluate(() => document.querySelector('[data-view="workbench"]')?.click());
await page.waitForTimeout(1500);
await dumpPanels("back to workbench");
await page.screenshot({ path: ".scratch/repro-back-workbench.png", fullPage: true });

await browser.close();
console.log("\ndone");
