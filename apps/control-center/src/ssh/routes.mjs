/**
 * ssh/routes.mjs — Wave G 远程主机路由注册（SSH + SFTP 双门闸）。
 * 主驾在 server.mjs 接线：registerSshRoutes(surfaceRouter, surfaceCtx)。
 */

import { createSshService } from "../ssh.mjs";
import { discoverSshHosts, matchConfigEntry } from "./discover.mjs";
import { createRemoteOps } from "./remote-ops.mjs";
import { createRemoteGraph } from "./remote-graph.mjs";
import { createRemoteConfigService } from "./remote-config.mjs";
import { ensureRemoteRecoveryLedger, reconcileRegisteredRemoteRecovery, runRegisteredRemoteWrite } from "./recovery-ledger.mjs";

let service = null;
let remoteOps = null;
let remoteGraph = null;
let remoteConfig = null;

function ensureService(ctx) {
  if (!service) {
    service = createSshService({ dataRoot: ctx.state.dataRoot, eventStore: ctx.state.eventStore });
    const initPromise = service.init();
    service._initPromise = initPromise;
    void initPromise.catch((error) => { service._initError = error; });
    remoteOps = createRemoteOps(service);
    remoteGraph = createRemoteGraph(service);
    remoteConfig = createRemoteConfigService(service, ctx.state.providers, { eventStore: ctx.state.eventStore });
  }
  return service;
}

export function setSshServiceForTest(instance) {
  service = instance;
  remoteOps = null; // 服务换了，remoteOps 必须重建——否则旧 service 泄漏进测试
  remoteGraph = null; // remoteGraph 同理
  remoteConfig = null;
}

/** 供测试直接注入假 remoteOps（绕过真 service 构造）。 */
export function setRemoteOpsForTest(instance) {
  remoteOps = instance;
}

/** 供测试直接注入假 remoteGraph（v41 波五）。 */
export function setRemoteGraphForTest(instance) {
  remoteGraph = instance;
}

/** Allow route tests to inject provider planning/apply behavior without touching a real host. */
export function setRemoteConfigForTest(instance) {
  remoteConfig = instance;
}

