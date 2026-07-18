import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { attachLfJsonl, encodeJsonLine } from "../src/jsonl.mjs";
import { publicClaudeEvent, publicCodexEvent } from "../src/adapters/stream-utils.mjs";
import { CodexAppServerAdapter } from "../src/adapters/codex-app-server.mjs";
import { GrokMcpAdapter } from "../src/adapters/grok-mcp.mjs";

test("adapter normalizers keep public output and omit thinking", () => {
  assert.equal(publicClaudeEvent({ type: "assistant", message: { content: [{ type: "thinking", thinking: "hidden" }] } }), null);
  assert.deepEqual(publicClaudeEvent({ type: "assistant", message: { content: [{ type: "text", text: "done" }] } }), { type: "assistant.message", text: "done", tools: [] });
  assert.deepEqual(publicCodexEvent({ type: "thread.started", thread_id: "t1" }), { type: "session.started", sessionId: "t1" });
});

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    attachLfJsonl(this.stdin, (message) => this.handle(message));
  }

  reply(id, result) {
    queueMicrotask(() => this.stdout.write(encodeJsonLine({ id, result })));
  }

  handle(message) {
    if (message.method === "initialize") return this.reply(message.id, { codexHome: "C:/mock", platformFamily: "windows", platformOs: "windows", userAgent: "mock" });
    if (message.method === "thread/start") return this.reply(message.id, { thread: { id: "thread-1" } });
    if (message.method === "turn/start") {
      this.reply(message.id, { turn: { id: "turn-1", status: "inProgress", items: [] } });
      setTimeout(() => {
        this.stdout.write(encodeJsonLine({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", delta: "verified" } }));
        this.stdout.write(encodeJsonLine({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [] } } }));
      }, 5);
    }
  }

  kill() {
    this.emit("exit", 0);
    this.emit("close", 0);
  }
}

test("Codex app-server adapter initializes, starts a native thread and receives a turn", async () => {
  const events = [];
  const child = new FakeChild();
  const adapter = new CodexAppServerAdapter({
    eventStore: { emit: async (type, data) => { events.push({ type, data }); } },
    cwd: "C:/repo",
    spawnImpl: () => child,
  });
  const checkpoints = [];
  const result = await adapter.send({
    prompt: "review",
    runId: "run-1",
    permissionMode: "read-only",
    onSessionStarted: async (value) => { checkpoints.push(["session", value.sessionId]); },
    onTurnSubmitting: async (value) => { checkpoints.push(["submitting", value.clientUserMessageId]); },
    onTurnAccepted: async (value) => { checkpoints.push(["accepted", value.turnId]); },
  });
  assert.equal(result.sessionId, "thread-1");
  assert.equal(result.text, "verified");
  assert.equal(result.protocol, "app-server-v2");
  assert.ok(events.some((event) => event.type === "codex.turn/completed"));
  assert.deepEqual(checkpoints.map(([phase]) => phase), ["session", "submitting", "accepted"]);
  await adapter.close();
});

test("Codex app-server close waits for the child exit boundary", async () => {
  class DelayedChild extends FakeChild {
    kill() {
      setTimeout(() => {
        this.emit("exit", 0);
        this.emit("close", 0);
      }, 35);
    }
  }
  const adapter = new CodexAppServerAdapter({
    eventStore: { emit: async () => {} },
    cwd: "C:/repo",
    spawnImpl: () => new DelayedChild(),
  });
  await adapter.start();
  const started = Date.now();
  await adapter.close();
  assert.ok(Date.now() - started >= 25);
});

test("Grok MCP adapter probes inventory and executes web_search through app-server", async () => {
  const calls = [];
  const host = {
    async start() {},
    async createThread() { return "grok-thread"; },
    async ensureThread() {},
    async request(method, params) {
      calls.push({ method, params });
      if (method === "mcpServerStatus/list") {
        return {
          data: [{ name: "grok-search-rs", tools: { web_search: { name: "web_search", inputSchema: { type: "object" } } } }],
          nextCursor: null,
        };
      }
      if (method === "mcpServer/tool/call") return { content: [{ type: "text", text: "current result\nhttps://example.com" }], isError: false };
      throw new Error(`unexpected method ${method}`);
    },
  };
  const adapter = new GrokMcpAdapter({ host, eventStore: { emit: async () => {} } });
  const health = await adapter.health();
  assert.equal(health.available, true);
  const checkpoints = [];
  const result = await adapter.send({
    prompt: "latest evidence",
    runId: "run-grok",
    onSessionStarted: async () => checkpoints.push("session"),
    onTurnSubmitting: async () => checkpoints.push("submitting"),
    onTurnAccepted: async () => checkpoints.push("accepted"),
  });
  assert.equal(result.protocol, "codex-app-server-mcp-v2");
  assert.match(result.text, /example\.com/);
  assert.deepEqual(checkpoints, ["session", "submitting", "accepted"]);
  assert.equal(calls.find((call) => call.method === "mcpServer/tool/call").params.arguments.query, "latest evidence");
});

test("Codex app-server marks a transport failure after turn submission as unsafe to replay", async () => {
  class AmbiguousChild extends FakeChild {
    handle(message) {
      if (message.method !== "turn/start") return super.handle(message);
      this.turnStart = message;
      queueMicrotask(() => this.emit("exit", 17));
    }
  }
  const child = new AmbiguousChild();
  const adapter = new CodexAppServerAdapter({
    eventStore: { emit: async () => {} },
    cwd: "C:/repo",
    spawnImpl: () => child,
  });
  await assert.rejects(
    () => adapter.send({ prompt: "write once", runId: "run-ambiguous", permissionMode: "read-only" }),
    (error) => {
      assert.equal(error.code, "APP_SERVER_EXIT");
      assert.equal(error.safeToFallback, false);
      assert.equal(error.codexPhase, "turn-submitted-or-unknown");
      assert.equal(error.sessionId, "thread-1");
      assert.equal(error.clientUserMessageId, child.turnStart.params.clientUserMessageId);
      return true;
    },
  );
});

test("Codex app-server setup failure is explicitly safe for CLI fallback", async () => {
  const adapter = new CodexAppServerAdapter({
    eventStore: { emit: async () => {} },
    cwd: "C:/repo",
    spawnImpl: () => { throw Object.assign(new Error("missing executable"), { code: "ENOENT" }); },
  });
  await assert.rejects(
    () => adapter.send({ prompt: "review", runId: "run-setup", permissionMode: "read-only" }),
    (error) => error.code === "ENOENT" && error.safeToFallback === true && error.codexPhase === "session-setup",
  );
});
