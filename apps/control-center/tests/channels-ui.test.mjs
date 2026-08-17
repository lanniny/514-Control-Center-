import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const publicRoot = resolve(import.meta.dirname, "../public");

test("channels page is a wizard workbench, not a bare three-field form", async () => {
  const [html, panel, css, routes] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "channels-panel.js"), "utf8"),
    readFile(resolve(publicRoot, "forge/waveg.css"), "utf8"),
    readFile(resolve(import.meta.dirname, "../src/channels/routes.mjs"), "utf8"),
  ]);
  assert.match(html, /id="view-channels"/);
  assert.match(html, /先验通再创建/);
  assert.match(panel, /channel-wizard-title/);
  assert.match(panel, /\/api\/channels\/probe/);
  assert.match(panel, /data-generate-secret/);
  assert.match(panel, /还没有渠道/);
  assert.match(panel, /暂无事件/);
  assert.match(panel, /data-event-filter/);
  assert.match(panel, /确认删除/);
  assert.match(css, /\.channel-deck\s*\{/);
  assert.match(css, /\.channel-type-card\s*\{/);
  assert.match(css, /\.channel-empty\s*\{/);
  assert.match(routes, /\/api\/channels\/probe/);
});
