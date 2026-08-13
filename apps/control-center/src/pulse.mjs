function abortReason(signal) {
  return signal?.reason ?? Object.assign(new Error("pulse collection aborted"), {
    name: "AbortError",
    code: "ABORTED",
  });
}

function waitForAbortable(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
    if (signal.aborted) onAbort();
  });
}

export async function collectPulseSnapshot({
  observability,
  orchestrator,
  healthService,
  automations,
  signal,
}) {
  const pulse = await waitForAbortable(observability.pulse(), signal);
  if (signal?.aborted) throw abortReason(signal);
  const runs = orchestrator.list();
  const recentWindow = Date.now() - 24 * 3_600_000;
  const recentRuns = runs.filter((run) => Date.parse(run.updatedAt ?? run.createdAt ?? "") >= recentWindow);
  let health = [];
  let healthCollectionError = null;
  try {
    health = await healthService.all({ signal });
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    healthCollectionError = {
      code: error?.code || "HEALTH_COLLECTION_FAILED",
      message: String(error?.message || "health collection failed").slice(0, 500),
    };
  }
  const unhealthyComponents = health
    .filter((item) => !item.available && item.status !== "disabled")
    .map((item) => `${item.id}:${item.status}`);
  if (healthCollectionError) unhealthyComponents.push("health-service:error");
  return {
    ...pulse,
    runtime: {
      activeRuns: runs.filter((run) => ["queued", "running", "waiting_agent", "waiting_approval", "recovery_required"].includes(run.status)).length,
      waitingAnswer: runs.filter((run) => Boolean(run.pendingAsk)).length,
      failedLast24h: recentRuns.filter((run) => run.status === "failed").length,
      recoveryRequired: runs.filter((run) => run.status === "recovery_required").length,
      components: health.map((item) => ({ id: item.id, status: item.status })),
      unhealthyComponents,
      healthCollectionError,
      automations: automations.list().map((item) => ({ name: item.name, schedule: item.schedule, enabled: item.enabled, lastError: item.lastError })),
      automationStore: automations.status(),
    },
  };
}
