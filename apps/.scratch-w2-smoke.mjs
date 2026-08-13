import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderStore } from "./src/providers.mjs";

const root = mkdtempSync(join(tmpdir(), "prov-w2-"));
const store = new ProviderStore({ dataRoot: join(root, "data"), runtimeHome: join(root, "home") });
await store.load();

// 1. codex：Azure 形态（codexTop + codexProviderExtra + apiFormat openai_chat→chat）
const az = await store.create({
  name: "Azure OpenAI", baseUrl: "https://res.openai.azure.com/openai", apiKey: "sk-azure",
  apps: { codex: true }, models: { codex: { model: "gpt-5.5", reasoningEffort: "high" } },
  meta: {
    apiFormat: "openai_chat",
    codexTop: { disable_response_storage: "true", review_model: '"gpt-5.5"' },
    codexProviderExtra: { env_key: '"OPENAI_API_KEY"', query_params: '{ "api-version" = "2025-04-01-preview" }' },
  },
});
await store.switchTo("codex", az.id);
console.log("── config.toml (Azure) ──");
console.log(readFileSync(join(root, "home/.codex/config.toml"), "utf8"));

// 2. claude：common env 五开关 + extraEnv + extraSettings
await store.updateCommonConfig({ claude: JSON.stringify({ attribution: { commit: "", pr: "" }, env: { CLAUDE_CODE_EFFORT_LEVEL: "max", ENABLE_TOOL_SEARCH: "true" } }) });
const kfc = await store.create({
  name: "Kimi For Coding", baseUrl: "https://api.kimi.com/coding", apiKey: "sk-kimi",
  apps: { claude: true }, models: { claude: { model: "kimi-for-coding" } },
  meta: {
    extraEnv: { claude: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: "262144" } },
    extraSettings: { includeCoAuthoredBy: false, effortLevel: "high" },
  },
});
await store.switchTo("claude", kfc.id);
console.log("── settings.json (KFC + common) ──");
console.log(readFileSync(join(root, "home/.claude/settings.json"), "utf8"));

// 3. 切回官方（无 baseUrl）：codexTop removal 验证
const off = await store.create({ name: "OpenAI Official", apps: { codex: true }, models: { codex: { model: "gpt-5.5" } } });
await store.switchTo("codex", off.id);
console.log("── config.toml (official, codexTop 应摘除) ──");
console.log(readFileSync(join(root, "home/.codex/config.toml"), "utf8"));
