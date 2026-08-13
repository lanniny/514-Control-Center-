// cc-switch 预设供应商目录搬运：三个 TS 预设文件 → apps/control-center/src/data/provider-presets.json
// codex 预设的生成器函数（generateThirdPartyAuth/Config、modelCatalog）在此复刻后 eval。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const src = "I:/514claude/514cc/.scratch/cc-switch/cc-switch-3.18.0/src/config";
const outDir = "I:/514claude/514cc/apps/control-center/src/data";
mkdirSync(outDir, { recursive: true });

// ── codex 生成器复刻（codexProviderPresets.ts:53-111 逐行对齐）──
const generateThirdPartyAuth = (apiKey) => ({ OPENAI_API_KEY: apiKey || "" });
const generateThirdPartyConfig = (providerName, baseUrl, modelName = "gpt-5.5") => {
  const s = (v) => JSON.stringify(v);
  return `model_provider = "custom"
model = ${s(modelName)}
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.custom]
name = ${s(providerName)}
base_url = ${s(baseUrl)}
wire_api = "responses"
requires_openai_auth = true`;
};
const modelCatalog = (models) => models.map((entry) => (typeof entry === "string" ? { model: entry } : { ...entry }));

function extractArray(file, exportName, prelude = "") {
  const text = readFileSync(join(src, file), "utf8");
  const marker = `export const ${exportName}`;
  const start = text.indexOf(marker);
  if (start === -1) throw new Error(`${exportName} not found in ${file}`);
  const eq = text.indexOf("=", start);
  const open = text.indexOf("[", eq);
  if (open === -1) throw new Error(`${exportName} array start not found in ${file}`);
  // 括号配平扫描：跳过字符串/模板串/注释，找到数组字面量的确切终点
  let depth = 0;
  let i = open;
  let end = -1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === "\\") i += 1;
        i += 1;
      }
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    } else if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
    } else if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    i += 1;
  }
  if (end === -1) throw new Error(`${exportName} array end not found in ${file}`);
  const arrayText = text.slice(open, end + 1);
  // 官方数据文件（可信源）：数组字面量 eval；codex 文件需要先注入生成器
  const factory = new Function(`${prelude}\nreturn (${arrayText});`);
  return factory();
}

// ── 映射工具 ──
const trimSlash = (url) => String(url ?? "").trim().replace(/\/+$/, "");

function commonFields(preset) {
  return {
    name: preset.name,
    websiteUrl: preset.websiteUrl ?? "",
    apiKeyUrl: preset.apiKeyUrl ?? "",
    category: preset.category ?? "third_party",
    icon: preset.icon ?? "",
    iconColor: preset.iconColor ?? "",
    isOfficial: Boolean(preset.isOfficial),
    isPartner: Boolean(preset.isPartner),
    primePartner: Boolean(preset.primePartner),
    requiresOAuth: Boolean(preset.requiresOAuth),
    endpointCandidates: Array.isArray(preset.endpointCandidates) ? preset.endpointCandidates : [],
  };
}

const CLAUDE_KNOWN_ENV = new Set([
  "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL",
]);

function mapClaude(preset) {
  const settings = preset.settingsConfig ?? {};
  const env = settings.env ?? {};
  const extraEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!CLAUDE_KNOWN_ENV.has(key) && value !== "") extraEnv[key] = String(value);
  }
  // 非 env 的 settingsConfig 键 = settings.json 顶层片段（effortLevel/includeCoAuthoredBy/enabledPlugins 等）
  const extraSettings = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key !== "env") extraSettings[key] = value;
  }
  return {
    ...commonFields(preset),
    baseUrl: trimSlash(env.ANTHROPIC_BASE_URL ?? ""),
    models: {
      model: env.ANTHROPIC_MODEL ?? "",
      haikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "",
      sonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? "",
      opusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? "",
    },
    apiKeyField: preset.apiKeyField === "ANTHROPIC_API_KEY" ? "ANTHROPIC_API_KEY" : undefined,
    apiFormat: preset.apiFormat,
    extraEnv,
    extraSettings: Object.keys(extraSettings).length ? extraSettings : undefined,
  };
}

