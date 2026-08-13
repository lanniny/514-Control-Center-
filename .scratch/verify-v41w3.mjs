#!/usr/bin/env node
/* v41 波三实机验证（mock API 绕过 token）：
 * ① 远程项目节点 run 数徽标 ② 展开聚合 run 会话组（Codex 式截断+展开显示）
 * ③ 成员行点击 selectRun 打开 ④ 右键「浏览文件（SFTP）」快显到远程主机视图
 * 负面控制：本地 run / 其他路径远程 run / 已归档远程 run 均不进节点。 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: ["I:/514claude/514cc/apps/control-center"] }));

const base = process.argv[2] || "http://127.0.0.1:51400";
const HOST = { id: "h1", name: "lanniny-45", host: "45.205.25.155", port: 51451, user: "lanniny", enabled: true, trusted: true };
const RP = { id: "rp1", name: "new-api", hostId: "h1", path: "/home/lanniny/new-api", host: HOST, hostMissing: false };
const ROSTER = [
  { id: "kimi-1", label: "Kimi 前端工程师", runtimeProfileId: "kimi-k2" },
  { id: "codex-1", label: "Codex 技术执行", runtimeProfileId: "codex-gpt5" },
];
const mkRun = (i) => ({
  id: `run-r${i}`,
  title: `远程巡检 ${i}`,
  prompt: `远程巡检 ${i}`,
  status: "completed",
  teamId: "t1",
  teamMembers: ["kimi-1", "codex-1"],
  coordinatorId: "codex-1",
  startAgentId: "kimi-1",
  executionOwnerId: "kimi-1",
  sessions: { "kimi-1": `sess-kimi-${i}aaaaaaaa`, "codex-1": `sess-codex-${i}bbbbbbbb` },
  teamRoster: ROSTER,
  remote: { hostId: "h1", path: "/home/lanniny/new-api" },
  createdAt: new Date(Date.now() - (i + 1) * 3600e3).toISOString(),
  updatedAt: new Date(Date.now() - i * 1800e3).toISOString(),
});
const RUNS = [1, 2, 3, 4, 5, 6, 7, 8].map(mkRun);
const CONTROLS = [
  { ...mkRun(90), id: "run-local", title: "本地任务", remote: undefined }, // 无 remote → 不进节点
  { ...mkRun(91), id: "run-other-path", title: "其他路径", remote: { hostId: "h1", path: "/home/lanniny/other" } },
  { ...mkRun(92), id: "run-archived", title: "已归档", archived: true },
];
const sftpCalls = [];
const eventCalls = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  const method = route.request().method();
  const json = (payload, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
  if (url.pathname === "/api/ssh/hosts" && method === "GET") return json({ ok: true, hosts: [HOST] });
  if (/^\/api\/ssh\/hosts\/[\w-]+\/sftp\/list$/.test(url.pathname) && method === "GET") {
    const path = url.searchParams.get("path") || "/";
    sftpCalls.push(path);
    console.log("[mock] sftp list", path);
    return json({ ok: true, items: [{ name: "app", size: 0, isDirectory: true, mtime: null }] });
  }
  if (url.pathname === "/api/remote-projects" && method === "GET") return json({ ok: true, projects: [RP] });
  if (url.pathname === "/api/runs" && method === "GET") return json({ runs: [...RUNS, ...CONTROLS] });
  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch && method === "GET") {
    return json([...RUNS, ...CONTROLS].find((run) => run.id === runMatch[1]) ?? { ok: true });
  }
  const runEventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (runEventsMatch && method === "GET") {
    eventCalls.push(runEventsMatch[1]);
    console.log("[mock] GET run events", runEventsMatch[1]);
    return json({ ok: true, events: [] });
  }
  if (url.pathname === "/api/sessions/projects") return json({ ok: true, available: true, projects: [], sources: [] });
  if (url.pathname === "/api/projects/prefs" && method === "GET") return json({ ok: true, prefs: { projects: {}, sessions: {} } });
  if (url.pathname === "/api/teams" && method === "GET") return json({ ok: true, teams: [{ id: "t1", name: "默认团队", builtin: true, members: [] }] });
  if (url.pathname.startsWith("/api/events")) return route.abort();
  return json({ ok: true });
});

const results = [];
const check = (name, ok, detail = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

// ① 徽标 = 8（3 条负面控制不计）
const badge = await page.locator(".project-node.is-remote-project .project-badge").first().textContent().catch(() => null);
check("徽标 run 数=8（负面控制排除）", badge?.trim() === "8", `实际=${badge?.trim()}`);

// ② 展开 → 6 组 + 展开显示（还有 2 条）
await page.click(".project-node.is-remote-project .project-toggle");
await page.waitForTimeout(600);
const listSel = ".project-node.is-remote-project ul.project-sessions";
const groups6 = await page.locator(`${listSel} .run-group`).count();
const moreBtn = page.locator(`${listSel} [data-sessions-showmore]`);
const moreText = (await moreBtn.count()) ? await moreBtn.textContent() : null;
check("截断：先出 6 组", groups6 === 6, `实际=${groups6}`);
check("截断行文案", moreText?.includes("还有 2 条") === true, `实际=${moreText}`);

// 组头/成员行结构（第一组=updatedAt 最新的 run-r1）
const headTitle = await page.locator(`${listSel} .run-group-head .run-group-title`).first().textContent().catch(() => null);
const memberRows = await page.locator(`${listSel} .run-group`).first().locator(".run-member-link").count();
check("组头标题=最新 run", headTitle?.trim() === "远程巡检 1", `实际=${headTitle?.trim()}`);
check("成员行=2（kimi+codex）", memberRows === 2, `实际=${memberRows}`);

// ③ 展开显示 → 8 组
await moreBtn.click();
await page.waitForTimeout(600);
const groups8 = await page.locator(`${listSel} .run-group`).count();
const moreGone = (await page.locator(`${listSel} [data-sessions-showmore]`).count()) === 0;
check("展开显示后 8 组", groups8 === 8, `实际=${groups8}`);
check("展开后截断行消失", moreGone);
await page.screenshot({ path: ".scratch/v41w3-tree.png" });

// ④ 成员行点击 → selectRun 打开（tab 出现 + GET run 被请求）
await page.locator(`${listSel} .run-member-link`).first().click();
await page.waitForTimeout(1200);
const tab = await page.evaluate(() => {
  const node = document.querySelector("#conv-tabs [data-tab-activate]");
  return node ? node.textContent.trim() : null;
});
check("点击成员行开出 run 页签", Boolean(tab), `tab=${tab}`);
check("打开后拉取该 run 事件流", eventCalls.includes("run-r1"), `calls=${eventCalls.join(",") || "无"}`);

// ⑤ 右键项目 → 浏览文件（SFTP）→ 切 hosts 视图 + 预填路径 + 列目录
await page.click(".project-node.is-remote-project .project-toggle", { button: "right" });
await page.waitForTimeout(500);
const menuItem = page.locator("#context-menu [data-menu-index]", { hasText: "浏览文件" });
check("右键菜单含 SFTP 项", (await menuItem.count()) === 1);
await menuItem.click();
await page.waitForTimeout(1200);
const hostsVisible = await page.evaluate(() => !document.getElementById("view-hosts")?.hidden);
const sftpPath = await page.locator("#sftp-path").inputValue().catch(() => null);
check("切到远程主机视图", hostsVisible);
check("SFTP 路径预填项目目录", sftpPath === "/home/lanniny/new-api", `实际=${sftpPath}`);
check("SFTP 列目录已触发", sftpCalls.includes("/home/lanniny/new-api"), `calls=${sftpCalls.join(",") || "无"}`);
await page.screenshot({ path: ".scratch/v41w3-sftp.png" });

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过${failed.length ? `，失败 ${failed.length} 项` : ""}`);
process.exit(failed.length ? 1 : 0);
