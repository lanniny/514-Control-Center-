import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerChannelsRoutes, setChannelServiceForTest } from "../src/channels/routes.mjs";
import { createChannelService } from "../src/channels.mjs";

function hmac(secret, payload) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function stubSurface() {
  const handlers = new Map();
  const router = {
    get: (path, handler) => handlers.set(`GET ${path}`, handler),
    post: (path, handler) => handlers.set(`POST ${path}`, handler),
    put: (path, handler) => handlers.set(`PUT ${path}`, handler),
    delete: (path, handler) => handlers.set(`DELETE ${path}`, handler),
  };
  const replies = [];
  const ctx = {
    state: { dataRoot: "unused-when-service-injected", eventStore: null },
    remoteGates: {
      registerImplementation() {},
      assert() { throw Object.assign(new Error("gate blocked"), { code: "REMOTE_GATE_BLOCKED", httpStatus: 501 }); },
    },
    json: (response, status, payload) => { replies.push({ status, payload }); response.handled = true; },
    rawBody: async (request) => request.rawBody,
    body: async (request) => JSON.parse(request.rawBody || "{}"),
  };
  return { router, handlers, ctx, replies };
}

function fakeRequest({ rawBody = "", headers = {}, pathname, method = "POST" }) {
  return { rawBody, headers, method, url: pathname };
}

test("channels: inbound webhook callback bypasses remote gate and Bearer auth, HMAC still enforced", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-channels-auth-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
    setChannelServiceForTest(null);
  });
  const service = await createChannelService({ dataRoot: dir }).init();
  t.after(() => service.close());
  setChannelServiceForTest(service);
  const channel = await service.create({ type: "webhook_in", name: "入站", config: { secret: "s3cr3t-ok" } });

  const { router, handlers, ctx, replies } = stubSurface();
  registerChannelsRoutes(router, ctx);
  const post = handlers.get("POST /api/channels");
  assert.ok(post, "POST /api/channels handler registered");

  const url = new URL(`http://localhost/api/channels/webhook/${channel.id}`);
  const rawText = '{"event":"ci-done"}';

  // 坏签名 → 401 语义（CHANNEL_BAD_SIGNATURE），而不是被门闸 501 / Bearer 401 挡住
  replies.length = 0;
  let response = {};
  await post(fakeRequest({ rawBody: rawText, headers: { "x-signature-sha256": hmac("wrong", rawText) } }), response, url);
  assert.equal(replies[0].status, 401);
  assert.equal(replies[0].payload.code, "CHANNEL_BAD_SIGNATURE");

  // 好签名 → 200 收下（无 Bearer、门闸关闭也不影响——HMAC 就是入站的全部鉴权）
  replies.length = 0;
  response = {};
  await post(fakeRequest({ rawBody: rawText, headers: { "x-signature-sha256": hmac("s3cr3t-ok", rawText) } }), response, url);
  assert.equal(replies[0].status, 200);
  assert.equal(replies[0].payload.ok, true);

  // 管理面（创建渠道）仍被门闸拦住：豁免只给入站回调
  replies.length = 0;
  response = {};
  await post(fakeRequest({ rawBody: "{}", headers: {} }), response, new URL("http://localhost/api/channels"));
  assert.equal(replies[0].status, 501);
  assert.equal(replies[0].payload.code, "REMOTE_GATE_BLOCKED");
});
