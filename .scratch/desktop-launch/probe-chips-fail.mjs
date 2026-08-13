// 芯片墙失败态探针：首次 /api/capabilities 拦截为 500 → 应显示「失败 + 重试」且无自旋；放行后点重试 → 芯片回填
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

  let capRequests = 0;
  let failOnce = true;
  await page.route("**/api/capabilities**", async (route) => {
    capRequests += 1;
    if (failOnce) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "注入故障：目录服务熔断" } }) });
    } else {
      await route.continue();
    }
  });

  await page.goto(`${BASE}/#token=qatoken-0725`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#manage-teams-button", { timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.click("#manage-teams-button");
  await page.waitForSelector("#team-dialog[open]", { timeout: 8000 });
  await page.waitForTimeout(2500);

  const failState = await page.evaluate(() => {
    const wall = document.querySelector("#team-skills-chips");
    return {
      text: wall?.textContent?.trim().slice(0, 120) ?? "(missing)",
      hasRetry: Boolean(wall?.querySelector("[data-chips-retry]")),
    };
  });
  console.log("FAIL-STATE", JSON.stringify(failState));
  const afterFailRequests = capRequests;
  await page.waitForTimeout(2000); // 静置：若仍在自旋，请求数会继续涨
  console.log("SPIN-CHECK", `fail后请求数=${afterFailRequests} 静置2s后=${capRequests}`);
  await page.screenshot({ path: `${SHOT_DIR}/34-chips-fail.png` });

  // 放行后点重试
  failOnce = false;
  await page.click("#team-skills-chips [data-chips-retry]");
  await page.waitForTimeout(2500);
  const recovered = await page.evaluate(() => ({
    skillChips: document.querySelectorAll("#team-skills-chips .chip").length,
    mcpChips: document.querySelectorAll("#team-mcp-chips .chip").length,
    checked: document.querySelectorAll("#team-skills-chips .chip input:checked").length,
  }));
  console.log("RECOVERED", JSON.stringify(recovered));
  console.log("ERRORS", JSON.stringify(errors));
  await browser.close();
};

run().catch((err) => { console.error("PROBE-FAIL", err); process.exit(1); });
