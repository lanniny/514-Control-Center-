import { stripVTControlCharacters } from "node:util";
import { runtimeDiagnosticAction } from "./adapters/manifest.mjs";
import { runProcess } from "./process-runner.mjs";
import { isSensitiveKeyName, sanitizeForPersistence, scrub } from "./redaction.mjs";
import { sanitizeStructuredText } from "./structured-redaction.mjs";

function parseStructuredDiagnostic(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return sanitizeStructuredText(text, {
    sanitizeValue: sanitizeForPersistence,
    scrubText: scrub,
    isSensitiveKey: isSensitiveKeyName,
  });
}

export function cleanAgentDiagnosticOutput(value) {
  const plainText = stripVTControlCharacters(String(value || ""));
  return (parseStructuredDiagnostic(plainText) || scrub(plainText)).replace(/\r\n/g, "\n").trim();
}

export function createAgentControlActionRunner({
  resolveMember,
  resolveProfile,
  modelDiscovery,
  repoRoot,
  eventStore,
  runProcessImpl = runProcess,
  maxConcurrentActions = 4,
} = {}) {
  if (typeof resolveMember !== "function" || typeof resolveProfile !== "function") {
    throw new TypeError("agent control actions require member and runtime profile resolvers");
  }
  if (!modelDiscovery?.invalidate || !modelDiscovery?.forAgent) {
    throw new TypeError("agent control actions require model discovery");
  }
  if (!Number.isSafeInteger(maxConcurrentActions) || maxConcurrentActions < 1 || maxConcurrentActions > 16) {
    throw new TypeError("agent control actions require maxConcurrentActions within [1, 16]");
  }

  const inFlightProfiles = new Set();

  return async function runAgentControlAction(memberId, actionId) {
    const normalizedMemberId = String(memberId || "").trim();
    const normalizedActionId = String(actionId || "").trim();
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(normalizedActionId)) {
      throw Object.assign(new Error("action id must use 1-48 lowercase letters, digits or hyphens"), {
        code: "VALIDATION_FAILED",
      });
    }
    const member = resolveMember(normalizedMemberId);
    const runtimeProfileId = String(member?.runtimeProfileId || "").trim();
    const profile = resolveProfile(runtimeProfileId);
    if (!profile) {
      throw Object.assign(new Error(`runtime profile not found: ${runtimeProfileId || "<missing>"}`), {
        code: "RUNTIME_PROFILE_NOT_FOUND",
        runtimeProfileId,
      });
    }

    if (inFlightProfiles.has(runtimeProfileId)) {
      throw Object.assign(new Error(`another CLI action is already running for ${runtimeProfileId}`), {
        code: "AGENT_ACTION_BUSY",
        runtimeProfileId,
        actionId: normalizedActionId,
      });
    }
    if (inFlightProfiles.size >= maxConcurrentActions) {
      throw Object.assign(new Error("CLI diagnostic action capacity is exhausted"), {
        code: "AGENT_ACTION_CAPACITY",
        actionId: normalizedActionId,
      });
    }

    inFlightProfiles.add(runtimeProfileId);
    try {
      if (normalizedActionId === "refresh-catalog") {
        modelDiscovery.invalidate(runtimeProfileId);
        const catalog = await modelDiscovery.forAgent(runtimeProfileId);
        return {
          actionId: normalizedActionId,
          status: "ok",
          runtimeProfileId,
          catalog: {
            ...catalog,
            context: { ...(catalog.context || {}), memberId: normalizedMemberId, runtimeProfileId },
          },
        };
      }

      const action = runtimeDiagnosticAction(profile, normalizedActionId);
      const result = await runProcessImpl(action.command, action.args, {
        cwd: repoRoot,
        provider: null,
        timeoutMs: action.timeoutMs,
        maxOutputBytes: action.maxOutputBytes,
      });
      const stdout = cleanAgentDiagnosticOutput(result.stdout);
      const stderr = cleanAgentDiagnosticOutput(result.stderr);
      const output = [stdout, stderr].filter(Boolean).join("\n");
      await eventStore?.emit?.("control.agent_action_completed", {
        actionId: normalizedActionId,
        runtimeProfileId,
        adapterId: action.adapterId,
        exitCode: result.code,
      }, { sensitivity: "internal", agentId: normalizedMemberId }).catch(() => {});

      return {
        actionId: normalizedActionId,
        status: result.code === 0 ? "ok" : "failed",
        runtimeProfileId,
        adapterId: action.adapterId,
        exitCode: result.code,
        output: output || `CLI exited ${result.code} without output`,
      };
    } finally {
      inFlightProfiles.delete(runtimeProfileId);
    }
  };
}
