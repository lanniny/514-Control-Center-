import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage();
let sentBody = null;
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes("/api/providers") && !req.url().includes("switch")) {
    sentBody = req.postData();
  }
});
await page.goto("http://127.0.0.1:4823/#token=qatoken-w3", { waitUntil: "domcontentloaded" });
await page.waitForSelector('.topnav-item[data-view="config"]', { state: "visible", timeout: 15000 });
await page.click('.topnav-item[data-view="config"]');
await page.waitForSelector("#provider-add-button", { state: "visible" });
await page.click("#provider-add-button");
await page.waitForSelector('[data-preset-key="claude:Kimi For Coding"]', { state: "visible", timeout: 8000 });
await page.click('[data-preset-key="claude:Kimi For Coding"]');
await page.fill("#provider-key-input", "sk-intercept");
await page.click("#provider-save-button");
await page.waitForTimeout(1200);
console.log("SENT:", sentBody ? JSON.stringify(JSON.parse(sentBody).meta?.extraEnv) : "(no POST captured)");
if (sentBody) (await import("node:fs")).writeFileSync("I://514claude/514cc/.scratch/qa-browser-body.json", sentBody);
console.log("SENT icon:", sentBody ? JSON.parse(sentBody).icon : "-");
await browser.close();
