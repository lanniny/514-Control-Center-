import { readFileSync } from "node:fs";
for (const f of ["claudeProviderPresets.ts", "geminiProviderPresets.ts"]) {
  const text = readFileSync(`.scratch/cc-switch/cc-switch-3.18.0/src/config/${f}`, "utf8");
  const envKeys = new Set(); const scKeys = new Set(); const directKeys = new Set();
  for (const m of text.matchAll(/settingsConfig:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
    for (const k of m[1].matchAll(/^\s*([a-zA-Z_]+):/gm)) scKeys.add(k[1]);
  }
  for (const m of text.matchAll(/^\s{4}([A-Z][A-Z0-9_]+):/gm)) envKeys.add(m[1]);
  for (const m of text.matchAll(/^\s{4}([a-z][a-zA-Z]*):/gm)) directKeys.add(m[1]);
  console.log(f, "\n  settingsConfig keys:", [...scKeys], "\n  env keys:", [...envKeys].join(","), "\n  direct fields:", [...directKeys].join(","));
}
