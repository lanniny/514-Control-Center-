import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChannelService, publicChannel } from "../src/channels.mjs";

function hmac(secret, payload) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

async function fixture(t, fetchImpl) {
  const dir = await mkdtemp(join(tmpdir(), "514cc-channels-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const events = [];
  const eventStore = { emit: async (type, detail) => { events.push({ type, detail }); } };
  const service = await createChannelService({ dataRoot: dir, eventStore, fetchImpl, pollIdleMs: 10 }).init();
  t.after(() => service.close());
  return { dir, service, events };
}

test("channels: CRUD persists atomically and secrets never leak to public shape", async (t) => {
  const { dir, service } = await fixture(t);
  const channel = await service.create({ type: "webhook_in", name: "入站", config: { secret: "s3cr3t" }, enabled: true });
  assert.equal(channel.config.secret, "***", "public shape redacts secret");

  const raw = JSON.parse(await readFile(join(dir, "channels.json"), "utf8"));
  assert.equal(raw.channels[0].config.secret, "s3cr3t", "disk keeps the real secret");

  const listed = service.list();
  assert.equal(listed[0].config.secret, "***");
  assert.equal(publicChannel(null), null);

  const updated = await service.update(channel.id, { enabled: false, name: "改名" });
  assert.equal(updated.name, "改名");
  assert.equal(updated.enabled, false);

  assert.equal(await service.remove(channel.id), true);
  assert.equal(service.list().length, 0);
  assert.equal(await service.remove(channel.id), false);
});

test("channels: webhook_out signs body with HMAC header", async (t) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const { service } = await fixture(t, fetchImpl);
  const channel = await service.create({ type: "webhook_out", name: "出站", config: { url: "https://hooks.example.com/x", secret: "topsecret" } });
  const result = await service.send(channel.id, { hello: "world" });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const signature = calls[0].options.headers["x-signature-sha256"];
  assert.equal(signature, hmac("topsecret", JSON.stringify({ hello: "world" })));
});

test("channels: webhook_in verifies HMAC over raw body (good and bad paths)", async (t) => {
  const { service } = await fixture(t);
  const channel = await service.create({ type: "webhook_in", name: "入站", config: { secret: "s3cr3t" } });
  const id = channel.id;
  const rawText = '{"event":"deploy","n":1}';

  await assert.rejects(
    () => service.receiveWebhook(id, rawText, hmac("wrong", rawText)),
    { code: "CHANNEL_BAD_SIGNATURE" },
  );
  const ok = await service.receiveWebhook(id, rawText, hmac("s3cr3t", rawText));
  assert.equal(ok.ok, true);

  const events = service.recentEvents();
  assert.equal(events[0].kind, "inbound");
  assert.equal(events[0].payload.event, "deploy");
});

test("channels: webhook_in rate limit trips at 60/min", async (t) => {
  const { service } = await fixture(t);
  const channel = await service.create({ type: "webhook_in", name: "限流", config: { secret: "s" } });
  const rawText = "x";
  const signature = hmac("s", rawText);
  for (let index = 0; index < 60; index += 1) {
    await service.receiveWebhook(channel.id, rawText, signature);
  }
  await assert.rejects(
    () => service.receiveWebhook(channel.id, rawText, signature),
    { code: "CHANNEL_RATE_LIMITED" },
  );
});

test("channels: telegram poller parses updates into inbound events with offset persistence", async (t) => {
  const updates = [
    { update_id: 100, message: { text: "你好", chat: { id: 42 }, from: { username: "lo" } } },
    { update_id: 101, message: { text: "第二条", chat: { id: 42 }, from: { first_name: "L" } } },
  ];
  let polled = 0;
  const fetchImpl = async (url) => {
    polled += 1;
    if (url.includes("getUpdates")) {
      const batch = polled === 1 ? updates : [];
      return { ok: true, status: 200, json: async () => ({ ok: true, result: batch }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const { dir, service } = await fixture(t, fetchImpl);
  const channel = await service.create({
    type: "telegram",
    name: "tg",
    config: { token: "123:abc" },
    enabled: true,
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  const events = service.recentEvents();
  assert.equal(events.filter((event) => event.kind === "inbound").length, 2);
  assert.equal(events[1].from, "lo");
  // offset 已推进并持久化（重启不重复消费）
  const raw = JSON.parse(await readFile(join(dir, "channels.json"), "utf8"));
  assert.equal(raw.channels.find((entry) => entry.id === channel.id).config.offset, 102);
  // token 不出现在公开形态
  assert.equal(service.list()[0].config.token, "***");
});

test("channels: telegram send posts to Bot API with token in URL only", async (t) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
  };
  const { service } = await fixture(t, fetchImpl);
  const channel = await service.create({ type: "telegram", name: "tg", config: { token: "123:abc" } });
  const result = await service.send(channel.id, { chatId: 42, text: "ping" });
  assert.equal(result.ok, true);
  assert.ok(calls[0].url.includes("bot123:abc/sendMessage"));
  assert.equal(JSON.parse(calls[0].options.body).chat_id, 42);
});
