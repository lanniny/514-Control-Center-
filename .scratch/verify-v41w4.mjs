#!/usr/bin/env node
/* v41 波四实机验证（mock API）：配置图谱「配置目标」主机切换
 * ① 默认本机三面+切换条 ② 切远程：图谱让位/远程面板/自动探测
 * ③ 装 CLI：确认框→install-cli→回显+重探测 ④ 同步对话框：plan→推送→回显
 * ⑤ 切回本机三面恢复 ⑥ 管理主机跳 hosts 视图 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: ["I:/514claude/514cc/apps/control-center"] }));

const base = process.argv[2] || "http://127.0.0.1:51400";
const HOST = { id: "h1", name: "lanniny-45", host: "45.205.25.155", port: 51451, user: "lanniny", enabled: true, trusted: true };
const PROBE = {
  os: "Linux 5.15.0-185-generic x86_64", shell: "/bin/bash", home: "/home/lanniny",
  disk: "29G total 8.2G free", memory: "1.5Gi / 3.8Gi",
  clis: [
    { id: "claude", label: "Claude Code", command: "claude", installed: true, version: "1.2.3", rawVersion: "1.2.3" },
    { id: "kimi", label: "Kimi Code", command: "kimi", installed: false },
  ],
};
const PLAN = { files: [
  { id: "codex-config", label: ".codex/config.toml", local: "C:/Users/x/.codex/config.toml", remote: ".codex/config.toml", exists: true, size: 512, containsSecrets: false },
  { id: "claude-settings", label: ".claude/settings.json", local: "C:/Users/x/.claude/settings.json", remote: ".claude/settings.json", exists: true, size: 128, containsSecrets: true },
] };
const calls = { probe: 0, install: [], sync: null };

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  const method = route.request().method();
  const json = (payload, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
  if (url.pathname === "/api/ssh/hosts" && method === "GET") return json({ ok: true, hosts: [HOST] });
  if (url.pathname === "/api/ssh/hosts/h1/probe" && method === "POST") { calls.probe += 1; console.log("[mock] probe"); return json({ ok: true, probe: PROBE }); }
  if (url.pathname === "/api/ssh/hosts/h1/install-cli" && method === "POST") {
    const body = JSON.parse(route.request().postData() || "{}");
    calls.install.push(body);
    console.log("[mock] install-cli", JSON.stringify(body));
    return json({ ok: true, display: "kimi", code: 0, stdout: "added 1 package", stderr: "" });
  }
  if (url.pathname === "/api/ssh/hosts/h1/env-sync/plan" && method === "GET") return json({ ok: true, ...PLAN });
  if (url.pathname === "/api/ssh/hosts/h1/env-sync" && method === "POST") {
    calls.sync = JSON.parse(route.request().postData() || "{}");
    console.log("[mock] env-sync", JSON.stringify(calls.sync));
    return json({ ok: true, home: "/home/lanniny", results: [{ ok: true, label: ".codex/config.toml", remote: ".codex/config.toml", bytes: 512 }] });
  }
  if (url.pathname === "/api/teams" && method === "GET") return json({ ok: true, teams: [{ id: "t1", name: "默认团队", builtin: true, members: [] }] });
  if (url.pathname === "/api/sessions/projects") return json({ ok: true, available: true, projects: [], sources: [] });
  if (url.pathname.startsWith("/api/events")) return route.abort();
  return json({ ok: true });
});

const results = [];
const check = (name, ok, detail = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

await page.goto(`${base}/#config/providers`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// 已在配置图谱（hash 直达，绕开抽屉导航的视口外点击）

// ① 默认本机：切换条渲染、本机 chip 激活、拓扑导航可见
const chips = await page.locator("#config-host-bar [data-config-host]").allTextContents();
const localActive = await page.locator('#config-host-bar [data-config-host=""].is-active').count();
const navVisible = await page.evaluate(() => !document.getElementById("config-topology-nav")?.hidden);
const providersVisible = await page.evaluate(() => !document.getElementById("config-surface-providers")?.hidden);
check("切换条=本机+lanniny-45+管理入口", chips.length === 2 && (await page.locator("[data-config-host-manage]").count()) === 1, chips.join("/"));
check("默认本机 chip 激活", localActive === 1);
check("默认拓扑导航+供应商面可见", navVisible && providersVisible);

// ② 切远程：图谱让位、远程面板出现、自动探测
await page.click('#config-host-bar [data-config-host="h1"]');
await page.waitForTimeout(1000);
const navHidden = await page.evaluate(() => document.getElementById("config-topology-nav")?.hidden);
const providersHidden = await page.evaluate(() => document.getElementById("config-surface-providers")?.hidden);
const remoteVisible = await page.evaluate(() => !document.getElementById("config-surface-remote")?.hidden);
const osText = await page.locator("#config-surface-remote .sshconn-env-grid b").first().textContent().catch(() => null);
const cliRows = await page.locator("#config-surface-remote .sshconn-cli").count();
const installBtns = await page.locator("#config-surface-remote [data-config-install-cli]").count();
check("切远程：图谱三面+导航让位", navHidden && providersHidden && remoteVisible);
check("自动探测触发+OS 回显", calls.probe >= 1 && osText?.includes("Linux") === true, `probe=${calls.probe} os=${osText}`);
check("CLI 矩阵 2 行、未装 1 个安装钮", cliRows === 2 && installBtns === 1, `rows=${cliRows} install=${installBtns}`);
await page.screenshot({ path: ".scratch/v41w4-remote-panel.png" });

// ③ 装 CLI：确认框 → install-cli → 回显 + 重探测
const probeBefore = calls.probe;
await page.click('#config-surface-remote [data-config-install-cli="h1:kimi"]');
await page.waitForTimeout(500);
const confirmTitle = await page.locator("#dialog-title").textContent().catch(() => null);
await page.click("#dialog-confirm-button");
await page.waitForTimeout(1000);
const resultText = await page.locator("#config-surface-remote .config-remote-result").textContent();
check("安装确认框（标题含主机+CLI）", confirmTitle?.includes("lanniny-45") === true && confirmTitle?.includes("Kimi") === true, `title=${confirmTitle}`);
check("install-cli 请求（toolId+platform）", calls.install.length === 1 && calls.install[0].toolId === "kimi" && calls.install[0].platform === "linux", JSON.stringify(calls.install[0] ?? null));
check("安装结果回显+成功后重探测", resultText?.includes("安装完成") === true && calls.probe === probeBefore + 1, `probe=${calls.probe}`);

// ④ 同步对话框：plan 清单 → 推送 → 回显（含秘密项默认不勾）
await page.click('#config-surface-remote [data-config-host-sync="h1"]');
await page.waitForTimeout(800);
const syncRows = await page.locator("dialog.sshconn-dialog [data-sync-file]").count();
const secretUnchecked = await page.locator('dialog.sshconn-dialog [data-sync-file="claude-settings"]:not(:checked)').count();
const normalChecked = await page.locator('dialog.sshconn-dialog [data-sync-file="codex-config"]:checked').count();
await page.click('dialog.sshconn-dialog [data-act="push"]');
await page.waitForTimeout(1000);
const syncResult = await page.locator("#config-surface-remote .config-remote-result").textContent();
check("同步清单 2 项、含秘密默认不勾", syncRows === 2 && secretUnchecked === 1 && normalChecked === 1);
check("推送仅选中项+回显", calls.sync?.files?.length === 1 && calls.sync.files[0] === "codex-config" && syncResult?.includes("同步完成") === true, JSON.stringify(calls.sync));
await page.screenshot({ path: ".scratch/v41w4-sync.png" });

// ⑤ 切回本机：三面恢复
await page.click('#config-host-bar [data-config-host=""]');
await page.waitForTimeout(800);
const backNav = await page.evaluate(() => !document.getElementById("config-topology-nav")?.hidden);
const backProviders = await page.evaluate(() => !document.getElementById("config-surface-providers")?.hidden);
const backRemote = await page.evaluate(() => document.getElementById("config-surface-remote")?.hidden);
check("切回本机：图谱三面恢复、远程面板隐藏", backNav && backProviders && backRemote);

// ⑥ 管理主机跳 hosts 视图
await page.click("[data-config-host-manage]");
await page.waitForTimeout(800);
const hostsView = await page.evaluate(() => !document.getElementById("view-hosts")?.hidden);
check("管理主机… 跳远程主机视图", hostsView);

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过${failed.length ? `，失败 ${failed.length} 项` : ""}`);
process.exit(failed.length ? 1 : 0);
