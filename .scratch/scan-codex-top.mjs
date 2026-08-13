import { readFileSync } from "node:fs";
const text = readFileSync(".scratch/cc-switch/cc-switch-3.18.0/src/config/codexProviderPresets.ts", "utf8");
// 抓所有 config: `...` 模板串
const configs = [...text.matchAll(/config:\s*`([^`]*)`/g)].map(m => m[1]);
const topKeys = new Map(); const sectionKeys = new Map(); const sections = new Set();
for (const cfg of configs) {
  let inSection = null;
  for (const line of cfg.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const sec = t.match(/^\[([^\]]+)\]/);
    if (sec) { inSection = sec[1]; sections.add(inSection); continue; }
    const kv = t.match(/^([a-z_][a-z0-9_]*)\s*=/);
    if (!kv) continue;
    if (inSection) sectionKeys.set(`${inSection}.${kv[1]}`, (sectionKeys.get(`${inSection}.${kv[1]}`) ?? 0) + 1);
    else topKeys.set(kv[1], (topKeys.get(kv[1]) ?? 0) + 1);
  }
}
console.log("configs:", configs.length);
console.log("top-level keys:", Object.fromEntries(topKeys));
console.log("sections:", [...sections]);
console.log("section keys:", Object.fromEntries(sectionKeys));
