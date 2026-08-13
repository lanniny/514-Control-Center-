/**
 * channels.mjs — Wave G 渠道核心（Telegram 长轮询 + 双向 webhook）。
 *
 * 契约（v40 设计 §3.1）：
 *   - 渠道 CRUD 原子持久化；secret/token 绝不进响应与日志
 *   - webhook_out：HMAC-SHA256 签名头 fire-and-forget
 *   - webhook_in：HMAC 验签 + 每渠道 60/min 内存限流
 *   - Telegram：注入式 fetch（测试 mock），offset 持久化防重
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const CHANNEL_TYPES = new Set(["telegram", "webhook_out", "webhook_in"]);
const EVENTS_CAP = 500;
const RATE_LIMIT_PER_MIN = 60;

function channelError(code, message, httpStatus = 400) {
  return Object.assign(new Error(message), { code, httpStatus });
}

function hmacSha256(secret, payload) {
  return createHmac("sha256", String(secret)).update(String(payload)).digest("hex");
}

function secureEqualHex(a, b) {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** 响应白名单：剥离一切密钥面字段。 */
export function publicChannel(channel) {
  if (!channel) return null;
  const { config = {}, ...rest } = channel;
  const safeConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (/token|secret|password|key/i.test(key)) {
      safeConfig[key] = value ? "***" : "";
    } else {
      safeConfig[key] = value;
    }
  }
  return { ...rest, config: safeConfig };
}

