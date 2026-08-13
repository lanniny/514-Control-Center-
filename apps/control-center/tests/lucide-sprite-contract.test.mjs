/**
 * lucide sprite 契约：public 下每个 `#lucide-*` 引用都必须在离线 sprite 里有对应 symbol。
 *
 * 离线 sprite 是唯一图标来源（CSP 下没有 CDN 兜底）。漏掉一个 id，界面上就是一块空白按钮，
 * 而空白图标从来不会让任何测试变红——只能靠人眼在某个页面上偶然发现。这条把它变成机械红灯。
 * LEGACY_ICON_MAP 只重映射 `icon-*` 旧前缀，因此 `lucide-*` 引用没有运行时兜底。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

async function collectFiles(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collectFiles(full, out);
    else if (/\.(?:js|html|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("every #lucide-* reference resolves to a symbol in the offline sprite", async () => {
  const sprite = await readFile(join(publicDir, "lucide-sprite.svg"), "utf8");
  const available = new Set([...sprite.matchAll(/id="(lucide-[a-z0-9-]+)"/g)].map((match) => match[1]));
  assert.ok(available.size > 50, `离线 sprite 应包含图标定义，实际只有 ${available.size} 个`);

  const missing = new Map();
  for (const file of await collectFiles(publicDir)) {
    const text = await readFile(file, "utf8");
    // `#lucide-${name}` 这类动态拼接不会命中（`$` 不在字符集内），只检查写死的 id
    for (const match of text.matchAll(/#(lucide-[a-z0-9-]+)/g)) {
      if (available.has(match[1])) continue;
      if (!missing.has(match[1])) missing.set(match[1], new Set());
      missing.get(match[1]).add(relative(publicDir, file).replaceAll("\\", "/"));
    }
  }

  assert.deepEqual(
    [...missing.keys()].sort(),
    [],
    `以下图标引用在离线 sprite 中不存在，界面上会渲染成空白：${[...missing]
      .map(([id, where]) => `${id} ← ${[...where].sort().join(", ")}`)
      .join(" | ")}`,
  );
});
