import { randomUUID } from "node:crypto";
import { runProcess } from "../process-runner.mjs";
import { createLfCollector, publicCodexEvent } from "./stream-utils.mjs";

export function buildCodexArgs({ sessionId = null, cwd, model = null, effort = null }) {
  const args = ["exec", "-s", "read-only", "-C", cwd];
  if (model) args.push("-m", model);
  if (effort) args.push("-c", `model_reasoning_effort=${JSON.stringify(effort)}`);
  if (sessionId) args.push("resume");
  args.push("--json", "--skip-git-repo-check");
  if (sessionId) args.push(sessionId);
  args.push("-");
  return args;
}

export class CodexCliAdapter {
  supportsPerTurnCwd = true;

  constructor({ command = "codex", model = null, eventStore, cwd, runProcessImpl = runProcess }) {
    this.id = "codex-exec-json";
    this.command = command;
    this.model = model;
    this.eventStore = eventStore;
    this.cwd = cwd;
    this.runProcessImpl = runProcessImpl; // v41：远程 run 注入 SSH 桥（默认本机 runProcess）
  }

  canResume(sessionId) {
    return Boolean(sessionId);
  }

  resumeCommand(sessionId) {
    return sessionId ? `codex exec resume ${sessionId}` : null;
  }

  async send({ sessionId, prompt, runId, agentId = "codex-technical", signal, model = null, effort = null, cwd = null, timeoutMs = 20 * 60_000, onSessionStarted, onTurnSubmitting }) {
    const effectiveCwd = cwd || this.cwd;
    const args = buildCodexArgs({
      sessionId,
      cwd: effectiveCwd,
      model: model || this.model,
      effort,
    });
    let resolvedSessionId = sessionId || null;
    let finalText = "";
    const pendingEvents = [];
    const collector = createLfCollector(
      (event) => {
        const normalized = publicCodexEvent(event);
        if (!normalized) return;
        const previousSessionId = resolvedSessionId;
        resolvedSessionId = normalized.sessionId || resolvedSessionId;
        if (resolvedSessionId && resolvedSessionId !== previousSessionId) {
          pendingEvents.push(onSessionStarted?.({ sessionId: resolvedSessionId, protocol: "exec-json-resume" }));
        }
        if (normalized.type === "assistant.message" && normalized.text) finalText = normalized.text;
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
    if (sessionId) await onSessionStarted?.({ sessionId, protocol: "exec-json-resume" });
    await onTurnSubmitting?.({ sessionId: sessionId || null, protocol: "exec-json-resume", clientUserMessageId: randomUUID() });
    const result = await this.runProcessImpl(this.command, args, {
      cwd: effectiveCwd,
      input: prompt,
      timeoutMs,
      signal,
      onStdout: (chunk) => collector.push(chunk),
    });
    collector.end();
    await Promise.all(pendingEvents);
    if (result.code !== 0 || !resolvedSessionId) {
      const error = new Error(result.stderr.trim() || `Codex exited ${result.code}`);
      error.code = "CODEX_FAILED";
      throw error;
    }
    return { sessionId: resolvedSessionId, text: finalText, nativePersistence: true, protocol: "exec-json-resume" };
  }
}