/** 供其他面（pty ssh 终端）解析台账主机；未接线前为 null，调用方如实 503。 */
export function getSshService() {
  return service;
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

export function registerSshRoutes(router, ctx) {
  ctx.remoteGates.registerImplementation("ssh");
  ctx.remoteGates.registerImplementation("sftp");
  const ssh = ensureService(ctx);
  const recoveryLedger = ensureRemoteRecoveryLedger(ctx.state);

  const errorPayload = (error, fallbackCode = "SSH_ERROR") => {
    const payload = {
      ok: false,
      code: error.code || fallbackCode,
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

  const guarded = (gate, handler) => async (request, response, url) => {
    try {
      ctx.remoteGates.assert(gate);
    } catch (error) {
      ctx.json(response, error.httpStatus || 501, { ok: false, code: error.code, message: error.message });
      return true;
    }
    try {
      if (ssh._initPromise) await ssh._initPromise;
      await handler(request, response, url);
    } catch (error) {
      ctx.json(response, error.httpStatus || 400, errorPayload(error));
    }
    return true;
  };

  const idOf = (url, suffix = "") => {
    const pattern = suffix
      ? new RegExp(`^/api/ssh/hosts/([\\w-]+)/${suffix}$`)
      : /^\/api\/ssh\/hosts\/([\w-]+)$/;
    return url.pathname.match(pattern)?.[1] ?? null;
  };

  router.get("/api/ssh/hosts", async (request, response, url) => {
    // GET 面按路径选门闸：列表=ssh；sftp/*=sftp
    const isSftp = /\/sftp\//.test(url.pathname);
    try {
      ctx.remoteGates.assert(isSftp ? "sftp" : "ssh");
    } catch (error) {
      ctx.json(response, error.httpStatus || 501, { ok: false, code: error.code, message: error.message });
      return true;
    }
    try {
      if (ssh._initPromise) await ssh._initPromise;
      if (url.pathname !== "/api/ssh/hosts") {
        if (url.pathname === "/api/ssh/hosts/recoveries") {
          if (recoveryLedger._initPromise) await recoveryLedger._initPromise;
          ctx.json(response, 200, { ok: true, recoveries: await recoveryLedger.list() });
          return true;
        }
        let id = idOf(url, "sftp/list");
        if (id) {
          ctx.json(response, 200, { ok: true, items: await ssh.sftpList(id, url.searchParams.get("path") || "") });
          return true;
        }
        id = idOf(url, "sftp/read");
        if (id) {
          ctx.json(response, 200, { ok: true, ...(await ssh.sftpRead(id, url.searchParams.get("path") || "")) });
          return true;
        }
        id = idOf(url, "env-sync/plan");
        if (id) {
          const ops = (remoteOps ??= createRemoteOps(ssh));
          ctx.json(response, 200, { ok: true, ...(await ops.planConfigSync()) });
          return true;
        }
        // v41 波五：远程三面图谱（供应商实况/能力清单/真源 stat）——读远端文件叠加 sftp 闸（env-sync 同款先例）
        id = idOf(url, "graph/source");
        if (id) {
          ctx.remoteGates.assert("sftp");
          const graphOps = (remoteGraph ??= createRemoteGraph(ssh));
          ctx.json(response, 200, { ok: true, ...(await graphOps.readSource(id, url.searchParams.get("file") || "")) });
          return true;
        }
        // 发布备份读取：客户端只给 source id + 备份文件名，路径由服务端在真源 canonical 父目录下拼装
        id = idOf(url, "graph/backup");
        if (id) {
          ctx.remoteGates.assert("sftp");
          const graphOps = (remoteGraph ??= createRemoteGraph(ssh));
          ctx.json(response, 200, { ok: true, ...(await graphOps.readBackup(
            id,
            url.searchParams.get("file") || "",
            url.searchParams.get("name") || "",
          )) });
          return true;
        }
        id = idOf(url, "graph");
        if (id) {
          ctx.remoteGates.assert("sftp");
          const graphOps = (remoteGraph ??= createRemoteGraph(ssh));
          ctx.json(response, 200, { ok: true, ...(await graphOps.graph(id)) });
          return true;
        }
        id = idOf(url, "provider-plan");
        if (id) {
          ctx.remoteGates.assert("sftp");
          const configOps = (remoteConfig ??= createRemoteConfigService(ssh, ctx.state.providers, { eventStore: ctx.state.eventStore }));
          ctx.json(response, 200, { ok: true, ...(await configOps.planProvider(
            id,
            url.searchParams.get("app") || "",
            url.searchParams.get("providerId") || "",
          )) });
          return true;
        }
        ctx.json(response, 404, { ok: false, code: "NOT_FOUND", message: "unknown ssh route" });
        return true;
      }
      ctx.json(response, 200, { ok: true, hosts: ssh.list() });
    } catch (error) {
      ctx.json(response, error.httpStatus || 400, errorPayload(error));
    }
    return true;
  });

  // 本机 SSH 连接自动发现（~/.ssh/config 只读解析；走 ssh 门闸，不触碰凭据文件）
  router.get("/api/ssh/discover", guarded("ssh", async (request, response) => {
    ctx.json(response, 200, { ok: true, ...(await discoverSshHosts()) });
  }));

  router.post("/api/ssh/hosts", guarded("ssh", async (request, response, url) => {
    const payload = await ctx.body(request, 2 * 1024 * 1024);
    if (url.pathname === "/api/ssh/hosts") {
      ctx.json(response, 201, { ok: true, host: await ssh.create(payload ?? {}) });
      return;
    }
    let id = idOf(url, "trust");
    if (id) {
      await recoveryLedger.assertHostWritable(id);
      ctx.json(response, 200, { ok: true, host: await ssh.trust(id, payload?.fingerprint) });
      return;
    }
    id = idOf(url, "enabled");
    if (id) {
      await recoveryLedger.assertHostWritable(id);
      ctx.json(response, 200, { ok: true, host: await ssh.setEnabled(id, payload?.enabled !== false) });
      return;
    }
    id = idOf(url, "fingerprint");
    if (id) {
      ctx.json(response, 200, { ok: true, ...(await ssh.captureFingerprint(id)) });
      return;
    }
    id = idOf(url, "sync-config");
    if (id) {
      await recoveryLedger.assertHostWritable(id);
      // 从 ~/.ssh/config 回同步连接参数（含 IdentityFile 路径）；无匹配条目如实 404
      const current = ssh.list().find((host) => host.id === id);
      if (!current) {
        ctx.json(response, 404, { ok: false, code: "SSH_NOT_FOUND", message: `host not found: ${id}` });
        return;
      }
      const discovered = await discoverSshHosts();
      const matched = matchConfigEntry(discovered.hosts, { name: current.name, host: current.host, port: current.port });
      if (!matched) {
        ctx.json(response, 404, { ok: false, code: "SSH_CONFIG_NO_MATCH", message: `no matching Host block in ${discovered.source ?? "~/.ssh/config"}` });
        return;
      }
      ctx.json(response, 200, { ok: true, host: await ssh.update(id, {
        host: matched.host,
        port: matched.port,
        user: matched.user ?? undefined,
        identityFile: matched.identityFile,
      }) });
      return;
    }
    id = idOf(url, "test");
    if (id) {
      ctx.json(response, 200, await ssh.testConnection(id, { hostKeyFingerprint: payload?.fingerprint ?? null }));
      return;
    }
    // v41 波一：远程环境治理（探测 / CLI 安装 / 一键同步本机配置）
    // 注意：/sync-config 已被「从 ~/.ssh/config 回同步主机参数」占用（上方既有分支），
    // 本面端点一律用 /env-sync 命名避让——同名分支永远到不了（2026-08-11 路由冲突实锤）。
    id = idOf(url, "probe");
    if (id) {
      const ops = (remoteOps ??= createRemoteOps(ssh));
      ctx.json(response, 200, { ok: true, probe: await ops.probe(id) });
      return;
    }
    id = idOf(url, "proxy-diagnose");
    if (id) {
      const ops = (remoteOps ??= createRemoteOps(ssh));
      ctx.json(response, 200, { ok: true, diagnosis: await ops.diagnoseProxy(id) });
      return;
    }
    id = idOf(url, "install-cli");
    if (id) {
      await recoveryLedger.assertHostWritable(id);
      const ops = (remoteOps ??= createRemoteOps(ssh));
      ctx.json(response, 200, { ok: true, ...(await ops.installCli(id, payload?.toolId, { platform: payload?.platform })) });
      return;
    }
    id = idOf(url, "env-sync");
    if (id) {
      ctx.remoteGates.assert("sftp"); // 写远端文件叠加 sftp 闸（sftp/write 同款先例）
      const ops = (remoteOps ??= createRemoteOps(ssh));
      const result = await runRegisteredRemoteWrite(recoveryLedger, { hostId: id }, "sync", (transactionId) => ops.syncConfig(id, payload?.files, { transactionId }));
      ctx.json(response, 200, { ok: true, ...result });
      return;
    }
    id = idOf(url, "recovery/reconcile");
    if (id) {
      ctx.remoteGates.assert("sftp");
      const recovery = recoveryRequest(payload);
      const result = await reconcileRegisteredRemoteRecovery(recoveryLedger, { hostId: id }, recovery, async () => (
        recovery.kind === "provider"
          ? await (remoteConfig ??= createRemoteConfigService(ssh, ctx.state.providers, { eventStore: ctx.state.eventStore })).reconcileProvider(id, recovery.transactionId)
          : recovery.kind === "graph"
            ? await (remoteGraph ??= createRemoteGraph(ssh)).reconcileSource(id, recovery.transactionId)
            : await (remoteOps ??= createRemoteOps(ssh)).reconcileSync(id, recovery.transactionId)
      ));
      ctx.json(response, 200, { ok: true, ...result });
      return;
    }
    id = idOf(url, "graph/source");
    if (id) {
      ctx.remoteGates.assert("sftp");
      const graphOps = (remoteGraph ??= createRemoteGraph(ssh));
      const result = await runRegisteredRemoteWrite(recoveryLedger, { hostId: id }, "graph", (transactionId) => graphOps.writeSource(id, payload?.file, payload?.content, payload?.digest, { transactionId }));
      await ctx.state.eventStore?.emit("remote.source_write", { hostId: id, sourceId: payload?.file, remote: result.remote, bytes: result.bytes }).catch(() => {});
      ctx.json(response, 200, { ok: true, ...result });
      return;
    }
    // 备份恢复：原文只在服务端从备份读到 writeSource，浏览器只提交备份名与当前真源 digest
    id = idOf(url, "graph/backup/restore");
    if (id) {
      ctx.remoteGates.assert("sftp");
      const graphOps = (remoteGraph ??= createRemoteGraph(ssh));
      const result = await runRegisteredRemoteWrite(recoveryLedger, { hostId: id }, "graph", (transactionId) => graphOps.restoreBackup(id, payload?.file, payload?.name, payload?.digest, { transactionId }));
      await ctx.state.eventStore?.emit("remote.source_restore", { hostId: id, sourceId: payload?.file, remote: result.remote, backup: result.restoredFrom, bytes: result.bytes }).catch(() => {});
      ctx.json(response, 200, { ok: true, ...result });
      return;
    }
    id = idOf(url, "provider-apply");
    if (id) {
      ctx.remoteGates.assert("sftp");
      const configOps = (remoteConfig ??= createRemoteConfigService(ssh, ctx.state.providers, { eventStore: ctx.state.eventStore }));
      const result = await runRegisteredRemoteWrite(recoveryLedger, { hostId: id }, "provider", (transactionId) => configOps.applyProvider(
        id,
        payload?.app,
        payload?.providerId,
        { planRevision: payload?.planRevision, transactionId },
      ));
      ctx.json(response, 200, { ok: true, ...result });
      return;
    }
    id = idOf(url, "exec");
    if (id) {
      await recoveryLedger.assertHostWritable(id);
      ctx.json(response, 200, { ok: true, ...(await ssh.exec(id, { ...payload })) });
      return;
    }
    id = idOf(url, "sftp/write");
    if (id) {
      ctx.remoteGates.assert("sftp");
      await recoveryLedger.assertHostWritable(id);
      ctx.json(response, 200, await ssh.sftpWrite(id, payload?.path, payload?.content ?? "", { hostKeyFingerprint: payload?.fingerprint ?? null }));
      return;
    }
    ctx.json(response, 404, { ok: false, code: "NOT_FOUND", message: "unknown ssh route" });
  }));

  router.delete("/api/ssh/hosts/", guarded("ssh", async (request, response, url) => {
    const id = idOf(url);
    if (!id) {
      ctx.json(response, 404, { ok: false, code: "NOT_FOUND", message: "unknown ssh route" });
      return;
    }
    await recoveryLedger.assertHostWritable(id);
    const removed = await ssh.remove(id);
    ctx.json(response, removed ? 200 : 404, removed
      ? { ok: true }
      : { ok: false, code: "SSH_NOT_FOUND", message: `host not found: ${id}` });
  }));
}
