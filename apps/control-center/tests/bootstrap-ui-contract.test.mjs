/**
 * 向导诚实契约：前端选项 id 必须是后端真会生成的风味。
 * 曾经把 Next / Vite / Laravel 画在卡片上，磁盘却只写静态壳——这条测试不让那层谎再长回来。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FRAMEWORK_IDS, FONT_IDS, STYLE_IDS, THEME_IDS } from "../src/bootstrap.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const wizardPath = join(root, "public", "project-bootstrapper.js");

function extractIds(source, constName) {
  const block = source.match(new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\];`));
  assert.ok(block, `找不到 ${constName} 数组`);
  return [...block[1].matchAll(/id:\s*"([a-z0-9-]+)"/g)].map((match) => match[1]);
}

test("wizard option ids are a subset of backend allowlists", async () => {
  const source = await readFile(wizardPath, "utf8");
  const frameworks = extractIds(source, "FRAMEWORKS");
  const styles = extractIds(source, "STYLES");
  const themes = extractIds(source, "THEMES");
  const fonts = extractIds(source, "FONTS");

  assert.deepEqual(frameworks.slice().sort(), [...FRAMEWORK_IDS].sort());
  assert.deepEqual(styles.slice().sort(), [...STYLE_IDS].sort());
  assert.deepEqual(themes.slice().sort(), [...THEME_IDS].sort());
  assert.deepEqual(fonts.slice().sort(), [...FONT_IDS].sort());
});

test("remote type is live, not a fake disabled card", async () => {
  const source = await readFile(wizardPath, "utf8");
  assert.equal(source.includes('disabled: true, badge: "暂未接入"'), false);
  assert.equal(source.includes("远程还没接上，不假装能用"), false);
  assert.ok(source.includes("/api/ssh/hosts"));
  assert.ok(source.includes("hostId"));
  assert.ok(source.includes("sftp/list"));
  assert.match(source, /placement === "remote"|placement === 'remote'/);
});

test("wizard copy does not advertise unimplemented scaffolds", async () => {
  const source = await readFile(wizardPath, "utf8");
  const banned = [
    { id: "nextjs", needle: 'id: "nextjs"' },
    { id: "vite", needle: 'id: "vite"' },
    { id: "laravel", needle: 'id: "laravel"' },
    { id: "astro", needle: 'id: "astro"' },
    { id: "react-router", needle: 'id: "react-router"' },
    { id: "tailwind", needle: 'id: "tailwind"' },
    { id: "npm install", needle: "npm install" },
    { id: "npm run dev", needle: "npm run dev" },
  ];
  const hits = banned.filter((item) => source.includes(item.needle)).map((item) => item.id);
  assert.deepEqual(hits, [], `向导又开始卖不会生成的东西：${hits.join(", ")}`);
});
