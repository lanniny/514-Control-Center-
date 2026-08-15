const ABNORMAL_PROVIDER_TURN_STOPS = new Set([
  "cancelled", "canceled", "aborted", "interrupted", "error", "failed", "timeout", "refusal",
  "max_tokens", "max_turn_requests", "max_turns", "max_turns_reached", "error_max_turns", "error_during_execution",
  "permission_denied", "content_filter",
]);

export function isAbnormalProviderTurnStop(stopReason) {
  return ABNORMAL_PROVIDER_TURN_STOPS.has(String(stopReason ?? "").toLowerCase());
}
