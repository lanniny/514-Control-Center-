#!/usr/bin/env node
/* 实机验证（mock API 绕过 token）：远程项目创建流程 + 项目树远程节点 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: ["I:/514claude/514cc/apps/control-center"] }));

const base = process.argv[2] || "http://127.0.0.1:51400";
const HOST = { id: "h1", name: "lanniny-45", host: "45.205.25.155", port: 51451, user: "lanniny", enabled: true, trusted: true };
const DIRS = {
  "/home/lanniny": [
    { name: "aff-v02", size: 0, isDirectory: true, mtime: null },
    { name: "docs-site", size: 0, isDirectory: true, mtime: null },
    { name: "new-api", size: 0, isDirectory: true, mtime: null },
    { name: "readme.txt", size: 128, isDirectory: false, mtime: null },
  ],
  "/home/lanniny/new-api": [],
};
const remoteProjects = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  const method = route.request().method();
  const json = (payload, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
  if (url.pathname === "/api/ssh/hosts" && method === "GET") return json({ ok: true, hosts: [HOST] });
  if (/^\/api\/ssh\/hosts\/[\w-]+\/sftp\/list$/.test(url.pathname) && method === "GET") {
    const path = url.searchParams.get("path") || "/home/lanniny";
    return json({ ok: true, items: DIRS[path] ?? [] });
  }
  if (url.pathname === "/api/remote-projects" && method === "GET") return json({ ok: true, projects: remoteProjects });
  if (url.pathname === "/api/remote-projects" && method === "POST") {
    const body = JSON.parse(route.request().postData() || "{}");
    const project = { id: `rp-${Date.now()}`, ...body, createdAt: new Date().toISOString(), host: HOST, hostMissing: false };
    remoteProjects.push(project);
    console.log("[mock] POST /api/remote-projects", JSON.stringify(body));
    return json({ ok: true, project }, 201);
  }
  if (url.pathname === "/api/sessions/projects") return json({ ok: true, available: true, projects: [], sources: [] });
  if (url.pathname === "/api/projects/prefs" && method === "GET") return json({ ok: true, prefs: { projects: {}, sessions: {} } });
  if (url.pathname === "/api/teams" && method === "GET") return json({ ok: true, teams: [{ id: "t1", name: "默认团队", builtin: true, members: [] }] });
  if (url.pathname.startsWith("/api/events")) return route.abort();
  return json({ ok: true });
});

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// 1. 打开新会话对话框 → 远程卡应可选
await page.click("#new-session-button");
await page.waitForSelector("#session-dialog[open]", { timeout: 5000 });
const remoteCard = page.locator('[data-session-type="remote"]');
console.log("远程卡 disabled:", await remoteCard.isDisabled(), "| badge 隐藏:", await page.locator("#session-remote-badge").isHidden());
await remoteCard.click();
await page.click("#session-next-button");
await page.waitForTimeout(1200);

const step2 = await page.evaluate(() => ({
  title: document.getElementById("session-dialog-title")?.textContent,
  submit: document.getElementById("session-submit-button")?.textContent,
  remoteVisible: !document.getElementById("session-remote-fields")?.hidden,
  localHidden: document.getElementById("session-local-fields")?.hidden,
  path: document.getElementById("session-remote-path")?.value,
  browserItems: [...document.querySelectorAll("[data-remote-cd]")].map((b) => b.dataset.remoteCd),
}));
console.log("第二步:", JSON.stringify(step2, null, 2));
await page.screenshot({ path: ".scratch/rp-dialog.png" });

// 2. 点目录下钻
await page.click('[data-remote-cd="new-api"]');
await page.waitForTimeout(800);
const drilled = await page.evaluate(() => ({
  path: document.getElementById("session-remote-path")?.value,
  name: document.getElementById("session-remote-name")?.value,
  emptyTip: document.querySelector(".remote-browser-tip")?.textContent ?? null,
}));
console.log("下钻后:", JSON.stringify(drilled, null, 2));
await page.screenshot({ path: ".scratch/rp-dialog-drilled.png" });

// 3. 提交登记
await page.click("#session-submit-button");
await page.waitForTimeout(1500);
console.log("对话框关闭:", await page.locator("#session-dialog").isHidden());

// 4. 项目树远程节点
const tree = await page.evaluate(() => {
  const node = document.querySelector(".project-node.is-remote-project");
  if (!node) return null;
  return {
    name: node.querySelector(".project-name")?.textContent,
    badge: node.querySelector(".remote-badge")?.textContent?.trim(),
    dotCls: node.querySelector(".remote-dot")?.className,
    title: node.querySelector(".project-toggle")?.getAttribute("title"),
    writeDisabled: node.querySelector("[data-project-newsession]")?.disabled,
  };
});
console.log("项目树远程节点:", JSON.stringify(tree, null, 2));
await page.screenshot({ path: ".scratch/rp-tree.png" });

await browser.close();
console.log("\ndone");
