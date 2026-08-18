import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const FIRST_RUN_SCHEMA = "514cc.first-run-readiness/v1";
const DRAFT_STEPS = Object.freeze(["project-anchor", "default-team", "executable-seat", "unpaid-validation"]);

function shortText(value, limit = 180, fallback = "") {
  const clean = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (!clean) return fallback;
  return clean.length <= limit ? clean : `${clean.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function step(id, status, title, detail, nextStep = null) {
  return { id, status, title, detail, nextStep };
}

export function collectFirstRunReadiness({
  projectBridge = null,
  teams = [],
  defaultTeamId = "team-514cc",
  runtimeCatalog = [],
  health = [],
  healthMeta = null,
  releaseTruth = null,
  draft = null,
  remoteGates = [],
} = {}) {
  const team = (Array.isArray(teams) ? teams : []).find((item) => item?.id === defaultTeamId) || (Array.isArray(teams) ? teams[0] : null);
  const seats = Array.isArray(runtimeCatalog) ? runtimeCatalog : [];
  const executable = seats.filter((item) => item?.enabled !== false && (item?.command || item?.adapter || item?.runtimeProfileId));
  const probes = Array.isArray(health) ? health : [];
  const healthCapturedAt = Date.parse(String(healthMeta?.capturedAt || ""));
  const healthEvidenceFresh = healthMeta?.available === true
    && healthMeta?.stale === false
    && Number.isFinite(healthCapturedAt);
  const probed = healthEvidenceFresh
    && probes.some((item) => ["online", "degraded", "offline"].includes(String(item?.status || "").toLowerCase()));
  const alignedValidation = releaseTruth?.validationEvidence?.status === "passed"
    && releaseTruth?.validationEvidence?.matchesSource === true
    && releaseTruth?.consistency === "consistent";
  const unpaidValidationReady = probed || alignedValidation;
  const gated = (Array.isArray(remoteGates) ? remoteGates : []).filter((item) => item?.blocked === true || item?.status === "blocked");

  const steps = [
    step(
      "project-anchor",
      projectBridge?.anchorId ? (projectBridge.consistency === "degraded" ? "attention" : "ready") : "blocked",
      "项目锚点",
      projectBridge?.diagnosis || (projectBridge?.anchorId ? "已识别当前项目身份" : "还没有稳定项目锚点"),
      projectBridge?.anchorId ? null : "打开工作台环境舱，确认项目桥四面",
    ),
    step(
      "default-team",
      team?.id ? "ready" : "blocked",
      "默认团队",
      team?.name ? `将使用 ${team.name}` : "没有可派工的默认团队",
      team?.id ? null : "到团队视图创建或启用一个团队",
    ),
    step(
      "executable-seat",
      executable.length ? "ready" : "blocked",
      "可执行席位",
      executable.length ? `${executable.length} 个席位可派工` : "没有已启用的可执行席位",
      executable.length ? null : "到配置图谱启用至少一个 CLI 席位",
    ),
    step(
      "unpaid-validation",
      unpaidValidationReady ? "ready" : "attention",
      "一次非付费验证",
      probed
        ? "健康探针已回读，这不是付费模型调用"
        : alignedValidation
          ? "验证证据已与当前提交和运行态对齐"
          : releaseTruth?.validationEvidence?.status === "passed"
            ? "存在历史验证记录，但未与当前提交和运行态对齐"
            : "还没有本机健康探针或当轮对齐验证证据",
      unpaidValidationReady ? null : "打开健康页跑一次本机 CLI 探针，不要用付费对话代替",
    ),
  ];
  if (gated.length) {
    steps.push(step(
      "capability-gate",
      "gated",
      "能力门",
      `${gated.length} 个远程能力尚未授权，这是门闩不是故障`,
      "到远程门闸授权，而不是当红字重试",
    ));
  }

  const blocked = steps.filter((item) => item.status === "blocked");
  const ready = steps
    .filter((item) => item.id !== "capability-gate")
    .every((item) => item.status === "ready");
  const next = steps.find((item) => item.status === "blocked") || steps.find((item) => item.status === "gated") || steps.find((item) => item.status === "attention") || null;
  return {
    schema: FIRST_RUN_SCHEMA,
    generatedAt: new Date().toISOString(),
    ready,
    draft: draft && typeof draft === "object" ? draft : null,
    steps,
    nextAction: next
      ? { stepId: next.id, text: next.nextStep || next.detail }
      : { stepId: null, text: "四步已齐，可以派工。正式进程仍需当轮 readback 才能称为已激活" },
    blockedReason: blocked[0]?.detail || null,
  };
}

export function createFirstRunDraftStore({ dataRoot }) {
  const path = join(dataRoot, "first-run-draft.json");
  let cache = null;
  let chain = Promise.resolve();

  async function load() {
    if (cache) return cache;
    try {
      cache = JSON.parse(await readFile(path, "utf8"));
    } catch {
      cache = null;
    }
    return cache;
  }

  function serialize(operation) {
    const next = chain.then(operation, operation);
    chain = next.then(() => undefined, () => undefined);
    return next;
  }

  return {
    load,
    save(draft) {
      return serialize(async () => {
        const next = {
          schema: FIRST_RUN_SCHEMA,
          savedAt: new Date().toISOString(),
          steps: Object.fromEntries(
            DRAFT_STEPS.map((id) => [id, shortText(draft?.steps?.[id], 240) || ""]),
          ),
        };
        await mkdir(dataRoot, { recursive: true });
        const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(tmp, `${JSON.stringify(next)}\n`, "utf8");
        await rename(tmp, path);
        cache = next;
        return next;
      });
    },
  };
}
