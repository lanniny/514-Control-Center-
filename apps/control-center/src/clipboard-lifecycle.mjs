import { timingSafeEqual } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const MANAGED_CLIPBOARD_FILE = /^clipboard-[a-z0-9-]+\.(?:png|jpg|gif|webp)$/i;
const MANAGED_CLIPBOARD_TEMP_FILE = /^\.clipboard-[a-z0-9-.]+\.tmp$/i;
const lifecycleLocks = new Map();
const pendingClipboardUploads = new Map();

export const PENDING_CLIPBOARD_UPLOAD_TTL_MS = 2 * 60_000;

function pathKey(path) {
  const value = resolve(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function pendingRegistryKey(dataRoot) {
  return pathKey(clipboardStorageRoot(dataRoot));
}

function pendingRegistry(dataRoot, { create = false } = {}) {
  const key = pendingRegistryKey(dataRoot);
  let registry = pendingClipboardUploads.get(key);
  if (!registry && create) {
    registry = new Map();
    pendingClipboardUploads.set(key, registry);
  }
  return { key, registry };
}

function prunePendingClipboardUploads(dataRoot, nowMs) {
  const { key, registry } = pendingRegistry(dataRoot);
  if (!registry) return null;
  for (const [keyPath, entry] of registry) {
    if (entry.expiresAt <= nowMs) registry.delete(keyPath);
  }
  if (!registry.size) {
    pendingClipboardUploads.delete(key);
    return null;
  }
  return registry;
}

function clipboardClaimError() {
  return Object.assign(new Error("clipboard upload claim is invalid or expired"), {
    code: "CLIPBOARD_CLAIM_INVALID",
  });
}

function claimTokensEqual(left, right) {
  const leftBytes = Buffer.from(String(left || ""));
  const rightBytes = Buffer.from(String(right || ""));
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function releasePendingClipboardUploads(dataRoot, paths) {
  const { key, registry } = pendingRegistry(dataRoot);
  if (!registry) return;
  for (const path of paths) registry.delete(pathKey(path));
  if (!registry.size) pendingClipboardUploads.delete(key);
}

export function clipboardStorageRoot(dataRoot) {
  if (!dataRoot) throw Object.assign(new Error("clipboard data root is required"), { code: "VALIDATION_FAILED" });
  return resolve(dataRoot, "uploads", "clipboard");
}

export function isManagedClipboardFileName(name) {
  return MANAGED_CLIPBOARD_FILE.test(String(name || ""));
}

export function isManagedClipboardTemporaryFileName(name) {
  return MANAGED_CLIPBOARD_TEMP_FILE.test(String(name || ""));
}

export function isManagedClipboardPath(dataRoot, candidate) {
  if (!candidate) return false;
  const root = clipboardStorageRoot(dataRoot);
  const path = resolve(String(candidate));
  return pathKey(dirname(path)) === pathKey(root) && isManagedClipboardFileName(basename(path));
}

export function registerPendingClipboardUpload({
  dataRoot,
  path,
  claimToken,
  now = () => Date.now(),
  ttlMs = PENDING_CLIPBOARD_UPLOAD_TTL_MS,
} = {}) {
  const token = String(claimToken || "");
  const nowMs = Number(now());
  if (!isManagedClipboardPath(dataRoot, path)
    || !/^[a-z0-9_-]{16,128}$/i.test(token)
    || !Number.isFinite(nowMs)
    || !Number.isFinite(ttlMs)
    || ttlMs <= 0) {
    throw clipboardClaimError();
  }
  prunePendingClipboardUploads(dataRoot, nowMs);
  const { registry } = pendingRegistry(dataRoot, { create: true });
  const entry = {
    path: resolve(path),
    claimToken: token,
    expiresAt: nowMs + ttlMs,
  };
  registry.set(pathKey(path), entry);
  return { claimToken: token, claimExpiresAt: new Date(entry.expiresAt).toISOString() };
}

export function pendingClipboardUploadPaths({ dataRoot, now = () => Date.now() } = {}) {
  const nowMs = Number(now());
  if (!Number.isFinite(nowMs)) throw clipboardClaimError();
  const registry = prunePendingClipboardUploads(dataRoot, nowMs);
  return registry ? [...registry.values()].map((entry) => entry.path) : [];
}

export async function claimPendingClipboardUpload({
  dataRoot,
  path,
  claimToken,
  now = () => Date.now(),
} = {}) {
  if (!isManagedClipboardPath(dataRoot, path)) throw clipboardClaimError();
  return withClipboardLifecycleLock(dataRoot, async () => {
    const nowMs = Number(now());
    if (!Number.isFinite(nowMs)) throw clipboardClaimError();
    const registry = prunePendingClipboardUploads(dataRoot, nowMs);
    const entry = registry?.get(pathKey(path));
    if (!entry || !claimTokensEqual(entry.claimToken, claimToken)) throw clipboardClaimError();
    releasePendingClipboardUploads(dataRoot, [entry.path]);
    return { claimed: true, path: entry.path };
  });
}

export async function withClipboardLifecycleLock(dataRoot, operation) {
  if (typeof operation !== "function") throw new TypeError("clipboard lifecycle operation must be a function");
  const root = clipboardStorageRoot(dataRoot);
  const lockKey = pathKey(root);
  const previous = lifecycleLocks.get(lockKey) ?? Promise.resolve();
  let release;
  const current = new Promise((resolveCurrent) => { release = resolveCurrent; });
  lifecycleLocks.set(lockKey, current);
  await previous.catch(() => {});
  try {
    return await operation(root);
  } finally {
    release();
    if (lifecycleLocks.get(lockKey) === current) lifecycleLocks.delete(lockKey);
  }
}

export async function withManagedClipboardSourceRegistration({
  dataRoot,
  sources,
  operation,
  storage = { stat },
} = {}) {
  if (typeof operation !== "function") throw new TypeError("clipboard source registration operation must be a function");
  const managedSources = (Array.isArray(sources) ? sources : [])
    .map((source) => String(typeof source === "string" ? source : source?.path || ""))
    .filter((path) => isManagedClipboardPath(dataRoot, path));
  if (!managedSources.length) return operation();

  return withClipboardLifecycleLock(dataRoot, async () => {
    for (const path of managedSources) {
      let info;
      try {
        info = await storage.stat(path);
      } catch (cause) {
        throw Object.assign(new Error(`clipboard source no longer exists: ${basename(path)}`), {
          code: "SOURCE_NOT_FOUND",
          cause,
        });
      }
      if (!info?.isFile?.()) {
        throw Object.assign(new Error(`clipboard source is not a file: ${basename(path)}`), { code: "SOURCE_NOT_FOUND" });
      }
    }
    const result = await operation();
    releasePendingClipboardUploads(dataRoot, managedSources);
    return result;
  });
}
