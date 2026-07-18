import { randomUUID } from "node:crypto";
import { attachLfJsonl, encodeJsonLine } from "../jsonl.mjs";
import { childProcessEnv, spawnCommand, terminateChildProcess, terminateChildProcessAndWait } from "../process-runner.mjs";

export class PiRpcAdapter {
  constructor({ command = "pi", model = null, eventStore, cwd, spawnImpl = spawnCommand }) {
    this.id = "pi-rpc";
    this.command = command;
    this.model = model;
    this.eventStore = eventStore;
    this.cwd = cwd;
    this.spawnImpl = spawnImpl;
    this.processes = new Map();
  }

  async createSession(runId, requestedSessionId = null) {
    const sessionId = requestedSessionId || randomUUID();
    const args = [
      "--mode",
      "rpc",
      "--no-approve",
      "--tools",
      "read,grep,find,ls",
      "--session-id",
      sessionId,
      "--name",
      `514cc-${runId?.slice(0, 8) || sessionId.slice(0, 8)}`,
    ];
    if (this.model) args.push("--model", this.model);
    const child = this.spawnImpl(this.command, args, {
      cwd: this.cwd,
      env: childProcessEnv({ PI_OFFLINE: process.env.PI_OFFLINE || "1" }),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    const state = { child, sessionId, nextId: 1, pending: new Map(), active: null, runId };
    this.processes.set(sessionId, state);
    attachLfJsonl(child.stdout, (message) => this.handleMessage(state, message), (error) => {
      void this.eventStore.emit("adapter.parse_error", { adapter: this.id, message: error.message }, { runId, sessionId, agentId: "pi-resident" });
    });
    child.once("error", (error) => this.fail(state, error));
    child.once("exit", (code) => this.fail(state, new Error(`Pi RPC exited ${code}`)));
    child.stderr.on("data", (chunk) => {
      const message = chunk.toString("utf8").trim();
      if (message) void this.eventStore.emit("adapter.stderr", { adapter: this.id, message: message.slice(-2000) }, { runId, sessionId, agentId: "pi-resident" });
    });
    return sessionId;
  }

  handleMessage(state, message) {
    if (message.type === "response" && message.id != null) {
      const pending = state.pending.get(message.id);
      if (pending) {
        state.pending.delete(message.id);
        message.success ? pending.resolve(message) : pending.reject(new Error(message.error || "Pi command rejected"));
      }
      return;
    }
    if (message.type === "message_update" && message.assistantMessageEvent?.type === "text_delta" && state.active) {
      state.active.text += message.assistantMessageEvent.delta || "";
    }
    if (/tool_execution_(?:start|end)/.test(message.type || "")) {
      void this.eventStore.emit("tool.event", { adapter: this.id, type: message.type, tool: message.toolName || message.tool || null }, { runId: state.runId, sessionId: state.sessionId, agentId: "pi-resident" });
    }
    if (message.type === "agent_end" && state.active) {
      const active = state.active;
      state.active = null;
      clearTimeout(active.timer);
      void this.eventStore.emit("assistant.message", { text: active.text }, { runId: state.runId, sessionId: state.sessionId, agentId: "pi-resident" });
      active.resolve({ sessionId: state.sessionId, text: active.text, nativePersistence: true, protocol: "pi-rpc" });
    }
  }

  commandRequest(state, payload, timeoutMs = 30_000) {
    const id = `cc-${state.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error(`${payload.type} response timed out`));
      }, timeoutMs);
      state.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      state.child.stdin.write(encodeJsonLine({ id, ...payload }));
    });
  }

  async send({ sessionId, prompt, runId, signal, timeoutMs = 20 * 60_000, onSessionStarted, onTurnSubmitting, onTurnAccepted }) {
    const resolvedSessionId = sessionId || (await this.createSession(runId));
    if (sessionId && !this.processes.has(sessionId)) await this.createSession(runId, sessionId);
    const state = this.processes.get(resolvedSessionId);
    if (!state) throw Object.assign(new Error("Pi session is not loaded in this control-plane process"), { code: "SESSION_NOT_LOADED" });
    if (state.active) throw Object.assign(new Error("Pi session already has an active turn"), { code: "TURN_ACTIVE" });
    await onSessionStarted?.({ sessionId: resolvedSessionId, protocol: "pi-rpc" });
    state.runId = runId;
    const clientUserMessageId = randomUUID();
    const turn = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.active = null;
        reject(Object.assign(new Error("Pi turn timed out"), { code: "TURN_TIMEOUT" }));
      }, timeoutMs);
      state.active = { resolve, reject, timer, text: "" };
    });
    const abort = () => state.child.stdin.write(encodeJsonLine({ type: "abort" }));
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await onTurnSubmitting?.({ sessionId: resolvedSessionId, protocol: "pi-rpc", clientUserMessageId });
      await this.commandRequest(state, { type: "prompt", message: prompt });
      await onTurnAccepted?.({ sessionId: resolvedSessionId, protocol: "pi-rpc", clientUserMessageId });
      return await turn;
    } catch (error) {
      if (state.active) {
        clearTimeout(state.active.timer);
        state.active = null;
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  fail(state, error) {
    for (const pending of state.pending.values()) pending.reject(error);
    state.pending.clear();
    if (state.active) {
      clearTimeout(state.active.timer);
      state.active.reject(error);
      state.active = null;
    }
    this.processes.delete(state.sessionId);
  }

  async close() {
    const closures = [];
    for (const state of this.processes.values()) {
      try { state.child.stdin.write(encodeJsonLine({ type: "abort" })); } catch {}
      closures.push(terminateChildProcessAndWait(state.child));
    }
    this.processes.clear();
    await Promise.allSettled(closures);
  }
}
