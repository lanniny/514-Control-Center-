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

export class GrokMcpAdapter {
  constructor({ host, eventStore, serverName = "grok-search-rs", toolName = "web_search", requiredEnv = [] }) {
    this.id = "grok-mcp-via-codex-app-server";
    this.host = host;
    this.eventStore = eventStore;
    this.serverName = serverName;
    this.toolName = toolName;
    this.requiredEnv = requiredEnv;
    this.inventoryThreadId = null;
  }

  async inventory(threadId = null) {
    await this.host.start();
    let cursor = null;
    do {
      const page = await this.host.request("mcpServerStatus/list", {
        cursor,
        detail: "toolsAndAuthOnly",
        limit: 100,
        threadId,
      }, 30_000);
      const server = (page.data || []).find((item) => item.name === this.serverName);
      if (server) return server;
      cursor = page.nextCursor || null;
    } while (cursor);
    return null;
  }

  async health() {
    const started = Date.now();
    try {
      const missing = this.requiredEnv.filter((name) => !process.env[name]);
      if (missing.length) {
        return {
          id: "grok-search",
          status: "unconfigured",
          available: false,
          latencyMs: Date.now() - started,
          reason: `missing credential references: ${missing.join(", ")}`,
        };
      }
      this.inventoryThreadId ||= await this.host.createThread({ permissionMode: "read-only" });
      const server = await this.inventory(this.inventoryThreadId);
      const tool = server?.tools?.[this.toolName];
      if (!server || !tool) {
        return {
          id: "grok-search",
          status: "offline",
          available: false,
          latencyMs: Date.now() - started,
          reason: `${this.serverName}/${this.toolName} is not loaded by Codex app-server`,
        };
      }
      return {
        id: "grok-search",
        status: "degraded",
        available: true,
        latencyMs: Date.now() - started,
        version: server.serverInfo?.version || "MCP inventory ready",
        reason: "Grok MCP inventory and tool schema are available; remote reachability is verified on execution",
      };
    } catch (error) {
      return {
        id: "grok-search",
        status: "offline",
        available: false,
        latencyMs: Date.now() - started,
        reason: error.message,
      };
    }
  }

  async send({ sessionId, prompt, runId, signal, timeoutMs = 120_000, onSessionStarted, onTurnSubmitting, onTurnAccepted }) {
    if (signal?.aborted) throw Object.assign(new Error("Grok MCP turn aborted"), { code: "ABORTED" });
    const missing = this.requiredEnv.filter((name) => !process.env[name]);
    if (missing.length) throw Object.assign(new Error(`Grok credential references are not configured: ${missing.join(", ")}`), { code: "GROK_MCP_UNAVAILABLE" });
    const threadId = sessionId || (await this.host.createThread({ permissionMode: "read-only" }));
    await this.host.ensureThread(threadId);
    await onSessionStarted?.({ sessionId: threadId, protocol: "codex-app-server-mcp-v2" });
    const server = await this.inventory(threadId);
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
    }, timeoutMs);
    await onTurnAccepted?.({ sessionId: threadId, protocol: "codex-app-server-mcp-v2", clientUserMessageId });
    if (response?.isError) {
      throw Object.assign(new Error(responseText(response) || "Grok MCP tool returned an error"), { code: "GROK_MCP_FAILED" });
    }
    const text = responseText(response).trim();
    if (!text) throw Object.assign(new Error("Grok MCP tool returned no public result"), { code: "GROK_MCP_EMPTY" });
    await this.eventStore.emit(
      "tool.event",
      { adapter: this.id, type: "mcpServer/tool/call", server: this.serverName, tool: this.toolName },
      { runId, sessionId: threadId, agentId: "grok-search" },
    );
    await this.eventStore.emit("assistant.message", { text }, { runId, sessionId: threadId, agentId: "grok-search" });
    return { sessionId: threadId, text, nativePersistence: true, protocol: "codex-app-server-mcp-v2" };
  }

  async close() {
    await this.host.close();
  }
}
