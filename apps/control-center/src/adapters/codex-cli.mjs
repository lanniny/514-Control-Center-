import { randomUUID } from "node:crypto";
import { runProcess } from "../process-runner.mjs";
import { createLfCollector, publicCodexEvent } from "./stream-utils.mjs";

export function buildCodexArgs({ sessionId = null, cwd, model = null }) {
  const args = ["exec", "-s", "read-only", "-C", cwd];
  if (model) args.push("-m", model);
  if (sessionId) args.push("resume");
  args.push("--json", "--skip-git-repo-check");
  if (sessionId) args.push(sessionId);
  args.push("-");
  return args;
}

export class CodexCliAdapter {
  constructor({ command = "codex", model = null, eventStore, cwd }) {
    this.id = "codex-exec-json";
    this.command = command;
    this.model = model;
    this.eventStore = eventStore;
    this.cwd = cwd;
  }

  async send({ sessionId, prompt, runId, signal, timeoutMs = 20 * 60_000, onSessionStarted, onTurnSubmitting }) {
    const args = buildCodexArgs({ sessionId, cwd: this.cwd, model: this.model });
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
            agentId: "codex-technical",
          }),
        );
      },
      (error) => pendingEvents.push(this.eventStore.emit("adapter.parse_error", { adapter: this.id, message: error.message }, { runId, agentId: "codex-technical" })),
    );
    if (sessionId) await onSessionStarted?.({ sessionId, protocol: "exec-json-resume" });
    await onTurnSubmitting?.({ sessionId: sessionId || null, protocol: "exec-json-resume", clientUserMessageId: randomUUID() });
    const result = await runProcess(this.command, args, {
      cwd: this.cwd,
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
