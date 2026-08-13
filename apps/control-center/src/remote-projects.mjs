/**
 * remote-projects.mjs — 远程项目台账（第一个真正的 projects 持久层）。
 *
 * 背景：本地「项目」是 CLI 会话目录的扫描投影（sessions.mjs），本机不存在远程路径的投影源。
 * 远程项目是显式登记的元数据：{ name, hostId, path }——hostId 引用 SSH 台账（凭据永不落此文件），
 * path 是远程主机上的 POSIX 绝对路径。登记不连网、不探测远端路径存在性（目录浏览已证明，
 * 手输场景如实登记，连不上在后续 SSH/SFTP 消费端如实报错）。
 *
 * 台账：dataRoot/remote-projects.json，schema 514cc.remote-projects/v1，原子写（tmp+rename）。
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SCHEMA = "514cc.remote-projects/v1";

function remoteProjectError(code, message, httpStatus = 400) {
  return Object.assign(new Error(message), { code, httpStatus });
}

function invalidLedger(message) {
  return remoteProjectError("REMOTE_PROJECT_LEDGER_INVALID", message, 500);
}

function parseLedger(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw Object.assign(invalidLedger("remote projects ledger contains invalid JSON"), { cause: error });
  }
  if (parsed?.schema !== SCHEMA) {
    throw invalidLedger(`unsupported remote projects ledger schema: ${String(parsed?.schema ?? "missing")}`);
  }
  if (!Array.isArray(parsed.records)) {
    throw invalidLedger("remote projects ledger records must be an array");
  }
  for (const record of parsed.records) {
    if (
      !record
      || typeof record !== "object"
      || Array.isArray(record)
      || typeof record.id !== "string"
      || !record.id
      || typeof record.name !== "string"
      || !record.name
      || typeof record.hostId !== "string"
      || !record.hostId
      || typeof record.path !== "string"
      || !record.path
      || typeof record.createdAt !== "string"
      || !record.createdAt
    ) {
      throw invalidLedger("remote projects ledger contains an invalid record");
    }
  }
  return parsed.records;
}

/** 名称：必填，trim 后 1..80，拒控制字符。 */
function sanitizeName(value) {
  const name = String(value ?? "").trim();
  if (!name || name.length > 80 || /[\0-\x1f]/.test(name)) {
    throw remoteProjectError("INVALID_REMOTE_PROJECT", "name is required (1-80 chars, no control characters)");
  }
  return name;
}

/** 远程路径：POSIX 绝对路径语义——必须 / 开头，拒 NUL/反斜杠/`..` 段，≤500 字符。 */
export function sanitizeRemotePath(value) {
  const path = String(value ?? "").trim();
  if (!path || path.includes("\0")) {
    throw remoteProjectError("INVALID_REMOTE_PATH", "remote path is required");
  }
  if (path.length > 500) {
    throw remoteProjectError("INVALID_REMOTE_PATH", "remote path too long (max 500 chars)");
  }
  if (!path.startsWith("/") || path.includes("\\")) {
    throw remoteProjectError("INVALID_REMOTE_PATH", `remote path must be a POSIX absolute path: ${path}`);
  }
  if (path.split("/").includes("..")) {
    throw remoteProjectError("INVALID_REMOTE_PATH", `remote path must not contain '..': ${path}`);
  }
  return path;
}

export function createRemoteProjectsService({ dataRoot, sshService, fileSystem = {} }) {
  const ledgerPath = join(dataRoot, "remote-projects.json");
  const fs = { mkdir, readFile, rename, unlink, writeFile, ...fileSystem };
  let records = Object.freeze([]);
  let loaded = false;
  let loadPromise = null;
  let writeChain = Promise.resolve();

  function immutableRecords(nextRecords) {
    return Object.freeze(nextRecords.map((record) => Object.freeze({ ...record })));
  }

  async function init() {
    if (loaded) return;
    if (!loadPromise) {
      loadPromise = (async () => {
        let loadedRecords = [];
        try {
          loadedRecords = parseLedger(await fs.readFile(ledgerPath, "utf8"));
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        records = immutableRecords(loadedRecords);
        loaded = true;
      })().catch((error) => {
        loadPromise = null;
        throw error;
      });
    }
    await loadPromise;
  }

  async function ensureLoaded() {
    if (!loaded) await init();
  }

  async function persist(nextRecords) {
    await fs.mkdir(dataRoot, { recursive: true });
    const tmp = `${ledgerPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify({ schema: SCHEMA, records: nextRecords }, null, 2), "utf8");
      await fs.rename(tmp, ledgerPath);
    } catch (error) {
      try {
        await fs.unlink(tmp);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") error.cleanupError = cleanupError;
      }
      throw error;
    }
  }

  function enqueueWrite(operation) {
    const queued = writeChain.then(async () => {
      await ensureLoaded();
      return operation();
    });
    writeChain = queued.catch(() => {});
    return queued;
  }

  function hostById(hostId) {
    return sshService?.list?.().find((host) => host.id === hostId) ?? null;
  }

  /** 出参：记录 + join 主机公开信息（无凭据）；主机已从台账移除如实标 hostMissing，不静默删记录。 */
  function publicProject(record) {
    const host = hostById(record.hostId);
    return {
      ...record,
      host: host
        ? {
            id: host.id,
            name: host.name,
            host: host.host,
            port: host.port,
            user: host.user,
            enabled: host.enabled !== false,
            trusted: Boolean(host.trusted),
          }
        : null,
      hostMissing: !host,
    };
  }

  async function create(payload) {
    return enqueueWrite(async () => {
      const name = sanitizeName(payload?.name);
      const hostId = String(payload?.hostId ?? "").trim();
      const host = hostById(hostId);
      if (!host) throw remoteProjectError("REMOTE_HOST_NOT_FOUND", `host not found or SSH ledger unavailable: ${hostId}`, 404);
      if (host.enabled === false) throw remoteProjectError("REMOTE_HOST_DISABLED", `host is disabled: ${host.name}`, 409);
      const path = sanitizeRemotePath(payload?.path);
      const duplicate = records.find((record) => record.hostId === hostId && record.path === path);
      if (duplicate) throw remoteProjectError("REMOTE_PROJECT_EXISTS", `remote project already registered: ${duplicate.name} (${path})`, 409);

      const record = { id: `rp-${randomUUID()}`, name, hostId, path, createdAt: new Date().toISOString() };
      const nextRecords = immutableRecords([...records, record]);
      await persist(nextRecords);
      records = nextRecords;
      return publicProject(record);
    });
  }

  async function list() {
    await ensureLoaded();
    return records.map(publicProject);
  }

  async function get(id) {
    await ensureLoaded();
    const record = records.find((entry) => entry.id === String(id ?? ""));
    return record ? publicProject(record) : null;
  }

  async function remove(id) {
    return enqueueWrite(async () => {
      const nextRecords = immutableRecords(records.filter((record) => record.id !== id));
      if (nextRecords.length === records.length) return false;
      await persist(nextRecords);
      records = nextRecords;
      return true;
    });
  }

  return { init, create, list, get, remove };
}
