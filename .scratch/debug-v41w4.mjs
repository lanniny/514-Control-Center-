#!/usr/bin/env node
/* 调试：安装按钮不可见原因 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: ["I:/514claude/514cc/apps/control-center"] }));

const base = process.argv[2] || "http://127.0.0.1:51477";
const HOST = { id: "h1", name: "lanniny-45", host: "45.205.25.155", port: 51451, user: "lanniny", enabled: true, trusted: true };
const PROBE = { os: "Linux", shell: "/bin/bash", home: "/home/lanniny", disk: "29G", memory: "1.5Gi",
  clis: [{ id: "kimi", label: "Kimi Code", command: "kimi", installed: false }] };

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  const method = route.request().method();
  const json = (payload) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  if (url.pathname === "/api/ssh/hosts") return json({ ok: true, hosts: [HOST] });
  if (url.pathname.endsWith("/probe") && method === "POST") return json({ ok: true, probe: PROBE });
  if (url.pathname.startsWith("/api/events")) return route.abort();
  return json({ ok: true });
});
await page.goto(`${base}/#config/providers`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.click('#config-host-bar [data-config-host="h1"]');
await page.waitForTimeout(1000);
const info = await page.evaluate(() => {
  const btn = document.querySelector('[data-config-install-cli="h1:kimi"]');
  if (!btn) return { found: false };
  const chain = [];
  let node = btn;
  while (node && node !== document.body) {
    const cs = getComputedStyle(node);
    chain.push({
      tag: node.tagName, id: node.id || null, cls: String(node.className).slice(0, 60),
      hidden: node.hidden, display: cs.display, visibility: cs.visibility,
      h: Math.round(node.getBoundingClientRect().height),
    });
    node = node.parentElement;
  }
  return { found: true, btnRect: btn.getBoundingClientRect().toJSON(), chain };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
