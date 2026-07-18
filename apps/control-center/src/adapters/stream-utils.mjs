import { StringDecoder } from "node:string_decoder";

export function createLfCollector(onMessage, onParseError = () => {}) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const consume = () => {
    while (true) {
      const index = buffer.indexOf("\n");
      if (index < 0) return;
      let line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line));
      } catch (error) {
        onParseError(error, line);
      }
    }
  };
  return {
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      consume();
    },
    end() {
      buffer += decoder.end();
      if (!buffer.trim()) return;
      try {
        onMessage(JSON.parse(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer));
      } catch (error) {
        onParseError(error, buffer);
      }
    },
  };
}

// 单条事件里工具入参/结果的持久化截断上限——完整呈现 CLI 对话的同时防事件仓被大产物撑爆
const TOOL_PAYLOAD_MAX = 4000;

function clip(value, max = TOOL_PAYLOAD_MAX) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > max ? `${text.slice(0, max)}\n…[截断 ${text.length - max} 字符]` : text;
}

function toolResultText(part) {
  if (typeof part.content === "string") return part.content;
  if (Array.isArray(part.content)) {
    return part.content.filter((item) => item?.type === "text").map((item) => item.text).join("\n");
  }
  return "";
}

export function publicClaudeEvent(event) {
  if (event?.type === "system" && event?.subtype === "init") {
    return { type: "session.started", sessionId: event.session_id, model: event.model || null };
  }
  if (event?.type === "assistant" && Array.isArray(event.message?.content)) {
    const text = event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
    // 与真实 CLI 呈现一致：工具调用保留名字 + 入参（截断），前端渲染 "⏺ Tool(args)" 行
    const tools = event.message.content
      .filter((part) => part.type === "tool_use")
      .map((part) => ({ id: part.id, name: part.name, input: clip(part.input, 600) }));
    return text || tools.length ? { type: "assistant.message", text, tools } : null;
  }
  if (event?.type === "user" && Array.isArray(event.message?.content)) {
    // 工具结果（CLI 回填的 user turn）——完整对话不可缺失的一半
    const results = event.message.content
      .filter((part) => part.type === "tool_result")
      .map((part) => ({ toolUseId: part.tool_use_id || null, isError: Boolean(part.is_error), text: clip(toolResultText(part)) }));
    return results.length ? { type: "tool.result", results } : null;
  }
  if (event?.type === "result") {
    const usage = event.usage || {};
    const tokens =
      (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.output_tokens ?? 0);
    return {
      type: "turn.completed",
      sessionId: event.session_id || null,
      text: typeof event.result === "string" ? event.result : "",
      costUsd: event.total_cost_usd ?? null,
      durationMs: event.duration_ms ?? null,
      tokens: tokens || null, // 状态栏用：本轮总 token（输入+缓存写+缓存读+输出）
      isError: Boolean(event.is_error),
    };
  }
  return null;
}

export function publicCodexEvent(event) {
  if (event?.type === "thread.started") return { type: "session.started", sessionId: event.thread_id };
  if (event?.type === "turn.started") return { type: "turn.started" };
  if (event?.type === "item.started" || event?.type === "item.completed") {
    const item = event.item || {};
    if (item.type === "agent_message") return { type: "assistant.message", text: item.text || "" };
    if (item.type === "command_execution") return { type: "tool.event", tool: "command", status: item.status || null, command: item.command || null };
    if (item.type === "file_change") return { type: "tool.event", tool: "file_change", status: item.status || null };
  }
  if (event?.type === "turn.completed") return { type: "turn.completed", usage: event.usage || null };
  if (event?.type === "error") return { type: "agent.error", message: event.message || "Codex error" };
  return null;
}
