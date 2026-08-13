import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:4823/#token=qatoken-w3", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
await page.screenshot({ path: "I:/514claude/514cc/.scratch/qa-w3-0-landing.png" });
console.log("nav display:", await page.evaluate(() => {
  const el = document.querySelector('button[data-view="config"]');
  const cs = getComputedStyle(el);
  let p = el; const chain = [];
  while (p && chain.length < 6) { chain.push(`${p.tagName}.${String(p.className).split(" ")[0]}:${getComputedStyle(p).display}/${getComputedStyle(p).visibility}`); p = p.parentElement; }
  return JSON.stringify({ display: cs.display, visibility: cs.visibility, rect: el.getBoundingClientRect(), chain }, null, 1);
}));
await browser.close();
