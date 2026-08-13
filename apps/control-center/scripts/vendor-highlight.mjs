/**
 * vendor-highlight.mjs — 把 node_modules 的 highlight.js（CJS）机械包装成
 * 单文件浏览器 ESM：public/vendor/highlight/highlight.mjs。
 * 用法：node scripts/vendor-highlight.mjs
 * 纪律：生成物勿手改；升级 highlight.js 后重跑本脚本。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libDir = join(root, "node_modules", "highlight.js", "lib");
const outFile = join(root, "public", "vendor", "highlight", "highlight.mjs");

// common 子集中按协作台实际语料挑选（省体积；要加语言在此追加）
const LANGUAGES = [
  "xml", "bash", "shell", "c", "cpp", "css", "markdown", "diff", "go", "ini",
  "java", "javascript", "typescript", "json", "kotlin", "lua", "python",
  "rust", "scss", "sql", "swift", "yaml", "plaintext",
];

const version = JSON.parse(readFileSync(join(libDir, "..", "package.json"), "utf8")).version;

const wrap = (factory) =>
  factory
    // lib 源只通过 module.exports 导出（无裸 exports. 用法），仅替换这一句；
    // 语言定义对象自身的 .exports 属性（如 javascript→typescript 传递 CLASS_REFERENCE）必须原样保留
    .replace(/module\.exports\s*=/g, "__module.exports =");

const parts = [
  `// highlight.js v${version} common 子集 — 机械 CJS→ESM 包装（scripts/vendor-highlight.mjs 生成，勿手改）`,
  `const __modules = {};`,
  `const __cache = {};`,
  `function __require(path) {`,
  `  if (__cache[path]) return __cache[path].exports;`,
  `  const __module = { exports: {} };`,
  `  const __exports = __module.exports;`,
  `  __cache[path] = __module;`,
  `  __modules[path](__module, __exports);`,
  `  return __module.exports;`,
  `}`,
  `__modules["./core"] = (__module, __exports) => {`,
  wrap(readFileSync(join(libDir, "core.js"), "utf8")),
  `};`,
];

for (const lang of LANGUAGES) {
  parts.push(`__modules["./languages/${lang}"] = (__module, __exports) => {`);
  parts.push(wrap(readFileSync(join(libDir, "languages", `${lang}.js`), "utf8")));
  parts.push(`};`);
}

parts.push(`const hljs = __require("./core");`);
for (const lang of LANGUAGES) {
  parts.push(`hljs.registerLanguage(${JSON.stringify(lang)}, __require("./languages/${lang}"));`);
}
parts.push(`export { hljs as HighlightJS };`);
parts.push(`export default hljs;`);
parts.push(``);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, parts.join("\n"));
console.log(`vendored highlight.js v${version} + ${LANGUAGES.length} languages -> ${outFile}`);
