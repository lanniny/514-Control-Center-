import { randomUUID } from "node:crypto";
import { attachLfJsonl, encodeJsonLine } from "../jsonl.mjs";
import { childProcessEnv, spawnCommand, terminateChildProcess, terminateChildProcessAndWait } from "../process-runner.mjs";

const APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "execCommandApproval",
  "applyPatchApproval",
  "item/permissions/requestApproval",
]);

export class CodexAppServerAdapter {
  constructor({ command = "codex", model = null, eventStore, cwd, approvalResolver = null, spawnImpl = spawnCommand, disableMcp = true }) {
    this.id = "codex-app-server";
    this.command = command;
    this.model = model;
    this.eventStore = eventStore;
    this.cwd = cwd;
    this.approvalResolver = approvalResolver;
    this.spawnImpl = spawnImpl;
    this.disableMcp = disableMcp;
    this.child = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.loadedThreads = new Set();
    this.activeByThread = new Map();
    this.startPromise = null;
  }

  write(message) {
    if (!this.child?.stdin?.writable) throw new Error("Codex app-server is not writable");
    this.child.stdin.write(encodeJsonLine(message));
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    if (this.child) return;
    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async startInternal() {
    const args = ["-c", "features.code_mode_host=false"];
    if (this.disableMcp) args.push("-c", "mcp_servers={}");
    args.push("app-server", "--stdio");
    const child = this.spawnImpl(this.command, args, {
      cwd: this.cwd,
      env: childProcessEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    this.child = child;
    attachLfJsonl(
      child.stdout,
      (message) => this.handleMessage(message),
      (error, line) => this.eventStore.emit("adapter.parse_error", { adapter: this.id, message: error.message, sample: line.slice(0, 240) }, { agentId: "codex-technical" }),
    );
    child.once("error", (error) => {
      if (this.child === child) this.failAll(error);
    });
    child.once("exit", (code) => {
      if (this.child !== child) return;
      const error = new Error(`Codex app-server exited ${code}`);
      error.code = "APP_SERVER_EXIT";
      this.failAll(error);
      this.child = null;
    });
    child.stderr.on("data", (chunk) => {
      const message = chunk.toString("utf8").trim();
      if (message) this.eventStore.emit("adapter.stderr", { adapter: this.id, message: message.slice(-2000) }, { agentId: "codex-technical" });
    });
    try {
      await this.request("initialize", {
        clientInfo: { name: "514cc-control-center", title: "514cc Control Center", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
      this.write({ method: "initialized", params: {} });
    } catch (error) {
      terminateChildProcess(child);
      if (this.child === child) this.child = null;
      throw error;
    }
  }

  request(method, params, timeoutMs = 30_000) {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`${method} timed out`);
        error.code = "APP_SERVER_TIMEOUT";
        reject(error);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  handleMessage(message) {
    if (Object.hasOwn(message, "id") && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(Object.assign(new Error(message.error.message || "app-server error"), { code: message.error.code }));
      else pending.resolve(message.result);
      return;
    }
    if (Object.hasOwn(message, "id") && message.method) {
      void this.handleServerRequest(message);
      return;
    }
    if (message.method) this.handleNotification(message.method, message.params || {});
  }

  async handleServerRequest(message) {
    if (!APPROVAL_METHODS.has(message.method)) {
      await this.eventStore.emit(
        "adapter.server_request_unsupported",
        { adapter: this.id, method: message.method, requestId: message.id },
        { agentId: "codex-technical", sensitivity: "internal" },
      ).catch(() => {});
      try { this.write({ id: message.id, error: { code: -32601, message: `unsupported server request: ${message.method}` } }); } catch {}
      return;
    }
    await this.eventStore.emit(
      "approval.requested",
      { adapter: this.id, method: message.method, requestId: message.id, summary: "Codex requested an operator decision" },
      { agentId: "codex-technical", sensitivity: "sensitive" },
    ).catch(() => {});
    try {
      const threadId = message.params?.threadId || null;
      const active = threadId ? this.activeByThread.get(threadId) : null;
      let result = await this.approvalResolver?.(message, {
        runId: active?.runId || null,
        sessionId: threadId,
      });
      if (result == null) {
        if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(message.method)) result = { decision: "decline" };
        else throw Object.assign(new Error("approval requires an interactive operator"), { code: -32001 });
      }
      try { this.write({ id: message.id, result }); } catch {}
    } catch (error) {
      try { this.write({ id: message.id, error: { code: Number(error.code) || -32001, message: error.message } }); } catch {}
    }
  }

  handleNotification(method, params) {
    const threadId = params.threadId || params.thread?.id || null;
    const active = threadId ? this.activeByThread.get(threadId) : null;
    if (method === "item/agentMessage/delta" && active && typeof params.delta === "string") active.text += params.delta;
    if (method === "item/completed" && active) {
      const item = params.item || {};
      if ((item.type === "agentMessage" || item.type === "agent_message") && typeof item.text === "string") active.text = item.text;
    }
    if (method === "turn/completed" && active) {
      clearTimeout(active.timer);
      this.activeByThread.delete(threadId);
      const error = params.turn?.error?.message;
      if (error) active.reject(new Error(error));
      else active.resolve({ sessionId: threadId, text: active.text, turn: params.turn, nativePersistence: true, protocol: "app-server-v2" });
    }
    if (!method.startsWith("item/reasoning/")) {
      void this.eventStore.emit(
        `codex.${method}`,
        { method, threadId, turnId: params.turnId || params.turn?.id || null, itemType: params.item?.type || null, delta: method === "item/agentMessage/delta" ? params.delta : undefined },
        { runId: active?.runId || null, sessionId: threadId, agentId: "codex-technical" },
      );
    }
  }

  async createThread({ permissionMode = "read-only" } = {}) {
    await this.start();
    const result = await this.request("thread/start", {
      cwd: this.cwd,
      model: this.model,
      sandbox: permissionMode === "workspace-write" ? "workspace-write" : "read-only",
      approvalPolicy: "on-request",
      experimentalRawEvents: false,
      developerInstructions: "You are the technical executor and verifier in a Claude-led 514cc run. Report evidence and ask precise questions when blocked.",
    });
    const threadId = result.thread.id;
    this.loadedThreads.add(threadId);
    return threadId;
  }

  async ensureThread(threadId) {
    await this.start();
    if (this.loadedThreads.has(threadId)) return;
    await this.request("thread/resume", { threadId });
    this.loadedThreads.add(threadId);
  }

  async send({
    sessionId,
    prompt,
    runId,
    signal,
    permissionMode = "read-only",
    effort = "xhigh",
    timeoutMs = 20 * 60_000,
    onSessionStarted,
    onTurnSubmitting,
    onTurnAccepted,
  }) {
    let threadId = sessionId || null;
    let turnSubmissionAttempted = false;
    try {
      threadId = threadId || (await this.createThread({ permissionMode }));
      await this.ensureThread(threadId);
      await onSessionStarted?.({ sessionId: threadId, protocol: "app-server-v2" });
    } catch (error) {
      error.codexPhase = "session-setup";
      error.safeToFallback = true;
      error.sessionId = threadId;
      throw error;
    }
    if (this.activeByThread.has(threadId)) throw Object.assign(new Error("thread already has an active turn"), { code: "TURN_ACTIVE" });
    const clientUserMessageId = randomUUID();
    let abortHandler;
    const turnPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const current = this.activeByThread.get(threadId);
        if (current?.turnId) void this.request("turn/interrupt", { threadId, turnId: current.turnId }).catch(() => {});
        this.activeByThread.delete(threadId);
        reject(Object.assign(new Error("Codex turn timed out"), { code: "TURN_TIMEOUT" }));
      }, timeoutMs);
      this.activeByThread.set(threadId, { resolve, reject, timer, text: "", runId, turnId: null });
    });
    void turnPromise.catch(() => {});
    try {
      // Once this request is written, a transport failure cannot prove that the
      // turn was not accepted. The caller must not replay the prompt blindly.
      turnSubmissionAttempted = true;
      await onTurnSubmitting?.({
        sessionId: threadId,
        protocol: "app-server-v2",
        clientUserMessageId,
      });
      const started = await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        clientUserMessageId,
        effort,
        approvalPolicy: "on-request",
      });
      const active = this.activeByThread.get(threadId);
      if (active) active.turnId = started.turn?.id || null;
      await onTurnAccepted?.({
        sessionId: threadId,
        protocol: "app-server-v2",
        clientUserMessageId,
        turnId: started.turn?.id || null,
      });
      abortHandler = () => {
        const current = this.activeByThread.get(threadId);
        if (current?.turnId) void this.request("turn/interrupt", { threadId, turnId: current.turnId }).catch(() => {});
        if (current) {
          clearTimeout(current.timer);
          this.activeByThread.delete(threadId);
          current.reject(Object.assign(new Error("Codex turn aborted"), { code: "ABORTED" }));
        }
      };
      signal?.addEventListener("abort", abortHandler, { once: true });
      if (signal?.aborted) abortHandler();
      return await turnPromise;
    } catch (error) {
      const active = this.activeByThread.get(threadId);
      if (active) {
        clearTimeout(active.timer);
        this.activeByThread.delete(threadId);
      }
      error.codexPhase = turnSubmissionAttempted ? "turn-submitted-or-unknown" : "session-ready";
      error.safeToFallback = !turnSubmissionAttempted;
      error.sessionId = threadId;
      error.clientUserMessageId = clientUserMessageId;
      throw error;
    } finally {
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
    }
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const active of this.activeByThread.values()) {
      clearTimeout(active.timer);
      active.reject(error);
    }
    this.activeByThread.clear();
    this.loadedThreads.clear();
  }

  async close() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.failAll(Object.assign(new Error("Codex app-server closed"), { code: "ABORTED" }));
    child.stdin?.end?.();
    await terminateChildProcessAndWait(child);
  }
}
