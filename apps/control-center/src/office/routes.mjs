/**
 * office/routes.mjs — Wave G 文档工坊路由注册。
 * 主驾在 server.mjs 接线：registerOfficeRoutes(surfaceRouter, surfaceCtx)。
 */

import { createOfficeService } from "../office.mjs";

let service = null;

function ensureService(ctx) {
  if (!service) {
    service = createOfficeService({ repoRoot: ctx.state.repoRoot, dataRoot: ctx.state.dataRoot, eventStore: ctx.state.eventStore });
  }
  return service;
}

export function setOfficeServiceForTest(instance) {
  service = instance;
}

export function registerOfficeRoutes(router, ctx) {
  ctx.remoteGates.registerImplementation("office");
  const office = ensureService(ctx);
  const guarded = (handler) => async (request, response, url) => {
    try {
      ctx.remoteGates.assert("office");
    } catch (error) {
      ctx.json(response, error.httpStatus || 501, { ok: false, code: error.code, message: error.message });
      return true;
    }
    try {
      await handler(request, response, url);
    } catch (error) {
      ctx.json(response, error.httpStatus || 400, { ok: false, code: error.code || "OFFICE_ERROR", message: error.message });
    }
    return true;
  };

  router.post("/api/office/generate", guarded(async (request, response) => {
    const payload = await ctx.body(request);
    const result = await office.generate(payload ?? {});
    ctx.json(response, result.dryRun ? 200 : 201, result);
  }));

  router.post("/api/office/inspect", guarded(async (request, response) => {
    const payload = await ctx.body(request);
    ctx.json(response, 200, await office.inspect(payload ?? {}));
  }));

  router.get("/api/office/history", guarded(async (request, response) => {
    ctx.json(response, 200, { ok: true, items: await office.history() });
  }));

  router.get("/api/office/templates", guarded(async (request, response) => {
    ctx.json(response, 200, { ok: true, templates: office.templates() });
  }));

  router.get("/api/office/download", guarded(async (request, response, url) => {
    const file = await office.readDocument(url.searchParams.get("path") || "");
    const encoded = encodeURIComponent(file.fileName).replace(/['()]/g, escape);
    response.writeHead(200, {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename*=UTF-8''${encoded}`,
      "content-length": file.bytes.length,
      "cache-control": "no-store",
    });
    response.end(file.bytes);
  }));
}
