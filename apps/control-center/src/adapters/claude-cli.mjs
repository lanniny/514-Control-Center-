import { randomUUID } from "node:crypto";
import { runProcess } from "../process-runner.mjs";
import { preparePromptTransport } from "../prompt-transport.mjs";
import { createLfCollector, publicClaudeEvent } from "./stream-utils.mjs";

export function buildClaudeArgs({
  sessionId = null,
  nativeSessionId,
  requestedModel,
  permissionMode = "plan",
  maxBudgetUsd = 2,
  effort = null,
  settingsFile = null,
  systemPromptFile = null,
  nativeCommand = false,
}) {
  const nativePermissionMode = permissionMode === "workspace-write" ? "acceptEdits" : "plan";
  const args = [
    "-p",
    "--strict-mcp-config",
    "--no-chrome",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    nativePermissionMode,
    "--max-budget-usd",
    String(maxBudgetUsd),
  ];
  // 默认禁斜杠命令：普通提示词里的 "/" 只是文本（防提示注入触发 CLI 内部命令）。
  // 原生命令轮例外：用户显式发送 /compact 等，CLI 需要解释执行——与 Desktop 同通道。
  if (!nativeCommand) args.splice(2, 0, "--disable-slash-commands");
  const model = typeof requestedModel === "string" ? requestedModel.trim() : "";
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (settingsFile) args.push("--settings", settingsFile);
  if (systemPromptFile) args.push("--system-prompt-file", systemPromptFile);
  if (sessionId) args.push("--resume", sessionId);
  else args.push("--session-id", nativeSessionId);
  return args;
}

export class ClaudeCliAdapter {
  supportsPerTurnCwd = true; // 每 turn spawn，cwd 参数真实生效——worktree 隔离可托付（烛 v3.6 致命7）

  constructor({ command = "claude", model = "fable", systemPromptFile = null, settingsFile = null, eventStore, cwd, runProcessImpl = runProcess }) {
    this.id = "claude-stream-json";
    this.command = command;
    this.model = model;
    this.systemPromptFile = systemPromptFile;
    this.settingsFile = settingsFile;
    this.eventStore = eventStore;
    this.cwd = cwd;
    this.runProcessImpl = runProcessImpl; // v41：远程 run 注入 SSH 桥（默认本机 runProcess）
  }

  // 异构 resume 契约：只声明本 provider 的原生恢复命令，禁止跨 CLI 静默 resume
  canResume(sessionId) {
    return Boolean(sessionId);
  }

  resumeCommand(sessionId) {
    return sessionId ? `claude -r ${sessionId}` : null;
  }

  async send({ sessionId, prompt, runId, agentId = "claude-fable", signal, permissionMode = "plan", maxBudgetUsd = 2, timeoutMs = 15 * 60_000, model = null, effort = null, cwd = null, nativeCommand = false, onSessionStarted, onTurnSubmitting }) {
    const nativeSessionId = sessionId || randomUUID();
    const clientUserMessageId = randomUUID();
    const effectiveRequestedModel = model || this.model; // /model 会话级覆盖（orchestrator 已白名单校验）
    const effectiveCwd = cwd || this.cwd; // 会话项目地址：CLI 在此目录跑，原生会话自动归属对应项目
    // 真实 CLI 对话：不再禁用工具（--tools ""）；运行席位按当前 permissionMode 使用实际 CLI 工具能力。
    // 权限走 CLI 原生模式：plan/read-only=只读探索；workspace-write（经审批的 build 轮）=acceptEdits。
    // 保留 --strict-mcp-config：headless 下用户级 MCP 无法交互认证，加载即挂起（明示的能力边界）。
    // 不用 --bare：它把认证限死为 ANTHROPIC_API_KEY（OAuth/keychain 永不读取），登录态用户必然
    // "Not logged in"。hooks 隔离改由 settingsFile 的 disableAllHooks 承担——OAuth 可用 + 全局
    // route/stop/mirror-gate 不注入子进程（2026-07-18 双向实测：无 --bare 登录态直接可用；
    // disableAllHooks 后体检卡不再混入输出）。
    const args = buildClaudeArgs({
      sessionId,
      nativeSessionId,
      requestedModel: effectiveRequestedModel,
      permissionMode,
      maxBudgetUsd,
      effort,
      settingsFile: this.settingsFile,
      systemPromptFile: this.systemPromptFile,
      nativeCommand,
    });

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
            agentId,
          }),
        );
      },
      (error) => pendingEvents.push(this.eventStore.emit("adapter.parse_error", { adapter: this.id, message: error.message }, { runId, agentId })),
    );
    await onSessionStarted?.({ sessionId: nativeSessionId, protocol: "stream-json-resume" });
    await onTurnSubmitting?.({ sessionId: nativeSessionId, protocol: "stream-json-resume", clientUserMessageId });
    await preparePromptTransport({
      prompt,
      transport: "stdin",
      adapterId: this.id,
      command: this.command,
      eventStore: this.eventStore,
      runId,
      agentId,
    });
    const result = await this.runProcessImpl(this.command, args, {
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
