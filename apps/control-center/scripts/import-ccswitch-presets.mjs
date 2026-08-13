import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "../..");
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const [key, inline] = arg.split("=", 2);
  args.set(key, inline ?? (process.argv[index + 1]?.startsWith("--") ? true : process.argv[++index] ?? true));
}

const sourceRoot = resolve(String(args.get("--source-root") || resolve(repoRoot, ".scratch/cc-switch/cc-switch-3.18.0")));
const outputPath = resolve(String(args.get("--output") || resolve(appRoot, "src/data/provider-presets.json")));
const shouldWrite = args.has("--write");

const sources = Object.freeze({
  claude: ["claudeProviderPresets.ts", "providerPresets"],
  codex: ["codexProviderPresets.ts", "codexProviderPresets"],
  gemini: ["geminiProviderPresets.ts", "geminiProviderPresets"],
  "claude-desktop": ["claudeDesktopProviderPresets.ts", "claudeDesktopProviderPresets"],
  grokbuild: ["grokBuildProviderPresets.ts", "grokBuildProviderPresets"],
  opencode: ["opencodeProviderPresets.ts", "opencodeProviderPresets"],
  openclaw: ["openclawProviderPresets.ts", "openclawProviderPresets"],
  hermes: ["hermesProviderPresets.ts", "hermesProviderPresets"],
});

const sourceDir = resolve(sourceRoot, "src/config");
const imported = {};
const sourceFiles = {};
for (const [app, [file, exportName]] of Object.entries(sources)) {
  const path = resolve(sourceDir, file);
  const bytes = await readFile(path);
  sourceFiles[app] = {
    path: `src/config/${file}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const module = await import(`${pathToFileURL(path).href}?sha=${sourceFiles[app].sha256}`);
  imported[app] = module[exportName];
  if (!Array.isArray(imported[app])) throw new Error(`${file} export ${exportName} is not an array`);
  if (app === "grokbuild" && module.grokBuildOfficialPreset) imported[app] = [module.grokBuildOfficialPreset, ...imported[app]];
}

const existing = JSON.parse(await readFile(outputPath, "utf8"));
const common = (preset) => ({
  name: preset.name,
  websiteUrl: preset.websiteUrl,
  apiKeyUrl: preset.apiKeyUrl,
  category: preset.category ?? "third_party",
  icon: preset.icon,
  iconColor: preset.iconColor,
  isOfficial: Boolean(preset.isOfficial),
  isPartner: Boolean(preset.isPartner),
  primePartner: Boolean(preset.primePartner),
  requiresOAuth: Boolean(preset.requiresOAuth),
  endpointCandidates: preset.endpointCandidates,
});

const compact = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
const modelCatalog = (entries = []) => entries.map((entry) => compact({
  model: entry.id,
  displayName: entry.name ?? entry.id,
  contextWindow: entry.contextWindow ?? entry.context_length ?? entry.contextLimit,
}));
const providerKey = (name) => String(name ?? "provider").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "provider";

function parseGrokCarrier(config) {
  const text = String(config ?? "");
  return {
    baseUrl: text.match(/^\s*base_url\s*=\s*"([^"]+)"/m)?.[1] ?? "",
    model: text.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? "grok-4.5",
    apiBackend: text.match(/^\s*wire_api\s*=\s*"([^"]+)"/m)?.[1] ?? "responses",
  };
}

const generated = {
  ...existing,
  version: 2,
  source: "farion1231/cc-switch v3.18.0 provider preset modules (8 applications)",
  convertedAt: new Date().toISOString(),
  sourceFiles,
};

generated["claude-desktop"] = imported["claude-desktop"].map((preset) => {
  const routes = preset.modelRoutes ?? [];
  return compact({
    ...common(preset),
    baseUrl: preset.baseUrl ?? "",
    models: compact({ model: routes[0]?.upstreamModel }),
    modelCatalog: modelCatalog(routes.map((route) => ({ id: route.upstreamModel, name: route.labelOverride, contextWindow: route.supports1m ? 1_000_000 : undefined }))),
    apiFormat: preset.apiFormat,
    appConfig: {
      mode: preset.mode,
      apiFormat: preset.apiFormat,
      modelRoutes: routes,
      providerType: preset.providerType,
      requiresOAuth: Boolean(preset.requiresOAuth),
    },
  });
});

generated.grokbuild = imported.grokbuild.map((preset) => {
  const parsed = parseGrokCarrier(preset.config);
  return compact({
    ...common(preset),
    baseUrl: parsed.baseUrl,
    models: compact({ model: parsed.model }),
    apiFormat: preset.apiFormat ?? (parsed.apiBackend === "chat" ? "openai_chat" : "openai_responses"),
    appConfig: {
      profile: providerKey(preset.name),
      apiBackend: parsed.apiBackend,
      contextWindow: 500000,
      official: Boolean(preset.isOfficial),
    },
  });
});

generated.opencode = imported.opencode.map((preset) => {
  const config = preset.settingsConfig ?? {};
  const models = Object.entries(config.models ?? {}).map(([id, entry]) => ({ id, ...(entry ?? {}) }));
  return compact({
    ...common(preset),
    baseUrl: config.options?.baseURL ?? config.options?.baseUrl ?? "",
    models: compact({ model: models[0]?.id }),
    modelCatalog: modelCatalog(models),
    appConfig: { providerKey: providerKey(preset.name), settingsConfig: config },
  });
});

generated.openclaw = imported.openclaw.map((preset) => {
  const config = preset.settingsConfig ?? {};
  return compact({
    ...common(preset),
    baseUrl: config.baseUrl ?? "",
    models: compact({ model: config.models?.[0]?.id }),
    modelCatalog: modelCatalog(config.models),
    appConfig: { providerKey: providerKey(preset.name), settingsConfig: config, suggestedDefaults: preset.suggestedDefaults },
  });
});

generated.hermes = imported.hermes.map((preset) => {
  const config = preset.settingsConfig ?? {};
  return compact({
    ...common(preset),
    baseUrl: config.base_url ?? "",
    models: compact({ model: config.models?.[0]?.id }),
    modelCatalog: modelCatalog(config.models),
    appConfig: { providerKey: config.name || providerKey(preset.name), settingsConfig: config, suggestedDefaults: preset.suggestedDefaults },
  });
});

const counts = Object.fromEntries(Object.keys(sources).map((app) => [app, generated[app]?.length ?? 0]));
for (const [app, count] of Object.entries(counts)) {
  if (count === 0) throw new Error(`${app} preset catalog is empty`);
}

if (shouldWrite) await writeFile(outputPath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, wrote: shouldWrite, counts, sourceFiles }, null, 2));
