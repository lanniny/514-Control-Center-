/**
 * SSE stream epoch helpers (RT-03).
 * Pure functions — host owns toast/diagnostic side effects.
 */

export function nextStreamEpochState(currentEpoch, nextEpoch) {
  if (!nextEpoch) {
    return { changed: false, epoch: currentEpoch || null, resetSequence: false };
  }
  if (currentEpoch && currentEpoch !== nextEpoch) {
    return { changed: true, epoch: nextEpoch, resetSequence: true };
  }
  if (!currentEpoch) {
    return { changed: false, epoch: nextEpoch, resetSequence: false };
  }
  return { changed: false, epoch: currentEpoch, resetSequence: false };
}

export function readStreamEpochFromHeaders(headers) {
  if (!headers || typeof headers.get !== "function") return null;
  return headers.get("x-514cc-stream-epoch") || headers.get("X-514cc-Stream-Epoch") || null;
}

export function readStreamEpochFromReadyPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return payload.streamEpoch || payload.epoch || null;
}
