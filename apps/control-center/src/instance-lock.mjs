import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

export async function acquireInstanceLock(lockRoot, metadata = {}) {
  await mkdir(lockRoot, { recursive: true });
  const path = join(lockRoot, "control-center.lock");
  const nonce = randomUUID();
  const owner = { pid: process.pid, nonce, startedAt: new Date().toISOString(), ...metadata };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      await handle.sync();
      let released = false;
      return {
        path,
        owner,
        async release() {
          if (released) return;
          released = true;
          await handle.close().catch(() => {});
          try {
            const current = JSON.parse(await readFile(path, "utf8"));
            if (current.nonce === nonce) await unlink(path);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        },
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let existing = null;
      try { existing = JSON.parse(await readFile(path, "utf8")); } catch {}
      if (existing && processIsAlive(Number(existing.pid))) {
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