/** 预设 config TOML 解析：顶层键 map + section 分组（值为原始 RHS，字符串保留引号）。 */
function parsePresetToml(config) {
  const top = new Map();
  const sections = new Map(); // name → Map(key → rawRHS)
  let current = null;
  for (const raw of String(config ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      current = sec[1].trim();
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!kv) continue;
    (current ? sections.get(current) : top).set(kv[1], kv[2].trim());
  }
  return { top, sections };
}

const unquote = (raw) => String(raw ?? "").replace(/^"(.*)"$/, "$1");

function mapCodex(preset) {
  const { top, sections } = parsePresetToml(preset.config);
  // 我们投影负责的键：model_provider/model/model_reasoning_effort + section 的 name/base_url/wire_api/requires_openai_auth
  const model = unquote(top.get("model") ?? "");
  const reasoningEffort = unquote(top.get("model_reasoning_effort") ?? "");
  top.delete("model_provider");
  top.delete("model");
  top.delete("model_reasoning_effort");
  const codexTop = Object.fromEntries(top); // review_model/disable_response_storage/model_verbosity/personality（raw RHS）
  let baseUrl = "";
  const codexProviderExtra = {};
  for (const [name, body] of sections) {
    if (!name.startsWith("model_providers.")) throw new Error(`unexpected section [${name}] in ${preset.name}`);
    baseUrl = unquote(body.get("base_url") ?? "");
    body.delete("base_url");
    body.delete("name");
    body.delete("wire_api");
    body.delete("requires_openai_auth");
    Object.assign(codexProviderExtra, Object.fromEntries(body)); // env_key/query_params/model_context_window 等
  }
  const catalog = Array.isArray(preset.modelCatalog)
    ? preset.modelCatalog.map((m) => ({ model: m.model, displayName: m.displayName, contextWindow: m.contextWindow }))
    : undefined;
  return {
    ...commonFields(preset),
    baseUrl: trimSlash(baseUrl),
    models: { model, reasoningEffort },
    apiFormat: preset.apiFormat,
    codexTop: Object.keys(codexTop).length ? codexTop : undefined,
    codexProviderExtra: Object.keys(codexProviderExtra).length ? codexProviderExtra : undefined,
    modelCatalog: catalog,
  };
}

const GEMINI_KNOWN_ENV = new Set(["GOOGLE_GEMINI_BASE_URL", "GEMINI_API_KEY", "GEMINI_MODEL"]);

function mapGemini(preset) {
  const env = preset.settingsConfig?.env ?? {};
  const extraEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!GEMINI_KNOWN_ENV.has(key) && value !== "") extraEnv[key] = String(value);
  }
  return {
    ...commonFields(preset),
    baseUrl: trimSlash(env.GOOGLE_GEMINI_BASE_URL ?? preset.baseURL ?? ""),
    models: { model: env.GEMINI_MODEL ?? preset.model ?? "" },
    extraEnv,
    description: preset.description ?? "",
  };
}

// ── 转换 ──
const claudeRaw = extractArray("claudeProviderPresets.ts", "providerPresets");
const codexRaw = extractArray(
  "codexProviderPresets.ts",
  "codexProviderPresets",
  `const generateThirdPartyAuth = ${generateThirdPartyAuth.toString()};
   const generateThirdPartyConfig = ${generateThirdPartyConfig.toString()};
   const modelCatalog = ${modelCatalog.toString()};`,
);
const geminiRaw = extractArray("geminiProviderPresets.ts", "geminiProviderPresets");

const strip = (entry) =>
  JSON.parse(
    JSON.stringify(entry, (key, value) =>
      value === undefined || value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
        ? undefined
        : value,
    ),
  );

const catalog = {
  version: 1,
  source: "farion1231/cc-switch v3.18.0 src/config/*ProviderPresets.ts",
  convertedAt: new Date().toISOString(),
  claude: claudeRaw.filter((p) => !p.hidden).map(mapClaude).map(strip),
  codex: codexRaw.filter((p) => !p.hidden).map(mapCodex).map(strip),
  gemini: geminiRaw.filter((p) => !p.hidden).map(mapGemini).map(strip),
};

const outPath = join(outDir, "provider-presets.json");
writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(`claude=${catalog.claude.length} codex=${catalog.codex.length} gemini=${catalog.gemini.length}`);
console.log(`written: ${outPath} (${(JSON.stringify(catalog).length / 1024).toFixed(1)}KB)`);
