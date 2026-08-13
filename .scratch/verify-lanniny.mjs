/**
 * verify-lanniny.mjs — lanniny-45 全链路真机验证：identityFile + trust + test + exec（只读命令）。
 * 与产品代码路径完全一致（createSshService），私钥只读入内存不落盘。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSshService } from "../apps/control-center/src/ssh.mjs";

process.on("uncaughtException", (error) => {
  console.error("=== UNCAUGHT ===", error);
  process.exit(42);
});
process.on("unhandledRejection", (error) => {
  console.error("=== UNHANDLED ===", error);
  process.exit(43);
});

const dir = await mkdtemp(join(tmpdir(), "514cc-verify-"));
try {
  const service = await createSshService({ dataRoot: dir }).init();
  const host = await service.create({
    name: "lanniny-45",
    host: "45.205.25.155",
    port: 51451,
    user: "lanniny",
    identityFile: "C:/Users/16643/.ssh/ssh",
  });
  console.log("1) created:", host.id, "identityFile:", host.identityFile);
  const captured = await service.captureFingerprint(host.id);
  console.log("2) captured:", captured.fingerprint);
  await service.trust(host.id, captured.fingerprint);
  console.log("3) trusted");
  const test = await service.testConnection(host.id);
  console.log("4) testConnection:", JSON.stringify(test));
  const result = await service.exec(host.id, { command: "echo 514cc-verify-ok && uname -a", timeoutMs: 15000 });
  console.log("5) exec code:", result.code, "stdout:", JSON.stringify(result.stdout), result.stderr ? `stderr: ${JSON.stringify(result.stderr)}` : "");
  await service.close();
  console.log("ALL-GREEN");
} catch (error) {
  console.error("STEP-FAILED:", error.code ?? "", error.message ?? error);
  process.exitCode = 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
