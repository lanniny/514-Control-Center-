// 配置中心分组树走查：分组渲染 / 选中组自动展开 / 手动折叠 / 搜索退化平铺
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
  await page.waitForSelector("#view-config:not([hidden])", { timeout: 8000 });
  await page.waitForTimeout(2500); // sources 加载 + 选中源自动展开

  const stats = await page.evaluate(() => {
    const groups = [...document.querySelectorAll(".source-group")].map((el) => ({
      label: el.querySelector(".source-group-label")?.textContent?.trim(),
      count: el.querySelector(".source-group-count")?.textContent?.trim(),
      expanded: el.classList.contains("is-expanded"),
    }));
    return {
      groupCount: groups.length,
      groups,
      visibleItems: document.querySelectorAll(".source-group-items:not([hidden]) .source-item").length,
      selectedVisible: Boolean(document.querySelector(".source-group-items:not([hidden]) .source-item.is-selected")),
    };
  });
  console.log("GROUPS", JSON.stringify(stats, null, 1));
  await page.screenshot({ path: `${SHOT_DIR}/35-config-groups-collapsed.png` });

  // 手动展开「领域技能」组
  await page.evaluate(() => {
    const header = [...document.querySelectorAll("[data-source-group]")].find((el) => el.dataset.sourceGroup === "domain-skills");
    header?.click();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT_DIR}/36-config-groups-expanded.png` });

  // 搜索态：应退化为平铺无组头
  await page.fill("#source-filter", "customize");
  await page.waitForTimeout(400);
  const search = await page.evaluate(() => ({
    groupHeaders: document.querySelectorAll(".source-group-header").length,
    items: document.querySelectorAll(".source-item").length,
  }));
  console.log("SEARCH", JSON.stringify(search));
  await page.screenshot({ path: `${SHOT_DIR}/37-config-search-flat.png` });

  console.log("ERRORS", JSON.stringify(errors));
  await browser.close();
};

run().catch((err) => { console.error("PROBE-FAIL", err); process.exit(1); });
