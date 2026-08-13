/**
 * remote-projects/routes.mjs — 远程项目台账路由（元数据面，不连远程、无门闸）。
 * 主驾在 server.mjs 接线：registerRemoteProjectRoutes(surfaceRouter, surfaceCtx)，
 * 必须在 registerSshRoutes 之后（主机解析依赖 getSshService()）。
 */

import { createRemoteProjectsService } from "../remote-projects.mjs";
import { getSshService } from "../ssh/routes.mjs";
import { createRemoteGraph } from "../ssh/remote-graph.mjs";
import { createRemoteConfigService } from "../ssh/remote-config.mjs";
import { createRemoteOps } from "../ssh/remote-ops.mjs";
import { ensureRemoteRecoveryLedger, reconcileRegisteredRemoteRecovery, runRegisteredRemoteWrite } from "../ssh/recovery-ledger.mjs";

let service = null;
let graphService = null;
let configService = null;
let remoteOps = null;

function ensureService(ctx) {
  if (!service) {
    service = createRemoteProjectsService({ dataRoot: ctx.state.dataRoot, sshService: getSshService() });
    service._initPromise = service.init().catch(() => {});
  }
  return service;
}

export function setRemoteProjectsServiceForTest(instance) {
  service = instance;
  graphService = null;
  configService = null;
  remoteOps = null;
}

export function setRemoteProjectGraphForTest(instance) {
  graphService = instance;
}

export function setRemoteProjectConfigForTest(instance) {
  configService = instance;
}

export function setRemoteProjectOpsForTest(instance) {
  remoteOps = instance;
}

function recoveryRequest(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw Object.assign(new Error("recovery request must contain only kind and transactionId"), { code: "REMOTE_RECOVERY_REQUEST_INVALID", httpStatus: 400 });
  }
  const keys = Object.keys(payload).sort();
  if (keys.length !== 2 || keys[0] !== "kind" || keys[1] !== "transactionId") {
    throw Object.assign(new Error("recovery request must contain only kind and transactionId"), { code: "REMOTE_RECOVERY_REQUEST_INVALID", httpStatus: 400 });
  }
  if (!["provider", "graph", "sync"].includes(payload.kind)) {
    throw Object.assign(new Error("recovery kind must be provider, graph, or sync"), { code: "REMOTE_RECOVERY_KIND_INVALID", httpStatus: 400 });
  }
  if (typeof payload.transactionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.transactionId)) {
    throw Object.assign(new Error("a valid recovery transactionId is required"), { code: "REMOTE_RECOVERY_TRANSACTION_INVALID", httpStatus: 400 });
  }
  return { kind: payload.kind, transactionId: payload.transactionId };
}

