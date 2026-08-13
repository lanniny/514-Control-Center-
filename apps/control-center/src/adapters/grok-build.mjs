// Grok Build CLI 适配器（v3.5 Phase 3）：headless `grok -p ... --output-format streaming-json`。
// 事件流三段式（2026-07-17 本机实测）：{"type":"thought","data":tok} 逐 token 推理流 /
// {"type":"text","data":...} 最终答案 / {"type":"end","sessionId","usage",...} 收尾。
// 续轮走 `-r <sessionId>`（grok --help 实证存在）。thought 逐 token 不入事件库（防洪水），
// 只在首个 thought 时 emit 一条 thinking 标记。会话由 grok 自身持久化（~/.grok）。
import { randomUUID } from "node:crypto";
import { runProcess } from "../process-runner.mjs";
import { createLfCollector } from "./stream-utils.mjs";

export function buildGrokArgs({ prompt, sessionId = null, model = null, effort = null, permissionMode = "plan" }) {
  const args = ["-p", prompt];
  if (sessionId) args.push("-r", sessionId);
  if (model) args.push("-m", model);
  if (effort) args.push("--reasoning-effort", effort); // grok 独立推理档位（--help 实证：--reasoning-effort，别名 --effort）
  // 强制 orchestrator 的 coordinator-plan 安全不变量：主脑/只读轮锁 plan（只读探索），
  // 仅审批过的 build 专家轮映射 acceptEdits——与 claude 适配器同映射，不再依赖 grok 环境默认。
  args.push("--permission-mode", permissionMode === "workspace-write" ? "acceptEdits" : "plan");
  args.push("--output-format", "streaming-json");
  return args;
}

export class GrokBuildAdapter {
  supportsPerTurnCwd = true; // 每 turn spawn，cwd 参数真实生效——worktree 隔离可托付（烛 v3.6 致命7）

  constructor({ command = "grok", model = null, eventStore, cwd, runProcessImpl = runProcess }) {
    this.id = "grok-build-headless";
    this.command = command;
    this.model = model;
    this.eventStore = eventStore;
    this.cwd = cwd;
    this.runProcessImpl = runProcessImpl; // v41：远程 run 注入 SSH 桥（默认本机 runProcess）
  }

  async send({ sessionId, prompt, runId, agentId = "grok-build", signal, permissionMode = "plan", model = null, effort = null, timeoutMs = 15 * 60_000, cwd = null, onSessionStarted, onTurnSubmitting }) {
    // Windows 命令行长度上限约 32K；-p 传参超限时如实拒绝而非静默截断
    if (prompt.length > 24_000) {
      const error = new Error("prompt exceeds the grok -p argument budget (24k chars); split the task instead");
      error.code = "INVALID_PROMPT";
      throw error;
    }
    const args = buildGrokArgs({ prompt, sessionId, model: model || this.model, effort, permissionMode });
    let resolvedSessionId = sessionId || null;
    let finalText = "";
    let usage = null;
    let thinkingEmitted = false;
    const pendingEvents = [];
    const collector = createLfCollector(
      (event) => {
        if (event?.type === "thought") {
          if (!thinkingEmitted) {
            thinkingEmitted = true;
            pendingEvents.push(
              this.eventStore.emit("grok.thinking", { adapter: this.id }, { runId, sessionId: resolvedSessionId, agentId }),
            );
          }
          return; // 逐 token 推理流不入事件库
        }
        if (event?.type === "text" && typeof event.data === "string") {
          finalText += event.data;
          return; // 文本在 end 时随 completed 事件一次性入库
        }
        if (event?.type === "end") {
          const previousSessionId = resolvedSessionId;
          resolvedSessionId = event.sessionId || resolvedSessionId;
          usage = event.usage || null;
          if (resolvedSessionId && resolvedSessionId !== previousSessionId) {
            pendingEvents.push(onSessionStarted?.({ sessionId: resolvedSessionId, protocol: "grok-headless-resume" }));
          }
          // assistant.message 与其他 CLI 适配器统一（前端会话流只认这个类型渲染正文——
          // 旧 grok.completed 携文本前端不识别，grok 轮在对话里只剩分隔线与统计行）
          if (finalText) {
            pendingEvents.push(
              this.eventStore.emit("assistant.message", { text: finalText }, { runId, sessionId: resolvedSessionId, agentId }),
            );
          }
          pendingEvents.push(
            this.eventStore.emit(
              "grok.completed",
              { adapter: this.id, stopReason: event.stopReason || null, usage }, // 正文已走 assistant.message，不双份入库
              { runId, sessionId: resolvedSessionId, agentId },
            ),
          );
        }
      },
      (error) =>
        pendingEvents.push(
          this.eventStore.emit("adapter.parse_error", { adapter: this.id, message: error.message }, { runId, agentId }),
        ),
    );
    if (sessionId) await onSessionStarted?.({ sessionId, protocol: "grok-headless-resume" });
    await onTurnSubmitting?.({ sessionId: sessionId || null, protocol: "grok-headless-resume", clientUserMessageId: randomUUID() });
    const result = await this.runProcessImpl(this.command, args, {
      cwd: cwd || this.cwd, // 会话项目地址（spawn 型适配器随会话切换工作目录）
      timeoutMs,
      signal,
      onStdout: (chunk) => collector.push(chunk),
    });
    collector.end();
    await Promise.all(pendingEvents);
    if (result.code !== 0 || !resolvedSessionId) {
      const error = new Error(result.stderr.trim() || `grok exited ${result.code} without an end event`);
      error.code = "GROK_BUILD_FAILED";
      throw error;
    }
    return { sessionId: resolvedSessionId, text: finalText, nativePersistence: true, protocol: "grok-headless-resume" };
  }
}
