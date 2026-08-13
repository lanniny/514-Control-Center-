// 供应商面板全流程走查：空态 → 对话框建档 → 卡片出现 → 启用投影 → 团队绑定 → 一键应用
import { createRequire } from "node:module";
const require = createRequire("I:/514claude/514cc/apps/control-center/package.json");
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:5520";
const SHOT_DIR = "I:/514claude/514cc/.scratch/desktop-launch";

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(`console: ${msg.text()}`); });

  await page.goto(`${BASE}/#token=qatoken-0725`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('.topnav-item[data-view="config"]', { timeout: 15000 });
  await page.waitForTimeout(2200);
  await page.click('.topnav-item[data-view="config"]');
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${SHOT_DIR}/40-provider-empty.png` });

  // 新增供应商
  await page.click("#provider-add-button");
  await page.waitForSelector("#provider-dialog[open]", { timeout: 5000 });
  await page.fill("#provider-name-input", "PackyCode 中转");
  await page.fill("#provider-baseurl-input", "https://api.packycode.com");
  await page.fill("#provider-key-input", "sk-packy-qa-1234");
  await page.check("#provider-app-codex");
  await page.fill("#provider-claude-model", "claude-sonnet-4-5");
  await page.fill("#provider-codex-model", "gpt-5-codex");
  await page.selectOption("#provider-codex-effort", "high");
  await page.screenshot({ path: `${SHOT_DIR}/41-provider-dialog.png` });
  await page.click("#provider-save-button");
  await page.waitForTimeout(1800);

  const afterCreate = await page.evaluate(() => ({
    cards: document.querySelectorAll(".provider-card").length,
    currentBadges: document.querySelectorAll(".provider-badge.is-current").length,
    keyText: document.querySelector(".provider-card .provider-meta-line")?.textContent ?? "",
  }));
  console.log("AFTER-CREATE", JSON.stringify(afterCreate));
  await page.screenshot({ path: `${SHOT_DIR}/42-provider-card.png` });

  // 启用（切 claude）——确认对话框（只点未禁用那张卡的「启用」）
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('[data-provider-switch^="claude::"]')].find((el) => !el.disabled);
    button?.click();
  });
  await page.waitForTimeout(600);
  const confirmVisible = await page.evaluate(() => Boolean([...document.querySelectorAll("dialog[open]")].find((d) => d.textContent.includes("切换供应商"))));
  console.log("CONFIRM-VISIBLE", confirmVisible);
  await page.screenshot({ path: `${SHOT_DIR}/43-provider-switch-confirm.png` });
  await page.evaluate(() => {
    const dialog = [...document.querySelectorAll("dialog[open]")].find((d) => d.textContent.includes("切换供应商"));
    [...dialog.querySelectorAll("button")].find((b) => b.textContent.trim() === "启用")?.click();
  });
  await page.waitForTimeout(1800);
  const afterSwitch = await page.evaluate(() => ({
    currentBadges: document.querySelectorAll(".provider-badge.is-current").length,
    liveLine: document.querySelector(".provider-app-col .provider-live-line")?.textContent ?? "",
  }));
  console.log("AFTER-SWITCH", JSON.stringify(afterSwitch));
  await page.screenshot({ path: `${SHOT_DIR}/44-provider-switched.png` });

  // 团队绑定：新团队 + 绑 claude/codex（manage-teams-button 在协作台 rail，不在团队视图）
  await page.evaluate(() => document.querySelector('.topnav-item[data-view="workbench"]')?.click());
  await page.waitForTimeout(1500);
  await page.click("#manage-teams-button");
  await page.waitForSelector("#team-dialog[open]", { timeout: 5000 });
  await page.click("#team-new-button"); // 头部独立「新建团队」入口（switcher 的新建态不回填旧值）
  await page.waitForTimeout(400);
  await page.fill("#team-name-input", "供应商绑定测试队");
  const bindOptions = await page.evaluate(() => ({
    claude: document.querySelectorAll("#team-provider-claude option").length,
    codex: document.querySelectorAll("#team-provider-codex option").length,
    gemini: document.querySelectorAll("#team-provider-gemini option").length,
  }));
  console.log("BIND-OPTIONS", JSON.stringify(bindOptions));
  await page.selectOption("#team-provider-claude", { index: 1 });
  await page.selectOption("#team-provider-codex", { index: 1 });
  await page.screenshot({ path: `${SHOT_DIR}/45-team-provider-bind.png` });
  await page.click("#team-save-button");
  await page.waitForTimeout(1800);

  // 回配置中心一键应用团队方案
  await page.evaluate(() => document.querySelector('.topnav-item[data-view="config"]')?.click());
  await page.waitForTimeout(1500);
  const applyState = await page.evaluate(() => ({
    teamOptions: document.querySelectorAll("#provider-team-select option").length,
    applyDisabled: document.querySelector("#provider-apply-team-button")?.disabled,
  }));
  console.log("APPLY-STATE", JSON.stringify(applyState));
  await page.click("#provider-apply-team-button");
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const dialog = [...document.querySelectorAll("dialog[open]")].find((d) => d.textContent.includes("应用团队方案"));
    [...dialog.querySelectorAll("button")].find((b) => b.textContent.trim() === "一键应用")?.click();
  });
  await page.waitForTimeout(2000);
  const finalState = await page.evaluate(() => ({
    currentBadges: document.querySelectorAll(".provider-badge.is-current").length,
    toast: document.querySelector("#toast-region")?.textContent?.trim().slice(0, 80) ?? "",
  }));
  console.log("FINAL", JSON.stringify(finalState));
  await page.screenshot({ path: `${SHOT_DIR}/46-team-applied.png` });

  console.log("ERRORS", JSON.stringify(errors));
  await browser.close();
};

run().catch((err) => { console.error("PROBE-FAIL", err); process.exit(1); });
