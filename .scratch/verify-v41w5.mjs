#!/usr/bin/env node
/* v41 波七实机验证（mock API）：远程主机 + 远程项目同构配置工作台
 * ① 默认本机三面 ② 切远程：导航保留+远程供应商方案/运行工作台（自动 probe+graph）
 * ③ 切 capabilities：能力 chips+MCP ④ 切 sources：CLI 矩阵+真源列表+展开脱敏内容+收起
 * ⑤ 刷新图谱强制重拉 ⑥ 远程项目项目级覆盖/能力/真源 ⑦ 390px 约束 ⑧ 切回本机 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: ["I:/514claude/514cc/apps/control-center"] }));

const base = process.argv[2] || "http://127.0.0.1:51477";
const HOST = { id: "h1", name: "lanniny-45", host: "45.205.25.155", port: 51451, user: "lanniny", enabled: true, trusted: true };
const PROJECT = { id: "rp-one", name: "new-api", hostId: "h1", path: "/home/lanniny/new-api", host: HOST, hostMissing: false };
const PROBE = {
  os: "Linux 5.15.0-185-generic x86_64", shell: "/bin/bash", home: "/home/lanniny",
  disk: "29G total 8.2G free", memory: "1.5Gi / 3.8Gi",
  clis: [
    { id: "claude", label: "Claude Code", command: "claude", installed: true, version: "1.2.3", rawVersion: "1.2.3" },
    { id: "kimi", label: "Kimi Code", command: "kimi", installed: false },
  ],
};
const GRAPH = {
  home: "/home/lanniny",
  providers: [
    { sourceId: "claude-settings", cli: "claude", label: "Claude settings.json", file: ".claude/settings.json", exists: true, model: "claude-opus-4-1", baseUrl: "https://api.anthropic.com", wireApi: null, provider: null },
    { sourceId: "claude-global", cli: "claude", label: "Claude ~/.claude.json", file: ".claude.json", exists: false, model: null, baseUrl: null, wireApi: null, provider: null },
    { sourceId: "codex-config", cli: "codex", label: "Codex config.toml", file: ".codex/config.toml", exists: true, model: "gpt-5-codex", baseUrl: null, wireApi: "responses", provider: null },
    { sourceId: "kimi-config", cli: "kimi", label: "Kimi config.toml", file: ".kimi-code/config.toml", exists: true, model: "kimi-code/k3-256k", baseUrl: "https://api.kimi.com/coding/v1", wireApi: null, provider: null },
    { sourceId: "gemini-settings", cli: "gemini", label: "Gemini settings.json", file: ".gemini/settings.json", exists: false, model: null, baseUrl: null, wireApi: null, provider: null },
  ],
  capabilities: [
    { kind: "skill", cli: "claude", name: "foo-skill" },
    { kind: "agent", cli: "claude", name: "reviewer" },
    { kind: "prompt", cli: "codex", name: "init" },
  ],
  mcp: [
    { cli: "claude", name: "fs", source: ".claude/settings.json" },
    { cli: "codex", name: "docs", source: ".codex/config.toml" },
  ],
  sources: [
    { id: "claude-settings", cli: "claude", label: "Claude settings.json", remote: ".claude/settings.json", exists: true, size: 120, mtime: "2023-11-14T22:13:20.000Z" },
    { id: "claude-global", cli: "claude", label: "Claude ~/.claude.json", remote: ".claude.json", exists: false, size: 0, mtime: null },
    { id: "codex-config", cli: "codex", label: "Codex config.toml", remote: ".codex/config.toml", exists: true, size: 200, mtime: "2023-11-14T22:30:00.000Z" },
    { id: "kimi-config", cli: "kimi", label: "Kimi config.toml", remote: ".kimi-code/config.toml", exists: true, size: 150, mtime: null },
    { id: "gemini-settings", cli: "gemini", label: "Gemini settings.json", remote: ".gemini/settings.json", exists: false, size: 0, mtime: null },
    { id: "codex-agents", cli: "codex", label: "Codex AGENTS.md", remote: ".codex/AGENTS.md", exists: true, size: 88, mtime: null },
    { id: "claude-memory", cli: "claude", label: "Claude CLAUDE.md", remote: ".claude/CLAUDE.md", exists: false, size: 0, mtime: null },
  ],
};
const PROJECT_GRAPH = {
  ...GRAPH,
  project: { path: PROJECT.path },
  providers: [
    ...GRAPH.providers.map((row) => ({ ...row, scope: "host" })),
    { sourceId: "project-claude-settings", cli: "claude", label: "项目 Claude settings.json", file: ".claude/settings.json", scope: "project", exists: true, model: "claude-project", baseUrl: null, wireApi: null, provider: null },
    { sourceId: "project-claude-local-settings", cli: "claude", label: "项目 Claude settings.local.json", file: ".claude/settings.local.json", scope: "project", exists: false, model: null, baseUrl: null, wireApi: null, provider: null },
    { sourceId: "project-codex-config", cli: "codex", label: "项目 Codex config.toml", file: ".codex/config.toml", scope: "project", exists: true, model: "gpt-5.6-project", baseUrl: null, wireApi: "responses", provider: null },
  ],
  capabilities: [
    ...GRAPH.capabilities,
    { kind: "skill", cli: "claude", name: "project-deploy", scope: "project" },
    { kind: "agent", cli: "claude", name: "project-reviewer", scope: "project" },
  ],
  mcp: [...GRAPH.mcp, { cli: "shared", name: "project-db", source: ".mcp.json", scope: "project" }],
  sources: [
    ...GRAPH.sources,
    { id: "project-claude-settings", cli: "claude", label: "项目 Claude settings.json", remote: `${PROJECT.path}/.claude/settings.json`, projectRelative: ".claude/settings.json", scope: "project", exists: true, size: 80, mtime: null },
    { id: "project-claude-local-settings", cli: "claude", label: "项目 Claude settings.local.json", remote: `${PROJECT.path}/.claude/settings.local.json`, projectRelative: ".claude/settings.local.json", scope: "project", exists: false, size: 0, mtime: null },
    { id: "project-codex-config", cli: "codex", label: "项目 Codex config.toml", remote: `${PROJECT.path}/.codex/config.toml`, projectRelative: ".codex/config.toml", scope: "project", exists: true, size: 90, mtime: null },
    { id: "project-mcp", cli: "shared", label: "项目 MCP 配置", remote: `${PROJECT.path}/.mcp.json`, projectRelative: ".mcp.json", scope: "project", exists: true, size: 70, mtime: null },
    { id: "project-agents", cli: "codex", label: "项目 AGENTS.md", remote: `${PROJECT.path}/AGENTS.md`, projectRelative: "AGENTS.md", scope: "project", exists: true, size: 60, mtime: null },
    { id: "project-claude", cli: "claude", label: "项目 CLAUDE.md", remote: `${PROJECT.path}/CLAUDE.md`, projectRelative: "CLAUDE.md", scope: "project", exists: false, size: 0, mtime: null },
    { id: "project-rules", cli: "shared", label: "项目 rules.md", remote: `${PROJECT.path}/rules.md`, projectRelative: "rules.md", scope: "project", exists: false, size: 0, mtime: null },
    { id: "project-context", cli: "shared", label: "项目 context.md", remote: `${PROJECT.path}/.ai-shared/context.md`, projectRelative: ".ai-shared/context.md", scope: "project", exists: false, size: 0, mtime: null },
    { id: "project-decisions", cli: "shared", label: "项目 decisions.md", remote: `${PROJECT.path}/.ai-shared/decisions.md`, projectRelative: ".ai-shared/decisions.md", scope: "project", exists: false, size: 0, mtime: null },
    { id: "project-module", cli: "shared", label: "项目 module.yaml", remote: `${PROJECT.path}/module.yaml`, projectRelative: "module.yaml", scope: "project", exists: false, size: 0, mtime: null },
  ],
};
const calls = { probe: 0, graph: 0, projectGraph: 0, source: [], projectSource: [] };
let delayHostGraphMs = 0;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const browserErrors = [];
page.on("pageerror", (err) => { browserErrors.push(err.message); console.log("[pageerror]", err.message); });
page.on("console", (message) => { if (message.type() === "error") console.log("[console:error]", message.text()); });
page.on("requestfailed", (request) => console.log("[requestfailed]", request.url(), request.failure()?.errorText));

await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  const method = route.request().method();
  const json = (payload, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
  if (url.pathname === "/api/ssh/hosts" && method === "GET") return json({ ok: true, hosts: [HOST] });
  if (url.pathname === "/api/remote-projects" && method === "GET") return json({ ok: true, projects: [PROJECT] });
  if (url.pathname === "/api/ssh/hosts/h1/probe" && method === "POST") { calls.probe += 1; console.log("[mock] probe"); return json({ ok: true, probe: PROBE }); }
  if (url.pathname === "/api/ssh/hosts/h1/graph" && method === "GET") {
    calls.graph += 1;
    console.log("[mock] graph");
    if (delayHostGraphMs) {
      const delay = delayHostGraphMs;
      delayHostGraphMs = 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return json({ ok: true, ...GRAPH });
  }
  if (url.pathname === "/api/ssh/hosts/h1/graph/source" && method === "GET") {
    const file = url.searchParams.get("file");
    calls.source.push(file);
    console.log("[mock] graph/source", file);
    return json({ ok: true, id: file, cli: "codex", label: "Codex config.toml", remote: `/home/lanniny/.codex/config.toml`, exists: true, content: 'model = "gpt-5-codex"\nwire_api = "responses"\n', truncated: false });
  }
  if (url.pathname === "/api/remote-projects/rp-one/graph" && method === "GET") { calls.projectGraph += 1; return json({ ok: true, ...PROJECT_GRAPH }); }
  if (url.pathname === "/api/remote-projects/rp-one/graph/source" && method === "GET") {
    const file = url.searchParams.get("file");
    calls.projectSource.push(file);
    return json({ ok: true, id: file, remote: `${PROJECT.path}/AGENTS.md`, exists: true, content: "# Project AGENTS\nproject scope", truncated: false });
  }
  if (url.pathname === "/api/teams" && method === "GET") return json({ ok: true, teams: [{ id: "t1", name: "默认团队", builtin: true, members: [] }] });
  if (url.pathname === "/api/capabilities" && method === "GET") return json({ ok: true, skills: { agents: [], items: [] }, mcp: { servers: [], sources: [] } });
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
console.log("[boot]", await page.evaluate(() => ({
  hash: location.hash,
  title: document.title,
  configView: document.getElementById("view-config")?.hidden,
  hostBar: document.getElementById("config-host-bar")?.innerHTML,
  appModule: [...document.scripts].some((script) => script.src.endsWith("/app.js")),
})));

// ① 默认本机：切换条+导航+供应商面可见
const localActive = await page.locator('#config-host-bar [data-config-host=""].is-active').count();
const navVisible = await page.evaluate(() => !document.getElementById("config-topology-nav")?.hidden);
const providersVisible = await page.evaluate(() => !document.getElementById("config-surface-providers")?.hidden);
check("默认本机 chip 激活+三面图谱", localActive === 1 && navVisible && providersVisible);

// ② 切远程：导航保留、本机三面 hidden、远程面板出同构供应商方案与运行工作台
await page.click('#config-host-bar [data-config-host="h1"]');
await page.waitForTimeout(1200);
const navStillVisible = await page.evaluate(() => !document.getElementById("config-topology-nav")?.hidden);
const providersHidden = await page.evaluate(() => document.getElementById("config-surface-providers")?.hidden);
const remoteVisible = await page.evaluate(() => !document.getElementById("config-surface-remote")?.hidden);
const remoteProviderTitle = await page.locator("#config-remote-provider-title").textContent().catch(() => null);
check("切远程：导航保留+本机面板让位+远程面板可见", navStillVisible && providersHidden && remoteVisible);
check("远端供应商方案使用本机同构标题", remoteProviderTitle === "供应商方案", `title=${remoteProviderTitle}`);
check("自动 probe+graph 双触发", calls.probe >= 1 && calls.graph >= 1, `probe=${calls.probe} graph=${calls.graph}`);
const providerTabs = await page.locator("#config-surface-remote .provider-app-bar [data-config-remote-provider-app]").count();
const providerRows = await page.locator("#config-surface-remote .config-remote-provider-row").count();
const runtimeWorkbench = await page.locator("#config-surface-remote .config-remote-workbench").count();
const hint = await page.locator("#config-surface-remote").textContent();
check("供应商应用标签 9 项+Claude live 行", providerTabs === 9 && providerRows === 1, `tabs=${providerTabs} rows=${providerRows}`);
check("远端运行与配置工作台同面可达", runtimeWorkbench === 1 && hint?.includes("运行与配置工作台"), `workbench=${runtimeWorkbench}`);
check("诚实声明（Key 永不读取）", hint?.includes("Key 永不读取") === true);
await page.click('#config-surface-remote [data-config-remote-provider-app="kimi"]');
await page.waitForTimeout(300);
const kimiRowText = await page.locator("#config-surface-remote .config-remote-provider-row").textContent().catch(() => "");
check("应用标签切 Kimi：模型+Base URL 同行呈现", kimiRowText.includes("kimi-code/k3-256k") && kimiRowText.includes("https://api.kimi.com/coding/v1"), kimiRowText.slice(0, 100));
check("live 行提供稳定真源入口", await page.locator('#config-surface-remote [data-config-remote-provider-source="kimi-config"]').count() === 1);
await page.screenshot({ path: ".scratch/v41w7-remote-provider-workbench.png", fullPage: true });

// ③ 切 capabilities：能力 chips + MCP
await page.click('#config-topology-nav [data-config-surface="capabilities"]');
await page.waitForTimeout(800);
const capChips = await page.locator("#config-surface-remote .config-cap-chip:not(.is-mcp)").allTextContents();
const mcpChips = await page.locator("#config-surface-remote .config-cap-chip.is-mcp").allTextContents();
const capGroups = await page.locator("#config-surface-remote .config-cap-group").count();
const providersStillHidden = await page.evaluate(() => document.getElementById("config-surface-providers")?.hidden);
check("切 capabilities：本机面板仍隐（尾钩不让本机面放出来）", providersStillHidden);
check("能力 5 组（4 能力+MCP）+chips 内容", capGroups === 5 && capChips.join(",").includes("foo-skill") && capChips.join(",").includes("reviewer") && mcpChips.sort().join(",") === "docs,fs", `caps=${capChips} mcp=${mcpChips}`);
await page.screenshot({ path: ".scratch/v41w5-remote-caps.png" });

// ④ 切 sources：CLI 矩阵+真源列表+展开/收起
await page.click('#config-topology-nav [data-config-surface="sources"]');
await page.waitForTimeout(800);
const cliRows = await page.locator("#config-surface-remote .sshconn-cli").count();
const installBtns = await page.locator("#config-surface-remote [data-config-install-cli]").count();
const sourceRows = await page.locator("#config-surface-remote .config-source-row").count();
const disabledRows = await page.locator("#config-surface-remote .config-source-open:disabled").count();
check("sources：CLI 矩阵 2 行+1 安装钮", cliRows === 2 && installBtns === 1, `rows=${cliRows} install=${installBtns}`);
check("真源列表 7 行、3 个不存在禁点", sourceRows === 7 && disabledRows === 3, `rows=${sourceRows} disabled=${disabledRows}`);
await page.click('#config-surface-remote [data-config-graph-file="codex-config"]');
await page.waitForTimeout(800);
const sourceContent = await page.locator("#config-surface-remote .config-source-content pre").textContent().catch(() => null);
check("点真源展开脱敏内容", calls.source.length === 1 && calls.source[0] === "codex-config" && sourceContent?.includes("gpt-5-codex") === true, `content=${(sourceContent ?? "").slice(0, 60)}`);
await page.screenshot({ path: ".scratch/v41w5-remote-source-open.png" });
await page.click('#config-surface-remote [data-config-graph-file="codex-config"]');
await page.waitForTimeout(500);
const sourceClosed = await page.locator("#config-surface-remote .config-source-content").count();
check("再点收起+不重拉（缓存）", sourceClosed === 0 && calls.source.length === 1);

// ⑤ 刷新图谱强制重拉
const graphBefore = calls.graph;
const probeBefore = calls.probe;
await page.click('#config-surface-remote [data-config-target-refresh="host:h1"]');
await page.waitForTimeout(800);
check("统一刷新同时重拉图谱与环境", calls.graph === graphBefore + 1 && calls.probe === probeBefore + 1, `graph=${calls.graph} probe=${calls.probe}`);

// ⑥ 远程项目：独立 target、三个工作面包含项目作用域，不复用 host cache
delayHostGraphMs = 900;
await page.click('#config-surface-remote [data-config-target-refresh="host:h1"]');
await page.waitForTimeout(80);
await page.click('#config-host-bar [data-config-project="rp-one"]');
await page.waitForTimeout(1100);
await page.click('#config-topology-nav [data-config-surface="providers"]');
await page.waitForTimeout(400);
const projectProviderCopy = await page.locator("#config-surface-remote .provider-deck-heading p").textContent();
const projectProviderRows = await page.locator("#config-surface-remote .config-remote-provider-row").count();
const projectProviderText = await page.locator("#config-surface-remote .config-remote-provider-columns").textContent();
const projectActiveCount = await page.locator("#config-surface-remote .provider-app-tab.is-active .provider-app-tab-count").textContent();
const projectStatus = await page.locator("#config-workspace-status").textContent();
check("远程项目独立目标+目录可见", projectProviderCopy?.includes(PROJECT.path), projectProviderCopy);
check("主机慢响应不覆盖项目目标（latest-wins）", projectProviderCopy?.includes(PROJECT.path) === true && calls.graph === graphBefore + 2, `hostGraph=${calls.graph}`);
check("项目供应商方案叠加主机+项目 Claude live", calls.projectGraph === 1 && projectProviderRows === 2 && projectActiveCount === "2" && projectProviderText?.includes("项目覆盖"), `graph=${calls.projectGraph} rows=${projectProviderRows} active=${projectActiveCount}`);
check("顶部状态切换为项目实况", projectStatus?.includes("5 个 live 配置") === true, `status=${projectStatus}`);

await page.click('#config-topology-nav [data-config-surface="capabilities"]');
await page.waitForTimeout(500);
const projectCapText = await page.locator("#config-surface-remote").textContent();
const scopedCaps = await page.locator("#config-surface-remote .config-cap-chip.is-project").count();
check("项目 capabilities 含项目 Skill/Agent/MCP", scopedCaps === 3 && projectCapText?.includes("project-deploy") && projectCapText?.includes("project-reviewer") && projectCapText?.includes("project-db"), `scoped=${scopedCaps}`);

await page.click('#config-topology-nav [data-config-surface="sources"]');
await page.waitForTimeout(500);
const projectSources = await page.locator("#config-surface-remote .config-source-row").count();
await page.click('#config-surface-remote [data-config-graph-file="project-agents"]');
await page.waitForTimeout(500);
const projectSourceText = await page.locator("#config-surface-remote .config-source-content pre").textContent();
check("项目 sources 叠加 10 项且走项目端点", projectSources === 17 && calls.projectSource[0] === "project-agents" && projectSourceText?.includes("project scope"), `rows=${projectSources} calls=${calls.projectSource}`);

// ⑦ 390px：目标条换行、应用标签局部滚动、配置行与操作区不撑破主区
await page.setViewportSize({ width: 390, height: 844 });
await page.click('#config-topology-nav [data-config-surface="providers"]');
await page.waitForTimeout(500);
const mobile = await page.evaluate(() => {
  const main = document.querySelector(".main-content");
  const appBar = document.querySelector(".config-remote-provider-deck .provider-app-bar");
  const actions = document.querySelector(".config-remote-actions");
  const firstRow = document.querySelector(".config-remote-provider-row");
  const mainRect = main?.getBoundingClientRect();
  const rowRect = firstRow?.getBoundingClientRect();
  return {
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    mainOverflow: main ? main.scrollWidth - main.clientWidth : -1,
    appBarContained: appBar ? appBar.scrollWidth <= appBar.clientWidth + 1 : false,
    appBarWrapped: appBar ? appBar.getBoundingClientRect().height > 44 : false,
    actionsWidth: actions?.getBoundingClientRect().width ?? 0,
    rowInsideMain: Boolean(mainRect && rowRect && rowRect.left >= mainRect.left - 1 && rowRect.right <= mainRect.right + 1),
  };
});
check("390px 主区零横溢、标签换行收纳且配置行不越界", mobile.pageOverflow <= 1 && mobile.mainOverflow <= 1 && mobile.appBarContained && mobile.appBarWrapped && mobile.actionsWidth <= 390 && mobile.rowInsideMain, JSON.stringify(mobile));
check("浏览器零 pageerror", browserErrors.length === 0, browserErrors.join(" | "));
await page.screenshot({ path: ".scratch/v41w7-remote-project-mobile.png", fullPage: true });

// ⑧ 切回本机：三面恢复+本地页签切换正常
await page.click('#config-host-bar [data-config-host=""]');
await page.waitForTimeout(800);
const backNav = await page.evaluate(() => !document.getElementById("config-topology-nav")?.hidden);
const backProviders = await page.evaluate(() => !document.getElementById("config-surface-providers")?.hidden);
const backRemote = await page.evaluate(() => document.getElementById("config-surface-remote")?.hidden);
await page.click('#config-topology-nav [data-config-surface="sources"]');
await page.waitForTimeout(600);
const backSources = await page.evaluate(() => !document.getElementById("config-surface-sources")?.hidden);
const backProvidersHidden = await page.evaluate(() => document.getElementById("config-surface-providers")?.hidden);
check("切回本机：当前面恢复+远程面板隐藏", backNav && backProviders && backRemote);
check("本机页签切换正常（providers↔sources）", backSources && backProvidersHidden);

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过${failed.length ? `，失败 ${failed.length} 项` : ""}`);
process.exit(failed.length ? 1 : 0);
