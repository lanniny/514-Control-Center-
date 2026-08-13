/**
 * cli-env/routes.mjs — 本地 CLI 环境面路由（探测快照 + 确认制安装/升级）。
 * 主驾在 server.mjs 接线：registerCliEnvRoutes(surfaceRouter, surfaceCtx)。
 *
 * 不挂 remote-gate：9 项固定 CLI 清单的本地探测/安装属本地运维操作；
 * registry 只读版本号查询失败时服务层已如实降级（latestVersion:null），不装死。
 */

import { createCliEnvironmentService } from "../cli-env.mjs";

let service = null;

function ensureService() {
  if (!service) service = createCliEnvironmentService();
  return service;
}

export function setCliEnvServiceForTest(instance) {
  service = instance;
}

export function registerCliEnvRoutes(router, ctx) {
  const cliEnv = ensureService();

  const guarded = (handler) => async (request, response, url) => {
    try {
      await handler(request, response, url);
    } catch (error) {
      ctx.json(response, error.httpStatus || 400, {
        ok: false,
        code: error.code || "CLI_ENV_ERROR",
        message: error.message,
        outputTail: error.outputTail ?? undefined,
      });
    }
    return true;
  };

  router.get("/api/cli-environment", guarded(async (request, response, url) => {
    const refresh = url.searchParams.get("refresh") === "1";
    const payload = await cliEnv.snapshot({ refresh });
    ctx.json(response, 200, { ok: true, ...payload });
  }));

  router.post("/api/cli-environment/install", guarded(async (request, response) => {
    const payload = await ctx.body(request);
    const result = await cliEnv.install(payload ?? {});
    ctx.json(response, 200, result);
  }));
}