export function registerRemoteProjectRoutes(router, ctx) {
  const svc = ensureService(ctx);
  const recoveryLedger = ensureRemoteRecoveryLedger(ctx.state);

  const errorPayload = (error) => {
    const payload = {
      ok: false,
      code: error.code || "REMOTE_PROJECT_ERROR",
      message: error.message,
    };
    if (error.recoveryRequired === true) {
      payload.recoveryRequired = true;
      payload.retryable = false;
      for (const field of ["transactionId", "applied", "uncertain", "backups", "locks", "rollbackErrors", "causeCode", "recoveryRegistryPersisted", "recoveryRegistryError", "pending"]) {
        if (error[field] !== undefined) payload[field] = error[field];
      }
      if (["provider", "graph", "sync"].includes(error.recovery?.kind) && typeof error.recovery.transactionId === "string") {
        payload.recovery = { kind: error.recovery.kind, transactionId: error.recovery.transactionId };
      }
    }
    return payload;
  };

  const wrap = (handler) => async (request, response, url) => {
    if (svc._initPromise) await svc._initPromise;
    try {
      await handler(request, response, url);
    } catch (error) {
      ctx.json(response, error.httpStatus || 400, errorPayload(error));
    }
    return true;
  };

  router.get("/api/remote-projects", wrap(async (request, response, url) => {
    if (url.pathname === "/api/remote-projects") {
      ctx.json(response, 200, { ok: true, projects: await svc.list() });
      return;
    }
    const providerPlan = url.pathname.match(/^\/api\/remote-projects\/([\w-]+)\/provider-plan$/);
    const match = url.pathname.match(/^\/api\/remote-projects\/([\w-]+)\/graph(?:\/(source|backup))?$/);
    if (providerPlan) {
      ctx.remoteGates.assert("ssh");
      ctx.remoteGates.assert("sftp");
      const project = await svc.get(providerPlan[1]);
      if (!project) {
        ctx.json(response, 404, { ok: false, code: "REMOTE_PROJECT_NOT_FOUND", message: `remote project not found: ${providerPlan[1]}` });
        return;
      }
      if (project.hostMissing || !project.host) throw Object.assign(new Error(`remote project host is unavailable: ${project.hostId}`), { code: "REMOTE_HOST_NOT_FOUND", httpStatus: 409 });
      if (project.host.enabled === false) throw Object.assign(new Error(`remote project host is disabled: ${project.host.name}`), { code: "REMOTE_HOST_DISABLED", httpStatus: 409 });
      const ops = (configService ??= createRemoteConfigService(getSshService(), ctx.state.providers, { eventStore: ctx.state.eventStore }));
      ctx.json(response, 200, { ok: true, ...(await ops.planProvider(
        project.hostId,
        url.searchParams.get("app") || "",
        url.searchParams.get("providerId") || "",
        { projectPath: project.path },
      )) });
      return;
    }
    if (!match) {
      ctx.json(response, 404, { ok: false, code: "NOT_FOUND", message: "unknown remote-projects route" });
      return;
    }
    ctx.remoteGates.assert("ssh");
    ctx.remoteGates.assert("sftp");
    const project = await svc.get(match[1]);
    if (!project) {
      ctx.json(response, 404, { ok: false, code: "REMOTE_PROJECT_NOT_FOUND", message: `remote project not found: ${match[1]}` });
      return;
    }
    if (project.hostMissing || !project.host) {
      ctx.json(response, 409, { ok: false, code: "REMOTE_HOST_NOT_FOUND", message: `remote project host is unavailable: ${project.hostId}` });
      return;
    }
    if (project.host.enabled === false) {
      ctx.json(response, 409, { ok: false, code: "REMOTE_HOST_DISABLED", message: `remote project host is disabled: ${project.host.name}` });
      return;
    }
    const ops = (graphService ??= createRemoteGraph(getSshService()));
    if (match[2] === "source") {
      ctx.json(response, 200, { ok: true, ...(await ops.readSource(project.hostId, url.searchParams.get("file") || "", { projectPath: project.path })) });
      return;
    }
    if (match[2] === "backup") {
      ctx.json(response, 200, { ok: true, ...(await ops.readBackup(
        project.hostId,
        url.searchParams.get("file") || "",
        url.searchParams.get("name") || "",
        { projectPath: project.path },
      )) });
      return;
    }
    ctx.json(response, 200, { ok: true, ...(await ops.graph(project.hostId, { projectPath: project.path })) });
  }));

  router.post("/api/remote-projects", wrap(async (request, response, url) => {
    const payload = await ctx.body(request, 64 * 1024);
    const providerApply = url.pathname.match(/^\/api\/remote-projects\/([\w-]+)\/provider-apply$/);
    const sourceWrite = url.pathname.match(/^\/api\/remote-projects\/([\w-]+)\/graph\/source$/);
    const backupRestore = url.pathname.match(/^\/api\/remote-projects\/([\w-]+)\/graph\/backup\/restore$/);
    const recoveryMatch = url.pathname.match(/^\/api\/remote-projects\/([\w-]+)\/recovery\/reconcile$/);
    if (recoveryMatch) {
      ctx.remoteGates.assert("ssh");
      ctx.remoteGates.assert("sftp");
      const project = await svc.get(recoveryMatch[1]);
      if (!project) {
        ctx.json(response, 404, { ok: false, code: "REMOTE_PROJECT_NOT_FOUND", message: `remote project not found: ${recoveryMatch[1]}` });
        return;
      }
      if (project.hostMissing || !project.host) throw Object.assign(new Error(`remote project host is unavailable: ${project.hostId}`), { code: "REMOTE_HOST_NOT_FOUND", httpStatus: 409 });
      if (project.host.enabled === false) throw Object.assign(new Error(`remote project host is disabled: ${project.host.name}`), { code: "REMOTE_HOST_DISABLED", httpStatus: 409 });
      const recovery = recoveryRequest(payload);
      const target = recovery.kind === "sync"
        ? { hostId: project.hostId }
        : { hostId: project.hostId, projectId: project.id };
      const result = await reconcileRegisteredRemoteRecovery(recoveryLedger, target, recovery, async () => (
        recovery.kind === "provider"
          ? await (configService ??= createRemoteConfigService(getSshService(), ctx.state.providers, { eventStore: ctx.state.eventStore })).reconcileProvider(
            project.hostId,
            recovery.transactionId,
            { projectPath: project.path },
          )
          : recovery.kind === "graph"
            ? await (graphService ??= createRemoteGraph(getSshService())).reconcileSource(
              project.hostId,
              recovery.transactionId,
              { projectPath: project.path },
            )
            : await (remoteOps ??= createRemoteOps(getSshService())).reconcileSync(project.hostId, recovery.transactionId)
      ));
      ctx.json(response, 200, { ok: true, ...result });
      return;
    }
    if (sourceWrite) {
      ctx.remoteGates.assert("ssh");
      ctx.remoteGates.assert("sftp");
      const project = await svc.get(sourceWrite[1]);
      if (!project) {
        ctx.json(response, 404, { ok: false, code: "REMOTE_PROJECT_NOT_FOUND", message: `remote project not found: ${sourceWrite[1]}` });
        return;
      }
      if (project.hostMissing || !project.host) throw Object.assign(new Error(`remote project host is unavailable: ${project.hostId}`), { code: "REMOTE_HOST_NOT_FOUND", httpStatus: 409 });
      if (project.host.enabled === false) throw Object.assign(new Error(`remote project host is disabled: ${project.host.name}`), { code: "REMOTE_HOST_DISABLED", httpStatus: 409 });
      const ops = (graphService ??= createRemoteGraph(getSshService()));
      const result = await runRegisteredRemoteWrite(recoveryLedger, { hostId: project.hostId, projectId: project.id }, "graph", (transactionId) => ops.writeSource(project.hostId, payload?.file, payload?.content, payload?.digest, { projectPath: project.path, transactionId }));
      await ctx.state.eventStore?.emit("remote.source_write", { hostId: project.hostId, projectId: project.id, sourceId: payload?.file, remote: result.remote, bytes: result.bytes }).catch(() => {});
      ctx.json(response, 200, { ok: true, ...result });
      return;
    }
    if (backupRestore) {
      ctx.remoteGates.assert("ssh");
      ctx.remoteGates.assert("sftp");
      const project = await svc.get(backupRestore[1]);
      if (!project) {
        ctx.json(response, 404, { ok: false, code: "REMOTE_PROJECT_NOT_FOUND", message: `remote project not found: ${backupRestore[1]}` });
        return;
      }
      if (project.hostMissing || !project.host) throw Object.assign(new Error(`remote project host is unavailable: ${project.hostId}`), { code: "REMOTE_HOST_NOT_FOUND", httpStatus: 409 });
      if (project.host.enabled === false) throw Object.assign(new Error(`remote project host is disabled: ${project.host.name}`), { code: "REMOTE_HOST_DISABLED", httpStatus: 409 });
      const ops = (graphService ??= createRemoteGraph(getSshService()));
      const result = await runRegisteredRemoteWrite(recoveryLedger, { hostId: project.hostId, projectId: project.id }, "graph", (transactionId) => ops.restoreBackup(project.hostId, payload?.file, payload?.name, payload?.digest, { projectPath: project.path, transactionId }));
      await ctx.state.eventStore?.emit("remote.source_restore", { hostId: project.hostId, projectId: project.id, sourceId: payload?.file, remote: result.remote, backup: result.restoredFrom, bytes: result.bytes }).catch(() => {});
      ctx.json(response, 200, { ok: true, ...result });
      return;
    }
    if (providerApply) {
      ctx.remoteGates.assert("ssh");
      ctx.remoteGates.assert("sftp");
      const project = await svc.get(providerApply[1]);
      if (!project) {
        ctx.json(response, 404, { ok: false, code: "REMOTE_PROJECT_NOT_FOUND", message: `remote project not found: ${providerApply[1]}` });
        return;
      }
      if (project.hostMissing || !project.host) throw Object.assign(new Error(`remote project host is unavailable: ${project.hostId}`), { code: "REMOTE_HOST_NOT_FOUND", httpStatus: 409 });
      if (project.host.enabled === false) throw Object.assign(new Error(`remote project host is disabled: ${project.host.name}`), { code: "REMOTE_HOST_DISABLED", httpStatus: 409 });
      const ops = (configService ??= createRemoteConfigService(getSshService(), ctx.state.providers, { eventStore: ctx.state.eventStore }));
      const result = await runRegisteredRemoteWrite(recoveryLedger, { hostId: project.hostId, projectId: project.id }, "provider", (transactionId) => ops.applyProvider(
        project.hostId,
        payload?.app,
        payload?.providerId,
        { projectPath: project.path, planRevision: payload?.planRevision, transactionId },
      ));
      ctx.json(response, 200, { ok: true, ...result });
      return;
    }
    if (url.pathname !== "/api/remote-projects") {
      ctx.json(response, 404, { ok: false, code: "NOT_FOUND", message: "unknown remote-projects route" });
      return;
    }
    ctx.json(response, 201, { ok: true, project: await svc.create(payload ?? {}) });
  }));

  router.delete("/api/remote-projects/", wrap(async (request, response, url) => {
    const id = url.pathname.match(/^\/api\/remote-projects\/([\w-]+)$/)?.[1] ?? null;
    if (!id) {
      ctx.json(response, 404, { ok: false, code: "NOT_FOUND", message: "unknown remote-projects route" });
      return;
    }
    const project = await svc.get(id);
    if (project) await recoveryLedger.assertHostWritable(project.hostId);
    const removed = await svc.remove(id);
    ctx.json(response, removed ? 200 : 404, removed
      ? { ok: true }
      : { ok: false, code: "REMOTE_PROJECT_NOT_FOUND", message: `remote project not found: ${id}` });
  }));
}
