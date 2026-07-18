import { ClaudeCliAdapter } from "./claude-cli.mjs";
import { CodexAppServerAdapter } from "./codex-app-server.mjs";
import { CodexCliAdapter } from "./codex-cli.mjs";
import { GeminiCliAdapter } from "./gemini-cli.mjs";
import { GrokBuildAdapter } from "./grok-build.mjs";
import { GrokMcpAdapter } from "./grok-mcp.mjs";
import { KimiCliAdapter } from "./kimi-cli.mjs";
import { PiRpcAdapter } from "./pi-rpc.mjs";
import { resolve } from "node:path";
import { assertWithin } from "../paths.mjs";

export function createAdapters({ profiles, eventStore, cwd, approvalResolver }) {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const profile = (id) => byId.get(id) || {};
  const codex = profile("codex-technical");
  const claude = profile("claude-fable");
  const claudeSystemPrompt = claude.systemPromptFile
    ? assertWithin(cwd, resolve(cwd, claude.systemPromptFile), "Claude coordinator system prompt")
    : null;
  // headless 子进程 settings：disableAllHooks 隔离全局 route/stop/mirror-gate（--bare 的替代——保住 OAuth 登录态）
  const claudeSettings = assertWithin(
    cwd,
    resolve(cwd, "config/control-center/claude-headless-settings.json"),
    "Claude headless settings",
  );
  const codexAppServer = new CodexAppServerAdapter({ command: codex.command, model: codex.model, eventStore, cwd, approvalResolver });
  const grokHost = new CodexAppServerAdapter({ command: codex.command, model: codex.model, eventStore, cwd, approvalResolver, disableMcp: false });
  return new Map([
    ["claude-fable", new ClaudeCliAdapter({ command: claude.command, model: claude.model, systemPromptFile: claudeSystemPrompt, settingsFile: claudeSettings, eventStore, cwd })],
    ["codex-technical", codexAppServer],
    ["codex-technical-fallback", new CodexCliAdapter({ command: codex.command, model: codex.model, eventStore, cwd })],
    ["gemini-research", new GeminiCliAdapter({ command: profile("gemini-research").command, model: profile("gemini-research").model, eventStore, cwd })],
    ["grok-search", new GrokMcpAdapter({
      host: grokHost,
      eventStore,
      requiredEnv: ["GROK_SEARCH_RS_COMPAT_API_URL", "GROK_SEARCH_RS_COMPAT_API_KEY", "GROK_SEARCH_RS_COMPAT_MODEL"],
    })],
    ["grok-build", new GrokBuildAdapter({ command: profile("grok-build").command, model: profile("grok-build").model, eventStore, cwd })],
    ["kimi-frontend", new KimiCliAdapter({ command: profile("kimi-frontend").command, model: profile("kimi-frontend").model, eventStore, cwd })],
    ["pi-resident", new PiRpcAdapter({ command: profile("pi-resident").command, model: profile("pi-resident").model, eventStore, cwd })],
  ]);
}
