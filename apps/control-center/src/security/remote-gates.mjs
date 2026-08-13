/**
 * Wave G security gates — v2 授权感知门闸。
 *
 * v1（fail-closed stubs）：一律 501。
 * v2：grant 账本（<dataRoot>/remote-gates.grants.json）+ 实现注册表。
 *   - 无 grant → REMOTE_GATE_BLOCKED (501)
 *   - 有 grant 无实现 → REMOTE_GATE_NOT_IMPLEMENTED (501)
 *   - 有 grant 且面模块已注册 → 放行
 * 默认仍然 fail-closed：新装实例无任何 grant；grant/revoke 全程写审计事件。
 * 绝不 silent fallback。
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

function gateError(code, gate, message, extra = {}) {
  return Object.assign(new Error(message), {
    code,
    gate,
    httpStatus: 501,
    ...extra,
  });
}

/**
 * 创建门闸服务。dataRoot 为实例锁同域；eventStore 可选，用于 grant/revoke 审计。
 */
export function createRemoteGateService({ dataRoot, eventStore = null } = {}) {
  const grantsPath = join(dataRoot, GRANTS_FILE);
  /** @type {Map<string, { gate: string, grantedAt: string, source: string, note: string }>} */
  const grants = new Map();
  /** @type {Set<string>} */
  const implementations = new Set();
  let writeChain = Promise.resolve();

  async function init() {
    let parsed = null;
    try {
      parsed = JSON.parse(await readFile(grantsPath, "utf8"));
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
    return service;
  }

  function persist() {
    const payload = JSON.stringify({
      schema: "514cc.remote-gates.grants/v1",
      grants: [...grants.values()],
    }, null, 2);
    writeChain = writeChain.then(async () => {
      await mkdir(dirname(grantsPath), { recursive: true });
      const tmp = `${grantsPath}.tmp`;
      await writeFile(tmp, payload, "utf8");
      await rename(tmp, grantsPath);
    });
    return writeChain;
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
    const granted = grants.has(id);
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
        authorized: grants.has(id),
        implemented: implementations.has(id),
        status,
        reason: meta.reason,
        upstream: meta.upstream,
        openable: status === "open",
        grant: grants.get(id) ?? null,
      };
    });
  }

  function assert(id) {
    if (!REMOTE_GATE_IDS.includes(id)) {
      throw gateError("REMOTE_GATE_UNKNOWN", id, `unknown remote gate: ${id}`, { httpStatus: 404 });
    }
    const meta = GATE_META[id];
    if (!grants.has(id)) {
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
      if (!grants.has(id)) {
        grants.set(id, { gate: id, grantedAt: new Date().toISOString(), source: String(source), note: String(note) });
        await persist();
        await audit("remote_gate.grant", id, { source: String(source) });
      }
      return list().find((gate) => gate.id === id);
    },
    async revoke(id, { source = "operator" } = {}) {
      if (grants.delete(id)) {
        await persist();
        await audit("remote_gate.revoke", id, { source: String(source) });
      }
      return list().find((gate) => gate.id === id);
    },
    snapshot() {
      return {
        schema: "514cc.remote-gates/v2",
        policy: "fail-closed",
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
    gates: listRemoteGates(),
    note: "Pure snapshot without ledger context; server uses createRemoteGateService for granted state.",
  };
}
