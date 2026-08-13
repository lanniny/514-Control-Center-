#!/usr/bin/env node
/* 探针 2：CSSOM 里到底加载了哪些 [hidden] / #view-workbench 规则 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: ["I:/514claude/514cc/apps/control-center"] }));

const base = process.argv[2] || "http://127.0.0.1:51400";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

const report = await page.evaluate(() => {
  const hits = [];
  const sheets = [...document.styleSheets].map((sheet, si) => {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { return { si, href: sheet.href, error: String(e) }; }
    const count = rules.length;
    [...rules].forEach((rule, ri) => {
      const text = rule.cssText ?? "";
      if (/\[hidden\]|#view-workbench|^\s*\.view[\s,{]/.test(rule.selectorText ?? "") && /display/.test(text)) {
        hits.push({ si, ri, href: sheet.href, selector: rule.selectorText, text: text.slice(0, 160) });
      }
      // @layer 块递归一层
      if (rule.cssRules) {
        [...rule.cssRules].forEach((inner, ii) => {
          const t = inner.cssText ?? "";
          if (/\[hidden\]|#view-workbench/.test(inner.selectorText ?? "") && /display/.test(t)) {
            hits.push({ si, ri: `${ri}.${ii}`, href: sheet.href, layer: rule.name ?? rule.cssText.slice(0, 40), selector: inner.selectorText, text: t.slice(0, 160) });
          }
        });
      }
    });
    return { si, href: sheet.href, count };
  });
  const wb = document.getElementById("view-workbench");
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href);
  const inlineStyles = [...document.querySelectorAll("style")].map((s) => s.textContent.slice(0, 80));
  return { sheets, hits, wbDisplay: getComputedStyle(wb).display, wbHidden: wb.hidden, links, inlineStyles };
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
