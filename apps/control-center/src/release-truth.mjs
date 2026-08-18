import { createHash } from "node:crypto";
import { runProcess } from "./process-runner.mjs";

export const RELEASE_TRUTH_SCHEMA = "514cc.releaseTruth/v1";
export const RELEASE_CONSISTENCY = Object.freeze(["consistent", "stale", "degraded", "unknown"]);

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function normalizeEvidence(value, sourceCommit, diffDigest, runtime = {}) {
  if (!value || typeof value !== "object") {
    return {
      status: "unknown",
      sourceCommit: null,
      commands: [],
      checkedAt: null,
      matchesSource: false,
      matchesWorkspace: false,
      matchesRuntime: false,
      complete: false,
      provenance: null,
      evidenceTrust: "none",
    };
  }
  const status = ["passed", "failed", "unknown"].includes(value.status) ? value.status : "unknown";
  const runtimePid = Number(value.runtimePid);
  const runtimeGeneration = Number(value.runtimeGeneration);
  const runtimeStartedAt = String(value.runtimeStartedAt ?? "").trim() || null;
  const evidenceDiffDigest = String(value.diffDigest ?? "").trim() || null;
  const matchesRuntime = Number.isSafeInteger(runtimePid)
    && runtimePid > 0
    && Number.isSafeInteger(runtimeGeneration)
    && runtimeGeneration >= 0
    && runtimeStartedAt
    && runtimePid === Number(runtime.pid)
    && runtimeGeneration === Number(runtime.generation)
    && runtimeStartedAt === String(runtime.startedAt ?? "").trim();
  return {
    status,
    sourceCommit: value.sourceCommit || null,
    commands: Array.isArray(value.commands) ? value.commands.slice(0, 12) : [],
    checkedAt: value.checkedAt || null,
    matchesSource: value.sourceCommit ? value.sourceCommit === sourceCommit : false,
    matchesWorkspace: Boolean(
      value.workspaceClean === true
      && evidenceDiffDigest
      && evidenceDiffDigest === diffDigest,
    ),
    matchesRuntime: Boolean(matchesRuntime),
    complete: value.complete === true,
    provenance: value.provenance === "server-observed" ? "server-observed" : null,
    evidenceTrust: value.evidenceTrust === "independent" ? "independent" : "none",
    diffDigest: evidenceDiffDigest,
    workspaceClean: value.workspaceClean === true,
    runtimePid: Number.isSafeInteger(runtimePid) ? runtimePid : null,
    runtimeGeneration: Number.isSafeInteger(runtimeGeneration) ? runtimeGeneration : null,
    runtimeStartedAt,
  };
}

export function classifyReleaseConsistency(snapshot, { pidAlive = false } = {}) {
  if (!snapshot?.sourceCommit || !pidAlive || snapshot.runtimeGeneration == null || snapshot.gitError) return "unknown";
  if (snapshot.dirty) return "stale";
  if (!["passed", "failed"].includes(snapshot.validationEvidence?.status)) return "unknown";
  if (!snapshot.validationEvidence?.sourceCommit) return "unknown";
  if (snapshot.validationEvidence?.complete !== true
    || snapshot.validationEvidence?.provenance !== "server-observed"
    || snapshot.validationEvidence?.evidenceTrust !== "independent") return "unknown";
  if (snapshot.validationEvidence?.matchesWorkspace !== true) return "unknown";
  if (snapshot.validationEvidence?.matchesRuntime !== true) return "unknown";
  if (snapshot.validationEvidence.sourceCommit !== snapshot.sourceCommit) return "stale";
  return snapshot.validationEvidence.status === "failed" ? "degraded" : "consistent";
}

export function activationClaim(truth) {
  if (!truth || truth.consistency === "unknown") {
    return { claimed: false, text: "未知：本轮没有可引用的 readback" };
  }
  if (truth.consistency !== "consistent") {
    return { claimed: false, text: `未激活：运行态 ${truth.consistency}` };
  }
  if (truth.validationEvidence?.status !== "passed"
    || !truth.validationEvidence?.matchesSource
    || !truth.validationEvidence?.matchesWorkspace
    || !truth.validationEvidence?.matchesRuntime) {
    return { claimed: false, text: "未激活：缺少指向当前提交的当轮验证证据" };
  }
  return {
    claimed: true,
    text: `已对账 ${String(truth.sourceCommit).slice(0, 12)} generation=${truth.runtimeGeneration}`,
  };
}

export async function collectReleaseTruth({
  repoRoot,
  runtime = {},
  runner = runProcess,
  now = () => new Date().toISOString(),
  validationEvidence = null,
} = {}) {
  let sourceCommit = null;
  let diffDigest = null;
  let dirty = false;
  let gitError = null;
  try {
    const head = await runner("git", ["-C", repoRoot, "rev-parse", "HEAD"], { timeoutMs: 8_000, provider: null });
    if (head?.code !== 0) {
      throw new Error(`git rev-parse exited ${head?.code ?? "without a code"}`);
    }
    sourceCommit = String(head.stdout || "").trim() || null;
    const porcelain = await runner("git", ["-C", repoRoot, "status", "--porcelain=v1"], { timeoutMs: 8_000, provider: null });
    if (porcelain?.code !== 0) {
      throw new Error(`git status exited ${porcelain?.code ?? "without a code"}`);
    }
    const statusText = String(porcelain.stdout || "");
    dirty = statusText.trim().length > 0;
    diffDigest = createHash("sha256").update(statusText, "utf8").digest("hex");
  } catch (error) {
    gitError = error?.message || String(error);
  }
  const pid = Number(runtime.pid ?? process.pid);
  const snapshot = {
    schema: RELEASE_TRUTH_SCHEMA,
    capturedAt: now(),
    sourceCommit,
    diffDigest,
    dirty,
    runtimeGeneration: runtime.generation ?? null,
    pid: Number.isSafeInteger(pid) ? pid : null,
    cwd: runtime.cwd ?? repoRoot ?? null,
    startedAt: runtime.startedAt ?? null,
    validationEvidence: normalizeEvidence(validationEvidence, sourceCommit, diffDigest, runtime),
    gitError,
  };
  snapshot.consistency = classifyReleaseConsistency(snapshot, { pidAlive: processIsAlive(pid) });
  snapshot.activation = activationClaim(snapshot);
  return snapshot;
}
