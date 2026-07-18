// Kimi Code CLI 适配器（前端工程师成员，2026-07-19 本机 0.27.0 实测）：
// headless `kimi -p <prompt> --output-format stream-json`，事件两型：
//   {"role":"assistant","content":"..."} 文本段 /
//   {"role":"meta","type":"session.resume_hint","session_id":"session_xxx",...} 会话 ID。
// 续轮 `-S <sessionId>`（实测续接保留上下文）；session 绑定创建目录——resume 必须在同 cwd，
// run.cwd 固化不变恰好天然满足该约束。会话由 kimi 自身持久化（~/.kimi-code）。
// 权限映射：plan/read-only 轮 --plan（只读规划）；经审批的 workspace-write 轮 --auto（auto permission）。
import { randomUUID } from "node:crypto";
import { runProcess } from "../process-runner.mjs";
import { createLfCollector } from "./stream-utils.mjs";

export function buildKimiArgs({ prompt, sessionId = null, model = null }) {
  // kimi 0.27.0 实测：-p 与 --plan/--auto/--yolo 全部互斥——headless 只能用 CLI 默认权限行为。
  // workspace-write 轮无法机械授予受控写权限，由 send() 前置 fail-closed 拒绝（不静默降级）。
  const args = ["-p", prompt, "--output-format", "stream-json"];
  if (sessionId) args.push("-S", sessionId);
  if (model) args.push("-m", model);
  return args;
}

export class KimiCliAdapter {
  constructor({ command = "kimi", model = null, eventStore, cwd }) {
    this.id = "kimi-headless-resume";
    this.command = command;
    this.model = model;
    this.eventStore = eventStore;
    this.cwd = cwd;
  }

  async send({ sessionId, prompt, runId, signal, permissionMode = "plan", timeoutMs = 15 * 60_000, cwd = null, onSessionStarted, onTurnSubmitting }) {
    // 受控写权限 fail-closed：-p 模式无任何权限旗标可用，授不出去就不假装授了
    if (permissionMode === "workspace-write") {
      const error = new Error("kimi headless prompt mode cannot grant controlled write permission (-p excludes --plan/--auto/--yolo); dispatch write turns to codex or claude instead");
      error.code = "UNSUPPORTED_PERMISSION";
      throw error;
    }
    // Windows 命令行长度上限约 32K；-p 传参超限时如实拒绝而非静默截断（与 grok 适配器同约束）
    if (prompt.length > 24_000) {
      const error = new Error("prompt exceeds the kimi -p argument budget (24k chars); split the task instead");
      error.code = "INVALID_PROMPT";
      throw error;
    }
    const args = buildKimiArgs({ prompt, sessionId, model: this.model });
    let resolvedSessionId = sessionId || null;
    const textParts = [];
    const pendingEvents = [];
    const collector = createLfCollector(
      (event) => {
        if (event?.role === "assistant" && typeof event.content === "string" && event.content) {
          textParts.push(event.content);
          pendingEvents.push(
            this.eventStore.emit("assistant.message", { text: event.content }, { runId, sessionId: resolvedSessionId, agentId: "kimi-frontend" }),
          );
          return;
        }
        if (event?.role === "meta" && event.type === "session.resume_hint" && event.session_id) {
          const previousSessionId = resolvedSessionId;
          resolvedSessionId = event.session_id;
          if (resolvedSessionId !== previousSessionId) {
            pendingEvents.push(onSessionStarted?.({ sessionId: resolvedSessionId, protocol: "kimi-headless-resume" }));
          }
          return;
        }
        // 未知事件形态（未来的工具/状态型 role）宽容降级为工具活动行，不静默丢弃
        if (event?.role && event.role !== "assistant" && event.role !== "meta") {
          pendingEvents.push(
            this.eventStore.emit(
              "tool.event",
              { tool: String(event.role), status: String(event.type || ""), command: String(event.content ?? "").slice(0, 200) },
              { runId, sessionId: resolvedSessionId, agentId: "kimi-frontend" },
            ),
          );
        }
      },
      (error) =>
        pendingEvents.push(
          this.eventStore.emit("adapter.parse_error", { adapter: this.id, message: error.message }, { runId, agentId: "kimi-frontend" }),
        ),
    );
    if (sessionId) await onSessionStarted?.({ sessionId, protocol: "kimi-headless-resume" });
    await onTurnSubmitting?.({ sessionId: sessionId || null, protocol: "kimi-headless-resume", clientUserMessageId: randomUUID() });
    const result = await runProcess(this.command, args, {
      cwd: cwd || this.cwd, // 会话项目地址（kimi session 绑定创建目录，同 run 恒同 cwd）
      timeoutMs,
      signal,
      onStdout: (chunk) => collector.push(chunk),
    });
    collector.end();
    await Promise.all(pendingEvents);
    if (result.code !== 0 || !resolvedSessionId) {
      let message = result.stderr.trim() || `kimi exited ${result.code} without a session id`;
      if (/login|auth|unauthorized|expired/i.test(message)) {
        message = `${message} — 在任意终端运行 kimi login 完成设备码登录后重试。`;
      }
      const error = new Error(message);
      error.code = "KIMI_FAILED";
      throw error;
    }
    return { sessionId: resolvedSessionId, text: textParts.join("\n\n"), nativePersistence: true, protocol: "kimi-headless-resume" };
  }
}
