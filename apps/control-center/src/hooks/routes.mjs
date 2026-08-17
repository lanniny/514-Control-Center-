import { createHooksConfig, resolveHooksHomeDir } from "../hooks-config.mjs";
import { REPO_ROOT } from "../paths.mjs";

let service = null;

function ensureService() {
  if (!service) {
    service = createHooksConfig({
      repoRoot: REPO_ROOT,
      homeDir: resolveHooksHomeDir(),
    });
  }
  return service;
}

export function setHooksConfigForTest(instance) {
  service = instance;
}

export function registerHooksRoutes(router, ctx) {
  const hooks = ensureService();

  const guarded = (handler) => async (request, response, url) => {
    try {
      await handler(request, response, url);
    } catch (error) {
      ctx.json(response, error.httpStatus || 400, {
        ok: false,
        code: error.code || "HOOK_ERROR",
        message: error.message,
      });
    }
    return true;
  };

  router.get("/api/hooks", guarded(async (_request, response) => {
    ctx.json(response, 200, { ok: true, ...(await hooks.list()) });
  }));

  router.post("/api/hooks", guarded(async (request, response) => {
    const payload = await ctx.body(request);
    ctx.json(response, 201, { ok: true, ...(await hooks.create(payload ?? {})) });
  }));

  router.put("/api/hooks/", guarded(async (request, response, url) => {
    const id = decodeURIComponent(url.pathname.slice("/api/hooks/".length));
    if (!id) throw Object.assign(new Error("缺少钩子 id"), { code: "VALIDATION_FAILED", httpStatus: 400 });
    const payload = await ctx.body(request);
    ctx.json(response, 200, { ok: true, ...(await hooks.update(id, payload ?? {})) });
  }));

  router.delete("/api/hooks/", guarded(async (request, response, url) => {
    const id = decodeURIComponent(url.pathname.slice("/api/hooks/".length));
    if (!id) throw Object.assign(new Error("缺少钩子 id"), { code: "VALIDATION_FAILED", httpStatus: 400 });
    const payload = await ctx.body(request).catch(() => ({}));
    ctx.json(response, 200, { ok: true, ...(await hooks.remove(id, payload ?? {})) });
  }));
}
