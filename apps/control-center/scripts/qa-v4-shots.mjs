import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const url = process.argv[2];
const outDir = ".qa-v4";
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 945 } });

const consoleErrors = [];
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300)); });
page.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${String(err).slice(0, 300)}`));

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#api-connection-badge.is-ok", { timeout: 20_000 });
await page.waitForTimeout(1800);

async function shot(name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log("shot:", name);
}

async function goView(view) {
  // terminal 已从顶栏撤下（display:none，角位开关波）——对该站走事件派发，其余站真实点击
  const item = page.locator(`.topbar-nav [data-view="${view}"]`).first();
  if (view === "terminal") await item.dispatchEvent("click");
  else await item.click();
  await page.waitForTimeout(900);
}

// light theme tour
await shot("01-workbench-light");
await goView("team"); await shot("02-team-light");
await goView("channels"); await shot("03-channels-light");
await goView("office"); await shot("04-office-light");
await goView("terminal"); await shot("05-terminal-light");
await goView("market"); await shot("06-market-light");
await goView("hosts"); await shot("07-hosts-light");
await goView("overview"); await shot("08-overview-light");
await goView("observability"); await shot("09-observability-light");
await goView("config"); await shot("10-config-light");
await goView("bootstrapper"); await shot("11-bootstrapper-light");

// command palette
await page.keyboard.press("Control+k");
await page.waitForTimeout(600);
await page.keyboard.type("团队", { delay: 20 });
await page.waitForTimeout(700);
await shot("12-palette-light");
await page.keyboard.press("Escape");

// dark theme
await page.evaluate(() => { localStorage.setItem("514cc-control-theme", "dark"); });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#api-connection-badge.is-ok", { timeout: 20_000 });
await page.waitForTimeout(1500);
await shot("13-workbench-dark");
await goView("team"); await shot("14-team-dark");
await goView("channels"); await shot("15-channels-dark");
await goView("office"); await shot("16-office-dark");
await goView("terminal"); await shot("17-terminal-dark");
await goView("market"); await shot("18-market-dark");
await goView("hosts"); await shot("19-hosts-dark");
await goView("observability"); await shot("20-observability-dark");
await goView("overview"); await shot("21-overview-dark");

console.log("CONSOLE_ERRORS:", consoleErrors.length);
consoleErrors.slice(0, 12).forEach((e) => console.log(" -", e));
await browser.close();
