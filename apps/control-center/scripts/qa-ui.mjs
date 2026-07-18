#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const url = process.argv[2];
const outputDir = resolve(process.argv.find((value, index) => index >= 3 && !value.startsWith("--")) || ".qa-output");
// --suite=layout | workbench | all（默认 all）——workbench 状态机用例可独立回归
const suite = process.argv.find((value) => value.startsWith("--suite="))?.slice(8) || "all";
if (!url) throw new Error("usage: node scripts/qa-ui.mjs <control-center-url> [output-dir] [--suite=layout|workbench|all]");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const findings = [];

// 三套导航并存（顶栏/侧栏抽屉/底部 tab），:visible 会命中屏外抽屉按钮——
// 统一走 DOM 可见性过滤后 click，模拟“用户点当前可见的那个导航”。
async function clickView(page, view) {
  const clicked = await page.evaluate((v) => {
    const buttons = [...document.querySelectorAll(`[data-view="${v}"]`)];
    const target = buttons.find((b) => b.offsetParent !== null) ?? buttons[0];
    if (!target) return false;
    target.click();
    return true;
  }, view);
  if (!clicked) throw new Error(`no nav button for view ${view}`);
}

async function inspect(name, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#api-connection-badge.is-ok", { timeout: 20_000 });
  await clickView(page, "config");
  await page.waitForFunction(() => !["正在加载", "未选择配置"].includes(document.querySelector("#editor-title")?.textContent || ""), null, { timeout: 20_000 });
  const configTitle = await page.locator("#editor-title").textContent();
  await page.screenshot({ path: resolve(outputDir, `control-center-${name}-config.png`), fullPage: true });
  await clickView(page, "security");
  await page.waitForSelector("#approval-list");
  const layout = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    visibleViews: [...document.querySelectorAll("[data-view-panel]")].filter((element) => !element.hidden).map((element) => element.id),
    approvalVisible: !document.querySelector("#approval-list")?.closest("[hidden]"),
  }));
  await page.screenshot({ path: resolve(outputDir, `control-center-${name}.png`), fullPage: true });
  if (layout.documentWidth > layout.viewport.width + 1 || layout.bodyWidth > layout.viewport.width + 1) {
    errors.push(`horizontal overflow: viewport=${layout.viewport.width}, document=${layout.documentWidth}, body=${layout.bodyWidth}`);
  }
  if (layout.visibleViews.length !== 1) errors.push(`expected one visible view, got ${layout.visibleViews.join(",")}`);
  if (!configTitle || configTitle === "未选择配置") errors.push("configuration editor did not load a source");
  findings.push({ name, viewport, configTitle, layout, errors });
  await page.close();
}

// 协作台状态机回归（烛 R5/R6 致命项的确定性用例）：
// A. 摘要开关乱序响应不得倒灌——慢的 summaries=1 响应必须被请求序号丢弃；
// B. 历史预览态新建任务必须退出预览并切到新 run（POST /api/runs 用 route mock，不触真编排器）。
async function inspectWorkbenchStateMachine(name, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#api-connection-badge.is-ok", { timeout: 20_000 });
  await page.waitForSelector("#workbench-project-tree [data-project-toggle]", { timeout: 20_000 });

  const isSummariesRequest = (candidate) =>
    candidate.pathname.endsWith("/api/sessions/projects") && candidate.searchParams.get("summaries") === "1";
  await page.route(isSummariesRequest, async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500)); // 人为让 opt-in 响应最慢
    await route.continue();
  });
  await page.locator("#workbench-project-tree [data-project-toggle]").first().click();
  const summariesToggle = page.locator("#project-summaries-toggle");
  await summariesToggle.check(); // 慢请求在途
  await summariesToggle.uncheck(); // 立即关闭 + 触发无摘要的快请求
  await page.waitForTimeout(2500); // 慢响应此时已返回，必须被序号判定为过期
  const titles = await page.locator("#workbench-project-tree .session-link .session-title").allTextContents();
  const leaked = titles.filter((title) => !/^会话 /.test(title));
  if (await summariesToggle.isChecked()) errors.push("summaries toggle re-checked itself");
  if (leaked.length) errors.push(`stale summaries response backwashed a summary: ${leaked[0]}`);
  await page.unroute(isSummariesRequest);

  await page.locator("#workbench-project-tree .session-link").first().click();
  await page.waitForSelector(".preview-banner", { timeout: 10_000 });
  // 路由预览会触发真实健康探测（可能 10s+）——createRun 对 preview 失败本就容忍，直接 503 短路
  await page.route("**/api/router/preview", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "QA_MOCK" } }) }),
  );
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        id: "qa-mock-run",
        title: "QA 状态机验证任务",
        status: "planning",
        createdAt: new Date().toISOString(),
        prompt: "qa",
      }),
    });
  });
  await page.fill("#task-input", "QA 状态机验证任务");
  await page.click("#submit-task-button");
  // CSP script-src 'self' 禁 eval——用 selector 状态等待而非 waitForFunction
  await page.waitForSelector(".preview-banner", { state: "detached", timeout: 10_000 });
  const conversationTitle = await page.locator("#conversation-title").textContent();
  const runStatus = await page.locator("#workbench-run-status").textContent();
  if (runStatus === "历史预览") errors.push("workbench is still in preview mode after creating a run");
  if (!conversationTitle?.includes("QA")) errors.push(`conversation did not switch to the new run: ${conversationTitle}`);
  findings.push({ name, viewport, errors });
  await page.close();
}

try {
  if (suite === "layout" || suite === "all") {
    await inspect("desktop", { width: 1440, height: 900 });
    await inspect("mobile", { width: 390, height: 844 });
  }
  if (suite === "workbench" || suite === "all") {
    await inspectWorkbenchStateMachine("workbench-state-machine", { width: 1440, height: 900 });
  }
} finally {
  await browser.close();
}

process.stdout.write(`${JSON.stringify({ ok: findings.every((item) => item.errors.length === 0), findings }, null, 2)}\n`);
if (findings.some((item) => item.errors.length)) process.exitCode = 1;
