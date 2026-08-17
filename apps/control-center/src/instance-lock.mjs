import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { queryProcessIdentity } from "./child-registry.mjs";

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

export async function lockOwnerIsActive(owner, {
  platform = process.platform,
  identityProbe = queryProcessIdentity,
} = {}) {
  const pid = Number(owner?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !processIsAlive(pid)) return false;
  if (platform !== "win32") return true;

  let identity;
  try {
    identity = await identityProbe(pid);
  } catch {
    return true; // 探针失败不能证明旧主已死，保持 fail-closed。
  }
  if (identity === null) return false;
  if (!identity) return true;

  const expectedImage = String(owner?.image ?? "").toLowerCase();
  const liveImage = String(identity.image ?? "").toLowerCase();
  if (expectedImage && liveImage && expectedImage !== liveImage) return false;

  const ownerStartedMs = Date.parse(owner?.startedAt ?? "");
  const liveStartedMs = Date.parse(identity.createdAt ?? "");
  if (Number.isFinite(ownerStartedMs) && Number.isFinite(liveStartedMs)) {
    // StartTime 与 JS 时间戳来自不同时钟源，沿用 child registry 的 2 秒容差。
    return liveStartedMs <= ownerStartedMs + 2_000;
  }
  return true;
}

export async function acquireInstanceLock(lockRoot, metadata = {}, { ownerIsActive = lockOwnerIsActive } = {}) {
  await mkdir(lockRoot, { recursive: true });
  const path = join(lockRoot, "control-center.lock");
  const nonce = randomUUID();
  const owner = {
    ...metadata,
    pid: process.pid,
    nonce,
    startedAt: new Date().toISOString(),
    image: basename(process.execPath).toLowerCase(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      await handle.sync();
      let released = false;
      let handleClosed = false;
      return {
        path,
        owner,
        async release() {
          if (released) return;
          if (!handleClosed) {
            await handle.close().catch(() => {});
            handleClosed = true;
          }
          try {
            const current = JSON.parse(await readFile(path, "utf8"));
            if (current.nonce === nonce) await unlink(path);
            released = true;
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
            released = true;
          }
        },
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let existing = null;
      try { existing = JSON.parse(await readFile(path, "utf8")); } catch {}
      if (existing && await ownerIsActive(existing)) {
        throw Object.assign(new Error(`another Control Center instance owns ${metadata.repoRoot || lockRoot}`), {
          code: "INSTANCE_ACTIVE",
          owner: existing,
        });
      }
      await unlink(path).catch((unlinkError) => {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      });
    }
  }
  throw Object.assign(new Error("could not acquire Control Center instance lock"), { code: "INSTANCE_ACTIVE" });
}
