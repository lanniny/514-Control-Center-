/**
 * 文档工坊诚实契约：模板必须带正文进编辑器，不能只改标题。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const publicRoot = resolve(import.meta.dirname, "../public");

test("office page is a document workshop, not a title-only stub", async () => {
  const [html, panel, css, routes] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "office-panel.js"), "utf8"),
    readFile(resolve(publicRoot, "forge/waveg.css"), "utf8"),
    readFile(resolve(import.meta.dirname, "../src/office/routes.mjs"), "utf8"),
  ]);
  assert.match(html, /id="view-office"/);
  assert.match(html, /模板会带上正文/);
  assert.match(panel, /office-wizard/);
  assert.match(panel, /draftFromSpec/);
  assert.match(panel, /compactSpec/);
  assert.match(panel, /data-office-heading/);
  assert.match(panel, /data-office-paragraphs/);
  assert.match(panel, /data-office-columns/);
  assert.match(panel, /data-office-bullets/);
  assert.match(panel, /data-history-filter/);
  assert.match(panel, /\/api\/office\/download/);
  assert.match(panel, /\/api\/system\/reveal/);
  assert.equal(panel.includes("由 514 Forge 文档工坊生成"), false);
  assert.match(css, /\.office-deck\s*\{/);
  assert.match(css, /\.office-kind-card\s*\{/);
  assert.match(css, /\.office-block\s*\{/);
  assert.match(routes, /\/api\/office\/download/);
});
