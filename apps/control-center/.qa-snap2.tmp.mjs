import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:4823/#token=qatoken-w3", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
console.log(await page.evaluate(() => {
  return JSON.stringify([...document.querySelectorAll('[data-view="config"]')].map((el) => ({
    cls: el.className, visible: el.getBoundingClientRect().width > 0,
    parent: el.closest("header,nav,aside,div")?.className,
  })), null, 1);
}));
await page.screenshot({ path: "I:/514claude/514cc/.scratch/qa-w3-0-landing.png" });
await browser.close();
