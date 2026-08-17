// 收敛层·第八轮契约：rail/会话栏交界圆角卡片（LO 2026-08-17 圈点交界直角）
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function source(path) {
  return (await readFile(`${root}/${path}`, "utf8")).replace(/\r\n/g, "\n");
}

function assertIncludes(source, snippet, message) {
  assert.ok(source.includes(snippet), message ?? `缺少：${snippet}`);
}

test("conversation pane gets the Codex-style rounded top-left corner", async () => {
  const css = await source("public/forge/console-form.css");
  const wave = css.slice(css.indexOf("控制台形态 · 第八轮"));
  assertIncludes(wave, ".atelier .conversation-pane {\n  border-top-left-radius: 10px;\n}");
  // 保险丝 + 并入卡片：页签条不再自成 muted 横带；圆角值跟随 pane（第九轮 12px）
  assertIncludes(wave, ".atelier .conv-tabs {\n  border-top-left-radius: 12px;\n  background: transparent;\n}");
});

test("wave-8 ::before notch patch is retired (wave-9 shell chrome background supersedes it)", async () => {
  const css = await source("public/forge/console-form.css");
  assert.ok(!css.includes(".workbench-shell::before"), "八轮凹口补丁应已删除——第九轮壳铺 chrome 底色后它是死代码");
});

test("rail right-edge hairline and inset highlight are removed (color separation instead)", async () => {
  const css = await source("public/forge/console-form.css");
  const wave = css.slice(css.indexOf("控制台形态 · 第八轮"));
  assertIncludes(wave, ".atelier .run-rail {\n  border-right: 0;\n  box-shadow: none;\n}");
});

test("console-form.css loads after codex-desktop.css (same-specificity overrides rely on source order)", async () => {
  const html = await source("public/index.html");
  const codexIdx = html.indexOf("./forge/codex-desktop.css");
  const formIdx = html.indexOf("./forge/console-form.css");
  assert.ok(codexIdx > -1 && formIdx > -1, "index.html 缺样式链接");
  assert.ok(formIdx > codexIdx, "console-form.css 必须晚于 codex-desktop.css 加载，否则第八轮覆盖失效");
});
