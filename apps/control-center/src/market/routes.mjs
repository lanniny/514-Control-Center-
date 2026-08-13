/**
 * market/routes.mjs — Wave G 供应链路由注册（skills/mcp 双门闸）。
 * 主驾在 server.mjs 接线：registerMarketRoutes(surfaceRouter, surfaceCtx)。
 */

import { createMarketService } from "../market.mjs";

let service = null;

function ensureService(ctx) {
  if (!service) {
    service = createMarketService({ dataRoot: ctx.state.dataRoot, eventStore: ctx.state.eventStore });
  }
  return service;
}

export function setMarketServiceForTest(instance) {
  service = instance;
}

export function registerMarketRoutes(router, ctx) {
  ctx.remoteGates.registerImplementation("skills_marketplace");
  ctx.remoteGates.registerImplementation("mcp_marketplace");
  const market = ensureService(ctx);

  const guarded = (gate, handler) => async (request, response, url) => {
    try {
      ctx.remoteGates.assert(gate);
    } catch (error) {
      ctx.json(response, error.httpStatus || 501, { ok: false, code: error.code, message: error.message });
      return true;
    }
    try {
      await handler(request, response, url);
    } catch (error) {
      ctx.json(response, error.httpStatus || 400, { ok: false, code: error.code || "MARKET_ERROR", message: error.message });
    }
    return true;
  };

  router.get("/api/market/mcp/search", guarded("mcp_marketplace", async (request, response, url) => {
    const items = await market.mcpSearch(url.searchParams.get("q") || "", url.searchParams.get("source") || "official");
    ctx.json(response, 200, { ok: true, items });
  }));

  router.post("/api/market/mcp/stage", guarded("mcp_marketplace", async (request, response) => {
    const payload = await ctx.body(request);
    ctx.json(response, 200, await market.mcpStage(payload ?? {}));
  }));

  router.post("/api/market/mcp/install", guarded("mcp_marketplace", async (request, response) => {
    const payload = await ctx.body(request);
    ctx.json(response, 200, await market.mcpInstall(payload ?? {}));
  }));

  router.post("/api/market/skills/stage", guarded("skills_marketplace", async (request, response) => {
    const payload = await ctx.body(request, 1024 * 1024);
    ctx.json(response, 200, await market.skillsStage(payload ?? {}));
  }));

  router.post("/api/market/skills/install", guarded("skills_marketplace", async (request, response) => {
    const payload = await ctx.body(request);
    ctx.json(response, 200, await market.skillsInstall(payload ?? {}));
  }));

  router.get("/api/market/installed", guarded("skills_marketplace", async (request, response) => {
    ctx.json(response, 200, { ok: true, items: await market.installedList() });
  }));

  router.get("/api/market/skills", guarded("skills_marketplace", async (request, response) => {
    ctx.json(response, 200, { ok: true, skills: await market.skillsList() });
  }));

  router.delete("/api/market/skills/", guarded("skills_marketplace", async (request, response, url) => {
    const name = url.pathname.replace(/^\/api\/market\/skills\//, "");
    const removed = await market.skillsRemove(name);
    ctx.json(response, removed ? 200 : 404, removed
      ? { ok: true }
      : { ok: false, code: "MARKET_NOT_FOUND", message: `skill not found: ${name}` });
  }));
}
