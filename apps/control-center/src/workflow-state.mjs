export const WORKFLOW_RUN_STATUSES = Object.freeze([
  "planning",
  "waiting_for_approval",
  "executing",
  "integrating",
  "verifying",
  "complete",
  "blocked",
  "cancelled",
  "superseded",
]);

export const WORKFLOW_PACKET_STATUSES = Object.freeze([
  "pending",
  "in_progress",
  "complete",
  "blocked",
  "superseded",
]);

export const WORKFLOW_TERMINAL = Object.freeze(["complete", "blocked", "cancelled", "superseded"]);
export const DEFAULT_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

function asTime(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function isWorkflowStale(state, { now = Date.now(), staleAfterMs = DEFAULT_STALE_AFTER_MS } = {}) {
  if (WORKFLOW_TERMINAL.includes(state?.status)) return false;
  const updated = asTime(state?.updated_at) ?? asTime(state?.created_at);
  if (updated == null) return true;
  return now - updated > staleAfterMs;
}

export function closeStaleWorkflow(state, {
  reason = "stale in_progress closed by releaseTruth R0",
  successor = null,
  now = new Date().toISOString(),
} = {}) {
  const packets = Array.isArray(state?.packets)
    ? state.packets.map((packet) => (
      ["pending", "in_progress"].includes(packet.status)
        ? { ...packet, status: "superseded", reason }
        : packet
    ))
    : [];
  return {
    ...state,
    status: "superseded",
    updated_at: now,
    successor,
    close_reason: reason,
    packets,
    verification: {
      ...(state?.verification || {}),
      status: "superseded",
      closed_at: now,
      reason,
    },
  };
}
