import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { sanitizeForPersistence } from "./redaction.mjs";

export class EventStore {
  constructor(path) {
    this.path = path;
    this.sequence = 0;
    this.subscribers = new Set();
    this.writeChain = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const content = await readFile(this.path, "utf8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          this.sequence = Math.max(this.sequence, Number(event.sequence) || 0);
        } catch {
          // A malformed historical line is ignored but never overwritten.
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return this;
  }

  async emit(type, data = {}, context = {}) {
    const event = sanitizeForPersistence({
      schemaVersion: 1,
      eventId: randomUUID(),
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      type,
      runId: context.runId ?? null,
      sessionId: context.sessionId ?? null,
      parentSessionId: context.parentSessionId ?? null,
      agentId: context.agentId ?? null,
      correlationId: context.correlationId ?? null,
      causationId: context.causationId ?? null,
      sensitivity: context.sensitivity ?? "internal",
      data,
    });
    const line = `${JSON.stringify(event)}\n`;
    const write = this.writeChain.catch(() => {}).then(() => appendFile(this.path, line, "utf8"));
    this.writeChain = write;
    await write;
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch {
        this.subscribers.delete(subscriber);
      }
    }
    return event;
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async close() {
    await this.writeChain.catch(() => {});
    this.subscribers.clear();
  }

  async list(limit = 200, { afterSequence = 0 } = {}) {
    try {
      const content = await readFile(this.path, "utf8");
      const events = [];
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if ((Number(event.sequence) || 0) > afterSequence) events.push(event);
        } catch {
          // Preserve malformed historical lines for forensic inspection.
        }
      }
      return events.slice(-Math.max(1, Math.min(limit, 2000)));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  // 按 run 全量回放（per-run 事件端点）——从磁盘读全量再过滤 runId，不受全局最近窗口限制，
  // 供长会话/重启后重建完整对话历史（含工具过程）。
  async listByRun(runId, limit = 5000) {
    const cappedLimit = Math.max(1, Math.min(limit, 10000));
    try {
      const content = await readFile(this.path, "utf8");
      const events = [];
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (String(event.runId) === String(runId)) events.push(event);
        } catch {
          // 保留损坏历史行供取证
        }
      }
      return events.slice(-cappedLimit);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async replay(afterSequence = 0, limit = 2000) {
    const cappedLimit = Math.max(1, Math.min(limit, 2000));
    try {
      const content = await readFile(this.path, "utf8");
      const events = [];
      let matched = 0;
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if ((Number(event.sequence) || 0) <= afterSequence) continue;
          matched += 1;
          if (events.length < cappedLimit) events.push(event);
        } catch {
          // Preserve malformed historical lines for forensic inspection.
        }
      }
      return { events, hasMore: matched > events.length, matched };
    } catch (error) {
      if (error.code === "ENOENT") return { events: [], hasMore: false, matched: 0 };
      throw error;
    }
  }
}
