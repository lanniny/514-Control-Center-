/**
 * repro-capture.mjs — 用真实 service 代码复现 lanniny-45 的 captureFingerprint 崩溃。
 * 桌面壳 spawn 内核时 stderr 被丢弃，这里裸跑把 uncaught/unhandled 全打出来。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSshService } from "../apps/control-center/src/ssh.mjs";

process.on("uncaughtException", (error) => {
  console.error("=== UNCAUGHT EXCEPTION ===");
  console.error(error);
  process.exit(42);
});
process.on("unhandledRejection", (error) => {
  console.error("=== UNHANDLED REJECTION ===");
  console.error(error);
  process.exit(43);
});

const dir = await mkdtemp(join(tmpdir(), "514cc-repro-"));
try {
  const service = await createSshService({ dataRoot: dir }).init();
  const host = await service.create({ name: "lanniny-45", host: "45.205.25.155", port: 51451, user: "lanniny" });
  console.log("created host:", host.id);
  const result = await service.captureFingerprint(host.id);
  console.log("CAPTURED OK:", result);
  await service.close();
} catch (error) {
  console.error("CAPTURE REJECTED (handled, no crash):", error.code ?? "", error.message ?? error);
} finally {
  await rm(dir, { recursive: true, force: true });
}
console.log("SCRIPT DONE — 进程存活，未复现崩溃");
process.exit(0);
