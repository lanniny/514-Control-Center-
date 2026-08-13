// 三波 QA 探针：预设选择器 + 通用配置对话框（隔离实例，绝不写真实 ~/.claude）
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:4823";
const shot = (page, name) => page.screenshot({ path: `I:/514claude/514cc/.scratch/${name}.png`, fullPage: false });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
page.on("console", (msg) => { if (msg.type() === "error") console.log("CONSOLE-ERR:", msg.text()); });

await page.goto(`${BASE}/#token=qatoken-w3`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('.topnav-item[data-view="config"]', { state: "visible", timeout: 15000 });
await page.click('.topnav-item[data-view="config"]');
await page.waitForSelector("#provider-add-button", { state: "visible" });

// 1. 打开新增供应商对话框 → 预设网格
await page.click("#provider-add-button");
await page.waitForSelector("#provider-preset-grid .provider-preset-card", { state: "visible", timeout: 8000 });
const cardCount = await page.locator("#provider-preset-grid .provider-preset-card").count();
console.log("预设卡片数(claude 勾选):", cardCount);
await shot(page, "qa-w3-1-preset-grid");

// 2. 勾选 codex → 网格应变宽（claude+codex 并集）
await page.click('label:has(#provider-app-codex)');
await page.waitForTimeout(300);
console.log("预设卡片数(claude+codex):", await page.locator("#provider-preset-grid .provider-preset-card").count());

// 3. 搜索 kimi → 选「Kimi For Coding」(claude)
await page.fill("#provider-preset-search", "kimi");
await page.waitForTimeout(300);
await page.click('[data-preset-key="claude:Kimi For Coding"]');
await page.waitForTimeout(300);
const name = await page.inputValue("#provider-name-input");
const baseUrl = await page.inputValue("#provider-baseurl-input");
const model = await page.inputValue("#provider-claude-model");
console.log("自动填充:", JSON.stringify({ name, baseUrl, model }));
await shot(page, "qa-w3-2-preset-filled");

// 4. 填 Key 保存 → 启用 → 磁盘实证
await page.fill("#provider-key-input", "sk-qa-kimi-for-coding");
await page.click("#provider-save-button");
await page.waitForSelector("#provider-dialog", { state: "hidden", timeout: 8000 }).catch(() => {});
await page.waitForTimeout(600);
// 在 Kimi For Coding 卡片上点启用（避免点中其他卡片）
const kimiCard = page.locator('.provider-card:has-text("Kimi For Coding")').first();
const enableBtn = kimiCard.locator('button[data-provider-switch^="claude::"]');
await enableBtn.click();
await page.waitForSelector('#action-dialog[open]', { timeout: 5000 });
await page.click('#dialog-confirm-button');
await page.waitForTimeout(800);
await shot(page, "qa-w3-3-after-switch");

// 5. 通用配置对话框：五开关 + JSON 同步
await page.click("#provider-common-config-button");
await page.waitForSelector("#common-config-dialog[open]", { state: "visible" });
await page.click("#common-toggle-toolsearch");
await page.click("#common-toggle-effort");
await page.click("#common-toggle-attribution");
await page.waitForTimeout(300);
const jsonText = await page.inputValue("#common-config-claude");
console.log("五开关→JSON:", jsonText.replace(/\s+/g, " "));
await shot(page, "qa-w3-4-common-config");
await page.click("#common-config-save-button");
await page.waitForTimeout(800);

// 6. 再切一次供应商让 common 并入，然后读盘
const enableBtn2 = page.locator('button[data-provider-switch^="claude::"]').first();
await enableBtn2.click().catch(() => {});
const confirm2 = await page.$('#action-dialog[open] #dialog-confirm-button');
if (confirm2) await confirm2.click();
await page.waitForTimeout(800);

await browser.close();
console.log("PROBE-DONE");
