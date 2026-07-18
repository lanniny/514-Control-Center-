import { randomUUID } from "node:crypto";
import { runProcess } from "../process-runner.mjs";
import { createLfCollector, publicClaudeEvent } from "./stream-utils.mjs";

export class ClaudeCliAdapter {
  constructor({ command = "claude", model = "fable", systemPromptFile = null, settingsFile = null, eventStore, cwd }) {
    this.id = "claude-stream-json";
    this.command = command;
    this.model = model;
    this.systemPromptFile = systemPromptFile;
    this.settingsFile = settingsFile;
    this.eventStore = eventStore;
    this.cwd = cwd;
  }

  async send({ sessionId, prompt, runId, signal, permissionMode = "plan", maxBudgetUsd = 2, timeoutMs = 15 * 60_000, model = null, effort = null, cwd = null, onSessionStarted, onTurnSubmitting }) {
    const nativeSessionId = sessionId || randomUUID();
    const clientUserMessageId = randomUUID();
    const effectiveRequestedModel = model || this.model; // /model 会话级覆盖（orchestrator 已白名单校验）
    const effectiveCwd = cwd || this.cwd; // 会话项目地址：CLI 在此目录跑，原生会话自动归属对应项目
    // 真实 CLI 对话：不再禁用工具（--tools ""），主脑像正常 claude CLI 一样读文件/跑命令。
    // 权限走 CLI 原生模式：plan/read-only=只读探索；workspace-write（经审批的 build 轮）=acceptEdits。
    // 保留 --strict-mcp-config：headless 下用户级 MCP 无法交互认证，加载即挂起（明示的能力边界）。
    // 不用 --bare：它把认证限死为 ANTHROPIC_API_KEY（OAuth/keychain 永不读取），登录态用户必然
    // "Not logged in"。hooks 隔离改由 settingsFile 的 disableAllHooks 承担——OAuth 可用 + 全局
    // route/stop/mirror-gate 不注入子进程（2026-07-18 双向实测：无 --bare 登录态直接可用；
    // disableAllHooks 后体检卡不再混入输出）。
    const nativePermissionMode = permissionMode === "workspace-write" ? "acceptEdits" : "plan";
    const args = [
      "-p",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-chrome",
      "--model",
      effectiveRequestedModel,
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      nativePermissionMode,
      "--max-budget-usd",
      String(maxBudgetUsd),
    ];
    if (effort) args.push("--effort", effort); // /effort 会话级覆盖（orchestrator 已白名单四档校验）
    if (this.settingsFile) args.push("--settings", this.settingsFile);
    if (this.systemPromptFile) args.push("--system-prompt-file", this.systemPromptFile);
    if (sessionId) args.push("--resume", sessionId);
    else args.push("--session-id", nativeSessionId);

    let finalText = "";
    let resolvedSessionId = nativeSessionId;
    let effectiveModel = this.model;
    let costUsd = null;
    let tokens = null;
    let terminalError = null;
    const pendingEvents = [];
    const collector = createLfCollector(
      (event) => {
        if (event?.type === "system" && event?.subtype === "init" && event.model) effectiveModel = event.model;
        if (event?.type === "result") {
          costUsd = event.total_cost_usd ?? costUsd;
          // 真实错误常在 result 字段（如 "Not logged in · Please run /login"）；subtype 可能误报 "success"。
          // 优先 errors → result 文本 → subtype，绝不用误导性 subtype 掩盖真因（诚实错误报告）。
          if (event.is_error) {
            terminalError =
              event.errors?.join("; ") ||
              (typeof event.result === "string" && event.result.trim()) ||
              (event.subtype && event.subtype !== "success" ? event.subtype : "") ||
              "Claude returned an error result";
          }
        }
        const normalized = publicClaudeEvent(event);
        if (!normalized) return;
        resolvedSessionId = normalized.sessionId || resolvedSessionId;
        if (normalized.type === "assistant.message" && normalized.text) finalText = normalized.text;
        if (normalized.type === "turn.completed") {
          if (normalized.text) finalText = normalized.text;
          tokens = normalized.tokens ?? tokens;
        }
        pendingEvents.push(
          this.eventStore.emit(normalized.type, normalized, {
            runId,
            sessionId: resolvedSessionId,
            agentId: "claude-fable",
          }),
        );
      },
      (error) => pendingEvents.push(this.eventStore.emit("adapter.parse_error", { adapter: this.id, message: error.message }, { runId, agentId: "claude-fable" })),
    );
    await onSessionStarted?.({ sessionId: nativeSessionId, protocol: "stream-json-resume" });
    await onTurnSubmitting?.({ sessionId: nativeSessionId, protocol: "stream-json-resume", clientUserMessageId });
    const result = await runProcess(this.command, args, {
      cwd: effectiveCwd,
      input: prompt,
      timeoutMs,
      signal,
      // 启用工具的真实 CLI 轮次：每个 tool_result 原文全量走 stdout，2MB 默认上限会中途强杀整轮。
      // 64MB 容纳带大文件 Read/grep 的正常长轮次（本地单用户控制面，内存可接受）。
      maxOutputBytes: 64 * 1024 * 1024,
      onStdout: (chunk) => collector.push(chunk),
    });
    collector.end();
    await Promise.all(pendingEvents);
    if (result.code !== 0 || terminalError) {
      let message = terminalError || result.stderr.trim() || `Claude exited ${result.code}`;
      // 已弃 --bare，headless 子进程与交互 CLI 同源读 OAuth 登录态——报未登录即真的未登录
      if (/not logged in|please run \/login|authentication_failed/i.test(message)) {
        message = `${message} — 在任意终端运行 claude 并完成 /login（或导出 ANTHROPIC_API_KEY）后重试。`;
      }
      const error = new Error(message);
      error.code = "CLAUDE_FAILED";
      throw error;
    }
    return {
      sessionId: resolvedSessionId,
      text: finalText,
      nativePersistence: true,
      protocol: "stream-json-resume",
      requestedModel: effectiveRequestedModel,
      effectiveModel,
      costUsd,
      tokens,
    };
  }
}
