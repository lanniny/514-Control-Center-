// 能力声明芯片墙走查探针：团队对话框 → 芯片渲染/勾选/幽灵片/失败态
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
  page.on("response", (res) => { if (res.url().includes("/api/")) console.log("NET", res.status(), res.url()); });
  page.on("requestfailed", (req) => { if (req.url().includes("/api/")) console.log("NETFAIL", req.failure()?.errorText, req.url()); });

  await page.goto(`${BASE}/#token=qatoken-0725`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#manage-teams-button", { timeout: 15000 });
  await page.waitForTimeout(2500); // 等 bootstrap/teams 就绪

  // 打开团队配置对话框（当前团队）
  await page.click("#manage-teams-button");
  await page.waitForSelector("#team-dialog[open]", { timeout: 8000 });
  await page.waitForTimeout(3000); // 等 capabilities 目录 + 芯片回填

  const stats = await page.evaluate(() => {
    const skillWall = document.querySelector("#team-skills-chips");
    const mcpWall = document.querySelector("#team-mcp-chips");
    return {
      skillChips: skillWall?.querySelectorAll(".chip").length ?? -1,
      mcpChips: mcpWall?.querySelectorAll(".chip").length ?? -1,
      skillChecked: skillWall?.querySelectorAll(".chip input:checked").length ?? -1,
      skillDisabled: skillWall?.querySelectorAll(".chip input:disabled").length ?? -1,
      ghosts: document.querySelectorAll("#team-dialog .chip.is-ghost").length,
      offs: document.querySelectorAll("#team-dialog .chip.is-off").length,
      skillWallText: skillWall?.textContent?.slice(0, 80) ?? "(missing)",
      mcpWallText: mcpWall?.textContent?.slice(0, 80) ?? "(missing)",
    };
  });
  console.log("STATS", JSON.stringify(stats, null, 2));
  console.log("ERRORS", JSON.stringify(errors));

  // 页面内手动 fetch 对照：token 是否就位、接口是否通
  const manual = await page.evaluate(async () => {
    const token = sessionStorage.getItem("514cc-control-token");
    try {
      const res = await fetch("/api/capabilities", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      const body = await res.json();
      return { token: token ? `${token.slice(0, 6)}…` : null, status: res.status, skills: body?.skills?.items?.length ?? null, mcp: body?.mcp?.servers?.length ?? null };
    } catch (err) {
      return { token, error: String(err) };
    }
  });
  console.log("MANUAL", JSON.stringify(manual));

  await page.screenshot({ path: `${SHOT_DIR}/33-chips-light.png` });

  // 滚动对话框到能力声明区，特写芯片墙
  await page.evaluate(() => {
    const label = [...document.querySelectorAll("#team-dialog .form-section-label")].find((el) => el.textContent.includes("能力声明"));
    label?.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT_DIR}/33-chips-scrolled-light.png` });

  // 再滚到底，看幽灵片行
  await page.evaluate(() => {
    const body = document.querySelector("#team-dialog .dialog-body") ?? document.querySelector("#team-dialog");
    body.scrollTop = body.scrollHeight;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT_DIR}/33-chips-bottom-light.png` });
  const ghostNames = await page.evaluate(() =>
    [...document.querySelectorAll("#team-dialog .chip.is-ghost")].map((el) => el.textContent.trim()),
  );
  console.log("GHOSTS", JSON.stringify(ghostNames));

  // 墙元素直截：幽灵片行不再受对话框滚动缝隙影响
  await page.locator("#team-skills-chips").screenshot({ path: `${SHOT_DIR}/33-skill-wall-element.png` });

  // 暗色
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOT_DIR}/33-chips-dark.png` });
  await browser.close();
};

run().catch((err) => { console.error("PROBE-FAIL", err); process.exit(1); });
