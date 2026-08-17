/**
 * channels/routes.mjs — Wave G 渠道路由注册。
 * 主驾在 server.mjs 接线：registerChannelsRoutes(surfaceRouter, surfaceCtx)。
 */

import { createChannelService } from "../channels.mjs";

let service = null;

function ensureService(ctx) {
  if (!service) {
    service = createChannelService({ dataRoot: ctx.state.dataRoot, eventStore: ctx.state.eventStore });
    // 渠道服务需要 init（读盘 + 恢复轮询）；失败不拖垮 server，但服务自身会 fail-closed 拒绝写入。
    service._initPromise = service.init().catch((error) => {
      service._initError = error?.message || String(error);
    });
  }
  return service;
}

export function setChannelServiceForTest(instance) {
  service = instance;
}

/** 优雅关闭：停掉 Telegram 轮询并等写链落盘。服务未初始化时是 no-op。 */
export async function closeChannelService() {
  if (service) await service.close();
}

export function registerChannelsRoutes(router, ctx) {
  ctx.remoteGates.registerImplementation("channels");
  const channels = ensureService(ctx);

  const guarded = (handler) => async (request, response, url) => {
    // 入站 webhook 回调不套远程门闸：外部系统只持有验签 secret，
    // 门闸只管出站/管理面（与 server.mjs 的 Bearer 豁免同语义）
    const isInboundCallback = request.method === "POST" && /^\/api\/channels\/webhook\/[\w-]+$/.test(url.pathname);
    if (!isInboundCallback) {
      try {
        ctx.remoteGates.assert("channels");
      } catch (error) {
        ctx.json(response, error.httpStatus || 501, { ok: false, code: error.code, message: error.message });
        return true;
      }
    }
    if (channels._initPromise) await channels._initPromise;
    try {
      await handler(request, response, url);
    } catch (error) {
      ctx.json(response, error.httpStatus || 400, { ok: false, code: error.code || "CHANNEL_ERROR", message: error.message });
    }
    return true;
  };

  router.get("/api/channels", guarded(async (request, response, url) => {
    if (url.pathname !== "/api/channels") {
      // /api/channels/events
      if (url.pathname === "/api/channels/events") {
        ctx.json(response, 200, { ok: true, events: channels.recentEvents(url.searchParams.get("limit")) });
        return;
      }
      ctx.json(response, 404, { ok: false, code: "NOT_FOUND", message: "unknown channels route" });
      return;
    }
    const storeUnavailable = channels._state?.storeStatus && channels._state.storeStatus !== "ready";
    ctx.json(response, 200, {
      ok: true,
      channels: channels.list(),
      ...(storeUnavailable ? { storeStatus: "unavailable", message: `渠道存储不可读：${channels._state.initError || "未知错误"}。为保护现有配置，写操作已被拒绝，请修复 channels.json 后重启。` } : {}),
    });
  }));

  router.post("/api/channels", guarded(async (request, response, url) => {
    // webhook_in 入站：/api/channels/webhook/:id —— HMAC 需原文，先判路径再取 rawBody
    const inbound = url.pathname.match(/^\/api\/channels\/webhook\/([\w-]+)$/);
    if (inbound) {
      const rawText = await ctx.rawBody(request, 1024 * 1024);
      const signature = request.headers?.["x-signature-sha256"] || request.headers?.["x-signature"] || "";
      const result = await channels.receiveWebhook(inbound[1], rawText, signature);
      ctx.json(response, 200, result);
      return;
    }
    const payload = await ctx.body(request, 1024 * 1024);
    if (url.pathname === "/api/channels/probe") {
      const result = await channels.probe(payload ?? {});
      ctx.json(response, result.ok ? 200 : 502, { ok: result.ok, ...result });
      return;
    }
    if (url.pathname === "/api/channels") {
      const channel = await channels.create(payload ?? {});
      ctx.json(response, 201, { ok: true, channel });
      return;
    }
    const testMatch = url.pathname.match(/^\/api\/channels\/([\w-]+)\/test$/);
    if (testMatch) {
      const result = await channels.send(testMatch[1], { text: payload?.text || "514 Forge channel test", ...(payload ?? {}) });
      ctx.json(response, result.ok ? 200 : 502, result);
      return;
    }
    ctx.json(response, 404, { ok: false, code: "NOT_FOUND", message: "unknown channels route" });
  }));

  router.put("/api/channels/", guarded(async (request, response, url) => {
    const match = url.pathname.match(/^\/api\/channels\/([\w-]+)$/);
    if (!match) {
      ctx.json(response, 404, { ok: false, code: "NOT_FOUND", message: "unknown channels route" });
      return;
    }
    const payload = await ctx.body(request);
    ctx.json(response, 200, { ok: true, channel: await channels.update(match[1], payload ?? {}) });
  }));

  router.delete("/api/channels/", guarded(async (request, response, url) => {
    const match = url.pathname.match(/^\/api\/channels\/([\w-]+)$/);
    if (!match) {
      ctx.json(response, 404, { ok: false, code: "NOT_FOUND", message: "unknown channels route" });
      return;
    }
    const removed = await channels.remove(match[1]);
    ctx.json(response, removed ? 200 : 404, removed
      ? { ok: true }
      : { ok: false, code: "CHANNEL_NOT_FOUND", message: `channel not found: ${match[1]}` });
  }));
}
