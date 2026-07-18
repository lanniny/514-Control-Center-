import { randomUUID } from "node:crypto";
import { runProcess } from "../process-runner.mjs";
import { createLfCollector } from "./stream-utils.mjs";

export class GeminiCliAdapter {
  constructor({ command = "gemini", model = null, eventStore, cwd }) {
    this.id = "gemini-stream-json";
    this.command = command;
    this.model = model;
    this.eventStore = eventStore;
    this.cwd = cwd;
  }

  async send({ sessionId, prompt, runId, signal, timeoutMs = 20 * 60_000, onSessionStarted, onTurnSubmitting }) {
    const nativeSessionId = sessionId || randomUUID();
    const clientUserMessageId = randomUUID();
    const args = ["--approval-mode", "plan", "--output-format", "stream-json"];
    if (this.model) args.push("--model", this.model);
    if (sessionId) args.push("--resume", sessionId);
    else args.push("--session-id", nativeSessionId);
    args.push("--prompt", "");

    let finalText = "";
    const pendingEvents = [];
    const collector = createLfCollector(
      (event) => {
        const type = event.type || event.event;
        const text = event.text || event.content || event.message?.content || "";
        if (typeof text === "string" && text && /message|content|result/i.test(String(type))) finalText += text;
        if (/tool/i.test(String(type))) {
          pendingEvents.push(this.eventStore.emit("tool.event", { adapter: this.id, type, tool: event.name || event.tool_name || null }, { runId, sessionId: nativeSessionId, agentId: "gemini-research" }));
        } else if (typeof text === "string" && text) {
          pendingEvents.push(this.eventStore.emit("assistant.message", { text }, { runId, sessionId: nativeSessionId, agentId: "gemini-research" }));
        }
      },
      (error) => pendingEvents.push(this.eventStore.emit("adapter.parse_error", { adapter: this.id, message: error.message }, { runId, agentId: "gemini-research" })),
    );
    await onSessionStarted?.({ sessionId: nativeSessionId, protocol: "stream-json-resume" });
    await onTurnSubmitting?.({ sessionId: nativeSessionId, protocol: "stream-json-resume", clientUserMessageId });
    const result = await runProcess(this.command, args, {
      cwd: this.cwd,
      input: prompt,
      timeoutMs,
      signal,
      onStdout: (chunk) => collector.push(chunk),
    });
    collector.end();
    await Promise.all(pendingEvents);
    if (result.code !== 0) {
      const error = new Error(result.stderr.trim() || `Gemini exited ${result.code}`);
      error.code = "GEMINI_FAILED";
      throw error;
    }
    return { sessionId: nativeSessionId, text: finalText, nativePersistence: true, protocol: "stream-json-resume", acpAvailable: true };
  }
}