export function createChannelService({ dataRoot, eventStore = null, fetchImpl = globalThis.fetch, pollIdleMs = 500 } = {}) {
  const root = String(dataRoot);
  const storePath = join(root, "channels.json");
  const eventsPath = join(root, "channel-events.jsonl");
  const state = {
    channels: new Map(),
    writeChain: Promise.resolve(),
    pollers: new Map(), // channelId → { stopped, promise }
    rateBuckets: new Map(), // channelId → { minute, count }
    events: [],
  };

  function audit(type, detail) {
    void eventStore?.emit?.(type, detail, { sensitivity: "internal", agentId: "control-plane" })?.catch?.(() => {});
  }

  async function recordEvent(entry) {
    const event = { at: new Date().toISOString(), ...entry };
    state.events.push(event);
    if (state.events.length > EVENTS_CAP) state.events.splice(0, state.events.length - EVENTS_CAP);
    await appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8").catch(() => {});
    audit(`channels.${entry.kind || "event"}`, { channelId: entry.channelId, type: entry.type });
  }

  function persist() {
    const payload = JSON.stringify({ schema: "514cc.channels/v1", channels: [...state.channels.values()] }, null, 2);
    state.writeChain = state.writeChain.then(async () => {
      await mkdir(dirname(storePath), { recursive: true });
      const tmp = `${storePath}.tmp`;
      await writeFile(tmp, payload, "utf8");
      await rename(tmp, storePath);
    });
    return state.writeChain;
  }

  async function init() {
    let parsed = null;
    try {
      parsed = JSON.parse(await readFile(storePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const channel of parsed?.channels ?? []) {
      if (channel?.id && CHANNEL_TYPES.has(channel.type)) state.channels.set(channel.id, channel);
    }
    for (const channel of state.channels.values()) {
      if (channel.type === "telegram" && channel.enabled) startTelegramPoller(channel.id);
    }
    return service;
  }

  function list() {
    return [...state.channels.values()].map(publicChannel);
  }

  function getRaw(id) {
    return state.channels.get(String(id)) ?? null;
  }

  async function create({ type, name, config = {}, enabled = false } = {}) {
    if (!CHANNEL_TYPES.has(type)) throw channelError("CHANNEL_BAD_TYPE", `type must be one of ${[...CHANNEL_TYPES].join("/")}`);
    if (type === "telegram" && !config.token) throw channelError("CHANNEL_CONFIG", "telegram channel requires config.token");
    if (type === "webhook_out" && !config.url) throw channelError("CHANNEL_CONFIG", "webhook_out channel requires config.url");
    if (type === "webhook_in" && !config.secret) throw channelError("CHANNEL_CONFIG", "webhook_in channel requires config.secret");
    const channel = {
      id: randomUUID().slice(0, 8),
      type,
      name: String(name || type),
      enabled: Boolean(enabled),
      config: { ...config },
      createdAt: new Date().toISOString(),
    };
    state.channels.set(channel.id, channel);
    await persist();
    audit("channels.create", { channelId: channel.id, type });
    if (channel.type === "telegram" && channel.enabled) startTelegramPoller(channel.id);
    return publicChannel(channel);
  }

  async function update(id, patch = {}) {
    const channel = getRaw(id);
    if (!channel) throw channelError("CHANNEL_NOT_FOUND", `channel not found: ${id}`, 404);
    if (patch.name != null) channel.name = String(patch.name);
    if (patch.config && typeof patch.config === "object") channel.config = { ...channel.config, ...patch.config };
    if (patch.enabled != null) channel.enabled = Boolean(patch.enabled);
    await persist();
    if (channel.type === "telegram") {
      stopTelegramPoller(channel.id);
      if (channel.enabled) startTelegramPoller(channel.id);
    }
    audit("channels.update", { channelId: channel.id, enabled: channel.enabled });
    return publicChannel(channel);
  }

  async function remove(id) {
    const channel = getRaw(id);
    if (!channel) return false;
    stopTelegramPoller(id);
    state.channels.delete(id);
    await persist();
    audit("channels.delete", { channelId: id, type: channel.type });
    return true;
  }

  /** webhook_out 推送：HMAC 签名头 + fire-and-forget（调用方拿 promise，不阻塞业务链）。 */
  async function sendWebhookOut(channel, payload) {
    const bodyText = JSON.stringify(payload ?? {});
    const signature = channel.config.secret ? hmacSha256(channel.config.secret, bodyText) : null;
    const headers = { "content-type": "application/json" };
    if (signature) headers["x-signature-sha256"] = signature;
    const response = await fetchImpl(channel.config.url, { method: "POST", headers, body: bodyText });
    await recordEvent({ kind: "outbound", channelId: channel.id, type: channel.type, status: response?.status ?? 0 });
    return { ok: Boolean(response?.ok), status: response?.status ?? 0 };
  }

  /** telegram 出站消息。 */
  async function sendTelegram(channel, { chatId, text }) {
    const url = `https://api.telegram.org/bot${channel.config.token}/sendMessage`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: String(text ?? "") }),
    });
    const payload = await response.json().catch(() => ({}));
    await recordEvent({ kind: "outbound", channelId: channel.id, type: "telegram", status: response.status });
    return { ok: Boolean(response.ok && payload?.ok), status: response.status };
  }

  async function send(id, payload = {}) {
    const channel = getRaw(id);
    if (!channel) throw channelError("CHANNEL_NOT_FOUND", `channel not found: ${id}`, 404);
    if (channel.type === "webhook_out") return sendWebhookOut(channel, payload);
    if (channel.type === "telegram") return sendTelegram(channel, payload);
    throw channelError("CHANNEL_READONLY", "webhook_in channels cannot send");
  }

  /** webhook_in 验签 + 限流 + 记录。rawBody 为字符串原文。 */
  async function receiveWebhook(id, rawBody, signature) {
    const channel = getRaw(id);
    if (!channel || channel.type !== "webhook_in") {
      throw channelError("CHANNEL_NOT_FOUND", `inbound webhook not found: ${id}`, 404);
    }
    if (!secureEqualHex(hmacSha256(channel.config.secret, rawBody), signature)) {
      throw channelError("CHANNEL_BAD_SIGNATURE", "webhook signature mismatch", 401);
    }
    const now = Math.floor(Date.now() / 60_000);
    const bucket = state.rateBuckets.get(id) ?? { minute: now, count: 0 };
    if (bucket.minute !== now) {
      bucket.minute = now;
      bucket.count = 0;
    }
    bucket.count += 1;
    state.rateBuckets.set(id, bucket);
    if (bucket.count > RATE_LIMIT_PER_MIN) {
      throw channelError("CHANNEL_RATE_LIMITED", "webhook rate limit exceeded", 429);
    }
    let payload = null;
    try {
      payload = JSON.parse(rawBody);
    } catch { /* 非 JSON 也记录原文长度 */ }
    await recordEvent({ kind: "inbound", channelId: id, type: "webhook_in", bytes: rawBody.length, payload });
    return { ok: true, count: bucket.count };
  }

  /** Telegram 长轮询：注入式 fetch，offset 存渠道 config（持久化防重）。 */
  function startTelegramPoller(id) {
    if (state.pollers.has(id)) return;
    const control = { stopped: false };
    const loop = (async () => {
      while (!control.stopped) {
        const channel = getRaw(id);
        if (!channel || !channel.enabled) break;
        try {
          const offset = Number(channel.config.offset || 0);
          const response = await fetchImpl(`https://api.telegram.org/bot${channel.config.token}/getUpdates`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ offset, timeout: 25 }),
          });
          const payload = await response.json().catch(() => ({}));
          for (const update of payload?.result ?? []) {
            const message = update?.message;
            if (message?.text) {
              await recordEvent({
                kind: "inbound",
                channelId: id,
                type: "telegram",
                chatId: message.chat?.id,
                from: message.from?.username || message.from?.first_name || "",
                text: String(message.text).slice(0, 500),
              });
            }
            channel.config.offset = update.update_id + 1;
          }
          if ((payload?.result ?? []).length) await persist();
          // 轮询节奏：真 Telegram 服务端长等 25s 自带节流；mock/快回场景必须让出事件循环，
          // 否则空结果微任务自旋会饿死定时器（2026-07-25 测试挂起根因）
          await new Promise((resolveWait) => setTimeout(resolveWait, pollIdleMs));
        } catch (error) {
          await recordEvent({ kind: "error", channelId: id, type: "telegram", message: error.message });
          await new Promise((resolveWait) => setTimeout(resolveWait, 5000));
        }
      }
      state.pollers.delete(id);
    })();
    control.promise = loop;
    state.pollers.set(id, control);
  }

  function stopTelegramPoller(id) {
    const poller = state.pollers.get(id);
    if (poller) poller.stopped = true;
    state.pollers.delete(id);
  }

  function recentEvents(limit = 50) {
    return state.events.slice(-Math.min(EVENTS_CAP, Math.max(1, Number(limit) || 50))).reverse();
  }

  async function close() {
    for (const id of [...state.pollers.keys()]) stopTelegramPoller(id);
    await state.writeChain;
  }

  const service = {
    init, list, create, update, remove, send, receiveWebhook,
    recentEvents, close, publicChannel,
    _state: state, // 测试观测用
  };
  return service;
}
