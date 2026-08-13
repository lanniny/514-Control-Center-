import { randomUUID } from "node:crypto";

function responseText(response) {
  if (response?.structuredContent != null) {
    return typeof response.structuredContent === "string"
      ? response.structuredContent
      : JSON.stringify(response.structuredContent, null, 2);
  }
  return (response?.content || [])
    .map((item) => {
      if (typeof item === "string") return item;
      if (typeof item?.text === "string") return item.text;
      return item == null ? "" : JSON.stringify(item);
    })
    .filter(Boolean)
    .join("\n");
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason ?? Object.assign(new Error("Grok MCP operation aborted"), {
      name: "AbortError",
      code: "ABORTED",
    });
  }
}

export class GrokMcpAdapter {
  constructor({ host, eventStore, runtimeProfileId = "grok-search", serverName = "grok-search-rs", toolName = "web_search", requiredEnv = [] }) {
    this.id = "grok-mcp-via-codex-app-server";
    this.runtimeProfileId = runtimeProfileId;
    this.host = host;
    this.eventStore = eventStore;
    this.serverName = serverName;
    this.toolName = toolName;
    this.requiredEnv = requiredEnv;
    this.inventoryThreadId = null;
  }

  async inventory(threadId = null, { signal } = {}) {
    throwIfAborted(signal);
    await this.host.start();
    throwIfAborted(signal);
    let cursor = null;
    do {
      const page = await this.host.request("mcpServerStatus/list", {
        cursor,
        detail: "toolsAndAuthOnly",
        limit: 100,
        threadId,
      }, 30_000, { signal });
      throwIfAborted(signal);
      const server = (page.data || []).find((item) => item.name === this.serverName);
      if (server) return server;
      cursor = page.nextCursor || null;
    } while (cursor);
    return null;
  }

  async health({ signal } = {}) {
    const started = Date.now();
    try {
      throwIfAborted(signal);
      const missing = this.requiredEnv.filter((name) => !process.env[name]);
      if (missing.length) {
        return {
          id: this.runtimeProfileId,
          status: "unconfigured",
          available: false,
          latencyMs: Date.now() - started,
          reason: `missing credential references: ${missing.join(", ")}`,
        };
      }
      // 惰性探针（2026-07-20 LO 爆内存报障）：host 是满配 MCP 的 codex app-server（serena/
      // grok-search 等孙子树，GB 级）——健康检查在每次 bootstrap 都会跑，绝不为它付启动成本。
      // host 未启动 = 休眠可用（env 已验证；工具清单留到真执行时验证，失败仍如实抛）
      if (!this.host.child) {
        return {
          id: this.runtimeProfileId,
          status: "dormant",
          available: true,
          latencyMs: Date.now() - started,
          reason: "credentials configured; MCP host starts on demand (not probed to avoid loading the full MCP tree)",
        };
      }
      this.inventoryThreadId ||= await this.host.createThread({ permissionMode: "read-only", signal });
      const server = await this.inventory(this.inventoryThreadId, { signal });
      throwIfAborted(signal);
      const tool = server?.tools?.[this.toolName];
      if (!server || !tool) {
        return {
          id: this.runtimeProfileId,
          status: "offline",
          available: false,
          latencyMs: Date.now() - started,
          reason: `${this.serverName}/${this.toolName} is not loaded by Codex app-server`,
        };
      }
      return {
        id: this.runtimeProfileId,
        status: "degraded",
        available: true,
        latencyMs: Date.now() - started,
        version: server.serverInfo?.version || "MCP inventory ready",
        reason: "Grok MCP inventory and tool schema are available; remote reachability is verified on execution",
      };
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError" || error?.code === "ABORTED") throw error;
      return {
        id: this.runtimeProfileId,
        status: "offline",
        available: false,
        latencyMs: Date.now() - started,
        reason: error.message,
      };
    }
  }

  async send({ sessionId, prompt, runId, agentId = "grok-search", signal, timeoutMs = 120_000, onSessionStarted, onTurnSubmitting, onTurnAccepted }) {
    if (signal?.aborted) throw Object.assign(new Error("Grok MCP turn aborted"), { code: "ABORTED" });
    const missing = this.requiredEnv.filter((name) => !process.env[name]);
    if (missing.length) throw Object.assign(new Error(`Grok credential references are not configured: ${missing.join(", ")}`), { code: "GROK_MCP_UNAVAILABLE" });
    const threadId = sessionId || (await this.host.createThread({ permissionMode: "read-only", signal, runId, agentId }));
    await this.host.ensureThread(threadId, { signal });
    await onSessionStarted?.({ sessionId: threadId, protocol: "codex-app-server-mcp-v2" });
    const server = await this.inventory(threadId, { signal });
    if (!server?.tools?.[this.toolName]) {
      throw Object.assign(new Error(`${this.serverName}/${this.toolName} is unavailable`), { code: "GROK_MCP_UNAVAILABLE" });
    }
    const clientUserMessageId = randomUUID();
    await onTurnSubmitting?.({ sessionId: threadId, protocol: "codex-app-server-mcp-v2", clientUserMessageId });
    const response = await this.host.request("mcpServer/tool/call", {
      server: this.serverName,
      threadId,
      tool: this.toolName,
      arguments: { query: prompt },
    }, timeoutMs, { signal });
    await onTurnAccepted?.({ sessionId: threadId, protocol: "codex-app-server-mcp-v2", clientUserMessageId });
    if (response?.isError) {
      throw Object.assign(new Error(responseText(response) || "Grok MCP tool returned an error"), { code: "GROK_MCP_FAILED" });
    }
    const text = responseText(response).trim();
    if (!text) throw Object.assign(new Error("Grok MCP tool returned no public result"), { code: "GROK_MCP_EMPTY" });
    await this.eventStore.emit(
      "tool.event",
      { adapter: this.id, type: "mcpServer/tool/call", server: this.serverName, tool: this.toolName },
      { runId, sessionId: threadId, agentId },
    );
    await this.eventStore.emit("assistant.message", { text }, { runId, sessionId: threadId, agentId });
    return { sessionId: threadId, text, nativePersistence: true, protocol: "codex-app-server-mcp-v2" };
  }

  async close() {
    await this.host.close();
  }
}
