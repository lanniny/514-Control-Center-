/**
 * Wave G security gates — v2 授权感知门闸。
 *
 * v1（fail-closed stubs）：一律 501。
 * v2：grant 账本（<dataRoot>/remote-gates.grants.json）+ 可恢复 revoke tombstone
 * （<dataRoot>/remote-gates.revocations.json）+ 实现注册表。
 *   - 无 grant → REMOTE_GATE_BLOCKED (501)
 *   - 有 grant 无实现 → REMOTE_GATE_NOT_IMPLEMENTED (501)
 *   - 有 grant 且面模块已注册 → 放行
 * 默认仍然 fail-closed：新装实例无任何 grant；grant/revoke 全程写审计事件。
 * 绝不 silent fallback。
 */

import {
  mkdir as defaultMkdir,
  readFile as defaultReadFile,
  rename as defaultRename,
  writeFile as defaultWriteFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

export const REMOTE_GATE_IDS = Object.freeze([
  "channels",
  "gateway",
  "office",
  "pty",
  "ssh",
  "sftp",
  "skills_marketplace",
  "mcp_marketplace",
  "remote_web",
]);

const GATE_META = Object.freeze({
  channels: {
    title: "Chat Channels",
    reason: "出网凭据 + webhook 攻击面；需 allowlist/rate-limit/HMAC 设计（v4.0 Wave G 已落地）",
    upstream: "Codeg Telegram/Lark/Weixin",
  },
  gateway: {
    title: "Remote Gateway",
    reason: "第三运行时 + 远程鉴权/RBAC/CSRF 未落地；禁止作为控制面内核",
    upstream: "LiveAgent Go Gateway",
  },
  office: {
    title: "Office runtime",
    reason: "进程内 OOXML 生成 + 输出围栏（v4.0 Wave G 替代外挂 officecli 方案）",
    upstream: "Codeg officecli",
  },
  pty: {
    title: "Local PTY multi-terminal",
    reason: "沙箱 cwd + 进程审计 + 取消/背压契约（v4.0 Wave G 已落地）",
    upstream: "Codeg/LiveAgent xterm",
  },
  ssh: {
    title: "SSH terminal",
    reason: "凭据引用制 + known_hosts 指纹确认 + 权限作用域（v4.0 Wave G 已落地）",
    upstream: "LiveAgent SSH",
  },
  sftp: {
    title: "SFTP",
    reason: "与 SSH 同门：凭据引用 + 路径白名单围栏（v4.0 Wave G 已落地）",
    upstream: "LiveAgent SFTP",
  },
  skills_marketplace: {
    title: "Skills marketplace install",
    reason: "stage-then-swap 原子安装 + 来源 allowlist + 哈希台账（v4.0 Wave G 已落地）",
    upstream: "Codeg/LiveAgent hubs",
  },
  mcp_marketplace: {
    title: "MCP marketplace install",
    reason: "暂存审查（权限/命令/环境变量）→ 确认落库 + 哈希台账（v4.0 Wave G 补强 codeg 缺失的校验层）",
    upstream: "Codeg/LiveAgent hubs",
  },
  remote_web: {
    title: "Remote WebUI binding",
    reason: "控制面默认 loopback-only；非本机绑定需 auth/RBAC 设计",
    upstream: "Codeg web service / LiveAgent remote",
  },
});

const GRANTS_FILE = "remote-gates.grants.json";
const REVOCATIONS_FILE = "remote-gates.revocations.json";
const REVOCATION_SEMANTICS = Object.freeze({
  mode: "block-future-dispatches",
  activeRemoteExecutions: "not-automatically-cancelled",
  cleanup: "operator-cancel-remains-available",
});
const DEFAULT_STORAGE = Object.freeze({
  mkdir: defaultMkdir,
  readFile: defaultReadFile,
  rename: defaultRename,
  writeFile: defaultWriteFile,
});

function gateError(code, gate, message, extra = {}) {
  return Object.assign(new Error(message), {
    code,
    gate,
    httpStatus: 501,
    ...extra,
  });
}

function persistenceError(gate, phase, error) {
  return gateError(
    "REMOTE_GATE_PERSISTENCE_FAILED",
    gate,
    `remote gate ${gate} persistence failed during ${phase}`,
    {
      httpStatus: 503,
      phase,
      causeCode: error?.code || null,
      cause: error,
    },
  );
}

/**
 * 创建门闸服务。dataRoot 为实例锁同域；eventStore 可选，用于 grant/revoke 审计。
 */
export function createRemoteGateService({ dataRoot, eventStore = null, storage = DEFAULT_STORAGE } = {}) {
  const grantsPath = join(dataRoot, GRANTS_FILE);
  const revocationsPath = join(dataRoot, REVOCATIONS_FILE);
  /** @type {Map<string, { gate: string, grantedAt: string, source: string, note: string }>} */
  const grants = new Map();
  // revoke 持久化失败时保留当前进程的 deny override：宁可重启前继续阻断，也不能
  // 因为账本写失败又把远程能力放开。成功持久化后再从该集合移除。
  const runtimeRevocations = new Set();
  /** @type {Map<string, { gate: string, revokedAt: string, source: string }>} */
  const revocations = new Map();
  /** @type {Set<string>} */
  const implementations = new Set();
  let mutationChain = Promise.resolve();

  async function init() {
    grants.clear();
    revocations.clear();
    runtimeRevocations.clear();
    let parsed = null;
    try {
      parsed = JSON.parse(await storage.readFile(grantsPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const entry of parsed?.grants ?? []) {
      if (REMOTE_GATE_IDS.includes(entry?.gate) && !grants.has(entry.gate)) {
        grants.set(entry.gate, {
          gate: entry.gate,
          grantedAt: String(entry.grantedAt || ""),
          source: String(entry.source || "unknown"),
          note: String(entry.note || ""),
        });
      }
    }
    // revoke tombstone 比 grants snapshot 更保守：主文件或上次未完成 rename 留下的
    // .tmp 任一包含撤销，都必须在重启后继续 blocked，不能让旧 grant 回生。
    for (const path of [revocationsPath, `${revocationsPath}.tmp`]) {
      let tombstones = null;
      try {
        tombstones = JSON.parse(await storage.readFile(path, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      for (const entry of tombstones?.revocations ?? []) {
        if (REMOTE_GATE_IDS.includes(entry?.gate)) {
          revocations.set(entry.gate, {
            gate: entry.gate,
            revokedAt: String(entry.revokedAt || ""),
            source: String(entry.source || "unknown"),
          });
        }
      }
    }
    // snapshot 可能因 compaction 失败仍保留旧 grant；它只是缓存，tombstone 才是撤销真相。
    for (const id of revocations.keys()) grants.delete(id);
    return service;
  }

  function hasEffectiveGrant(id) {
    return grants.has(id) && !revocations.has(id) && !runtimeRevocations.has(id);
  }

  function replaceGrants(nextGrants) {
    grants.clear();
    for (const [id, entry] of nextGrants) grants.set(id, entry);
  }

  function replaceRevocations(nextRevocations) {
    revocations.clear();
    for (const [id, entry] of nextRevocations) revocations.set(id, entry);
  }

  async function persistGrants(nextGrants) {
    const payload = JSON.stringify({
      schema: "514cc.remote-gates.grants/v1",
      grants: [...nextGrants.values()],
    }, null, 2);
    await storage.mkdir(dirname(grantsPath), { recursive: true });
    const tmp = `${grantsPath}.tmp`;
    await storage.writeFile(tmp, payload, "utf8");
    await storage.rename(tmp, grantsPath);
  }

  async function persistRevocations(nextRevocations) {
    const payload = JSON.stringify({
      schema: "514cc.remote-gates.revocations/v1",
      revocations: [...nextRevocations.values()],
    }, null, 2);
    await storage.mkdir(dirname(revocationsPath), { recursive: true });
    const tmp = `${revocationsPath}.tmp`;
    await storage.writeFile(tmp, payload, "utf8");
    await storage.rename(tmp, revocationsPath);
  }

  function enqueueMutation(operation) {
    const pending = mutationChain.then(operation);
    // 失败只拒绝当前调用；队尾恢复为 fulfilled，后续 grant/revoke 仍能重试。
    mutationChain = pending.catch(() => {});
    return pending;
  }

  async function audit(type, gate, detail = {}) {
    if (!eventStore?.append) return;
    try {
      await eventStore.append({ type, gate, ...detail });
    } catch {
      // 审计失败不阻断门闸判定，但也不静默——交由事件面暴露。
    }
  }

  function statusOf(id) {
    const granted = hasEffectiveGrant(id);
    const implemented = implementations.has(id);
    if (!granted) return "blocked";
    return implemented ? "open" : "granted";
  }

  function list() {
    return REMOTE_GATE_IDS.map((id) => {
      const meta = GATE_META[id];
      const status = statusOf(id);
      return {
        id,
        title: meta.title,
        enabled: status === "open",
        authorized: hasEffectiveGrant(id),
        implemented: implementations.has(id),
        status,
        reason: meta.reason,
        upstream: meta.upstream,
        openable: status === "open",
        grant: hasEffectiveGrant(id) ? grants.get(id) ?? null : null,
      };
    });
  }

  function assert(id) {
    if (!REMOTE_GATE_IDS.includes(id)) {
      throw gateError("REMOTE_GATE_UNKNOWN", id, `unknown remote gate: ${id}`, { httpStatus: 404 });
    }
    const meta = GATE_META[id];
    if (!hasEffectiveGrant(id)) {
      throw gateError("REMOTE_GATE_BLOCKED", id, `${meta.title} is blocked: ${meta.reason}`, { reason: meta.reason });
    }
    if (!implementations.has(id)) {
      throw gateError("REMOTE_GATE_NOT_IMPLEMENTED", id, `${meta.title} is authorized but not implemented in this build`);
    }
  }

  const service = {
    init,
    list,
    assert,
    isOpen: (id) => statusOf(id) === "open",
    /** 面模块在路由注册时调用，声明实现已就位。 */
    registerImplementation(id) {
      if (!REMOTE_GATE_IDS.includes(id)) {
        throw gateError("REMOTE_GATE_UNKNOWN", id, `unknown remote gate: ${id}`, { httpStatus: 404 });
      }
      implementations.add(id);
    },
    async grant(id, { source = "operator", note = "" } = {}) {
      if (!REMOTE_GATE_IDS.includes(id)) {
        throw gateError("REMOTE_GATE_UNKNOWN", id, `unknown remote gate: ${id}`, { httpStatus: 404 });
      }
      return enqueueMutation(async () => {
        if (!hasEffectiveGrant(id)) {
          const normalizedSource = String(source);
          const nextGrants = new Map(grants);
          nextGrants.set(id, {
            gate: id,
            grantedAt: new Date().toISOString(),
            source: normalizedSource,
            note: String(note),
          });
          const nextRevocations = new Map(revocations);
          const clearsRevocation = nextRevocations.delete(id);
          // grant 必须先落可审计账本；若存在 tombstone，再在 grant 已持久化后清除。
          // 任一步失败都保持 revoke 有效，不能因一次未完成 grant 在重启后意外开放。
          try {
            await persistGrants(nextGrants);
          } catch (error) {
            throw persistenceError(id, "grant-ledger", error);
          }
          if (clearsRevocation) {
            try {
              await persistRevocations(nextRevocations);
            } catch (error) {
              throw persistenceError(id, "grant-revocation-clear", error);
            }
          }
          replaceGrants(nextGrants);
          replaceRevocations(nextRevocations);
          runtimeRevocations.delete(id);
          await audit("remote_gate.grant", id, { source: normalizedSource });
        }
        return list().find((gate) => gate.id === id);
      });
    },
    async revoke(id, { source = "operator" } = {}) {
      if (!REMOTE_GATE_IDS.includes(id)) {
        throw gateError("REMOTE_GATE_UNKNOWN", id, `unknown remote gate: ${id}`, { httpStatus: 404 });
      }
      return enqueueMutation(async () => {
        if (grants.has(id) || revocations.has(id) || runtimeRevocations.has(id)) {
          const normalizedSource = String(source);
          runtimeRevocations.add(id); // 先在当前进程 fail-closed，再尝试固化 tombstone。
          const nextRevocations = new Map(revocations);
          nextRevocations.set(id, {
            gate: id,
            revokedAt: new Date().toISOString(),
            source: normalizedSource,
          });
          // tombstone 是跨重启的撤销真相，必须先于 grant snapshot 的清理落盘。
          try {
            await persistRevocations(nextRevocations);
          } catch (error) {
            throw persistenceError(id, "revoke-tombstone", error);
          }
          replaceRevocations(nextRevocations);
          const nextGrants = new Map(grants);
          nextGrants.delete(id);
          try {
            await persistGrants(nextGrants);
          } catch (error) {
            const wrapped = persistenceError(id, "revoke-grant-compaction", error);
            // 主 grants 文件可暂时陈旧，但 tombstone 已经 durable，当前进程与重启后都保持 blocked。
            await audit("remote_gate.revoke_compaction_failed", id, { source: normalizedSource, error: wrapped.message, causeCode: wrapped.causeCode });
            throw wrapped;
          }
          replaceGrants(nextGrants);
          runtimeRevocations.delete(id);
          await audit("remote_gate.revoke", id, { source: normalizedSource });
        }
        return list().find((gate) => gate.id === id);
      });
    },
    snapshot() {
      return {
        schema: "514cc.remote-gates/v2",
        policy: "fail-closed",
        revocationSemantics: REVOCATION_SEMANTICS,
        gates: list(),
        note: "Remote gates open only with an auditable grant AND a registered implementation. Defaults remain closed.",
      };
    },
  };
  return service;
}

// ---- 兼容层：保留 v1 纯函数签名（旧测试与静态调用点），语义对齐 v2 纯内存判定 ----

export function listRemoteGates({ authorized = [], implemented = [] } = {}) {
  const allowed = new Set(authorized);
  const impl = new Set(implemented);
  return REMOTE_GATE_IDS.map((id) => {
    const meta = GATE_META[id];
    const isAuthorized = allowed.has(id);
    const isImplemented = impl.has(id);
    const status = !isAuthorized ? "blocked" : isImplemented ? "open" : "granted";
    return {
      id,
      title: meta.title,
      enabled: status === "open",
      authorized: isAuthorized,
      implemented: isImplemented,
      status,
      reason: meta.reason,
      upstream: meta.upstream,
      openable: status === "open",
      grant: null,
    };
  });
}

export function assertRemoteGate(id, { authorized = [], implemented = [] } = {}) {
  if (!REMOTE_GATE_IDS.includes(id)) {
    throw gateError("REMOTE_GATE_UNKNOWN", id, `unknown remote gate: ${id}`, { httpStatus: 404 });
  }
  const meta = GATE_META[id];
  if (!new Set(authorized).has(id)) {
    throw gateError("REMOTE_GATE_BLOCKED", id, `${meta.title} is blocked: ${meta.reason}`, { reason: meta.reason });
  }
  if (!new Set(implemented).has(id)) {
    throw gateError("REMOTE_GATE_NOT_IMPLEMENTED", id, `${meta.title} is authorized but not implemented in this build`);
  }
}

export function remoteGateSnapshot() {
  return {
    schema: "514cc.remote-gates/v2",
    policy: "fail-closed",
    revocationSemantics: REVOCATION_SEMANTICS,
    gates: listRemoteGates(),
    note: "Pure snapshot without ledger context; server uses createRemoteGateService for granted state.",
  };
}
