import { performance } from "node:perf_hooks";
import { runProcess } from "./process-runner.mjs";

function abortReason(signal) {
  return signal?.reason ?? Object.assign(new Error("health probe aborted"), {
    name: "AbortError",
    code: "ABORTED",
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

export class HealthService {
  constructor(profiles, {
    ttlMs = 30_000,
    externalProbes = new Map(),
    maxRetiringBatches = 2,
    retiringWaitMs = 5_000,
  } = {}) {
    if (!Number.isSafeInteger(maxRetiringBatches) || maxRetiringBatches < 1) {
      throw new TypeError("maxRetiringBatches must be a positive safe integer");
    }
    if (!Number.isSafeInteger(retiringWaitMs) || retiringWaitMs < 0) {
      throw new TypeError("retiringWaitMs must be a non-negative safe integer");
    }
    this.profiles = profiles;
    this.ttlMs = ttlMs;
    this.externalProbes = externalProbes;
    this.maxRetiringBatches = maxRetiringBatches;
    this.retiringWaitMs = retiringWaitMs;
    this.cache = null;
    this.inflight = null;
    this.retiring = new Set();
  }

  busyError() {
    return Object.assign(new Error("too many cancelled health batches are still retiring"), {
      code: "HEALTH_PROBE_BUSY",
    });
  }

  async waitForRetiringCapacity(signal) {
    if (!signal || this.retiringWaitMs === 0 || this.retiring.size < this.maxRetiringBatches) {
      if (this.retiring.size >= this.maxRetiringBatches) throw this.busyError();
      return;
    }
    throwIfAborted(signal);
    const firstRetirement = Promise.race(
      [...this.retiring].map((entry) => entry.promise.then(() => undefined, () => undefined)),
    );
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        callback(value);
      };
      const onAbort = () => finish(reject, abortReason(signal));
      const timer = setTimeout(() => finish(reject, this.busyError()), this.retiringWaitMs);
      signal.addEventListener("abort", onAbort, { once: true });
      firstRetirement.then(
        () => finish(resolve),
        () => finish(resolve),
      );
      if (signal.aborted) onAbort();
    });
  }

  async probeProfile(profile, { signal } = {}) {
    throwIfAborted(signal);
    if (!profile.enabled) return { id: profile.id, status: "disabled", available: false, reason: "profile disabled" };
    if (profile.healthMode === "external" || !profile.command) {
      const probe = this.externalProbes.get(profile.id);
      if (probe) {
        const result = await probe(profile, { signal });
        throwIfAborted(signal);
        return result;
      }
      return {
        id: profile.id,
        status: "external-unverified",
        available: false,
        reason: "provider health must be supplied by its MCP/host adapter",
      };
    }
    const started = performance.now();
    try {
      const result = await runProcess(profile.command, ["--version"], {
        timeoutMs: profile.healthTimeoutMs || 15_000,
        env: profile.adapter === "pi-rpc" ? { PI_OFFLINE: "1" } : {},
        signal,
      });
      throwIfAborted(signal);
      const output = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0] || "version unavailable";
      return {
        id: profile.id,
        status: result.code === 0 ? "online" : "degraded",
        available: result.code === 0,
        version: output.slice(0, 240),
        latencyMs: Math.round(performance.now() - started),
        reason: result.code === 0 ? "local executable probe passed" : `version probe exited ${result.code}`,
      };
    } catch (error) {
      if (signal?.aborted || error?.code === "ABORTED" || error?.name === "AbortError") {
        throw abortReason(signal);
      }
      return {
        id: profile.id,
        status: error.code === "ENOENT" ? "missing" : error.code === "PROCESS_TIMEOUT" ? "degraded" : "offline",
        available: false,
        latencyMs: Math.round(performance.now() - started),
        reason: error.message,
      };
    }
  }

  waitForInflight(entry, signal) {
    throwIfAborted(signal);
    entry.waiters += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value, { aborted = false } = {}) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        entry.waiters = Math.max(0, entry.waiters - 1);
        if (aborted && entry.waiters === 0 && !entry.settled) {
          if (this.inflight === entry) this.inflight = null;
          this.retiring.add(entry);
          void entry.promise.finally(() => this.retiring.delete(entry)).catch(() => {});
          entry.controller.abort(value);
        }
        callback(value);
      };
      const onAbort = () => finish(reject, abortReason(signal), { aborted: true });
      signal?.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (items) => finish(resolve, items),
        (error) => finish(reject, error),
      );
      if (signal?.aborted) onAbort();
    });
  }

  peek() {
    return Array.isArray(this.cache?.items) ? this.cache.items : [];
  }

  peekMeta() {
    if (!this.cache) {
      return {
        available: false,
        capturedAt: null,
        ageMs: null,
        ttlMs: this.ttlMs,
        stale: true,
        items: [],
        profileCount: this.profiles.length,
      };
    }
    const ageMs = Math.max(0, Date.now() - this.cache.at);
    return {
      available: true,
      capturedAt: new Date(this.cache.at).toISOString(),
      ageMs,
      ttlMs: this.ttlMs,
      stale: ageMs >= this.ttlMs,
      items: this.cache.items,
      profileCount: this.profiles.length,
    };
  }

  async all({ refresh = false, signal } = {}) {
    throwIfAborted(signal);
    if (!refresh && this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.items;
    // 并发去重：TTL 失效瞬间的多路请求（bootstrap+health+SSE 重连）合流到同一次探测，
    // 不叠加探针进程
    let entry = this.inflight;
    if (!entry) {
      if (this.retiring.size >= this.maxRetiringBatches) {
        await this.waitForRetiringCapacity(signal);
        entry = this.inflight;
        if (!entry && this.retiring.size >= this.maxRetiringBatches) throw this.busyError();
      }
    }
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, promise: null, waiters: 0, settled: false };
      entry.promise = (async () => {
      try {
        // 限并发 2（2026-07-20 LO 爆内存报障）：全 profile Promise.all 并发即"探针风暴"——
        // 六七个 CLI 各 100-300MB 冷启动峰值同时拉起，重启后首次打开页面瞬时 1-2GB
        const items = new Array(this.profiles.length);
        let cursor = 0;
        const workers = Array.from({ length: Math.min(2, this.profiles.length) }, async () => {
          try {
            while (cursor < this.profiles.length) {
              throwIfAborted(controller.signal);
              const index = cursor++;
              items[index] = await this.probeProfile(this.profiles[index], { signal: controller.signal });
            }
          } catch (error) {
            if (!controller.signal.aborted) controller.abort(error);
            throw error;
          }
        });
        const outcomes = await Promise.allSettled(workers);
        throwIfAborted(controller.signal);
        const failure = outcomes.find((outcome) => outcome.status === "rejected");
        if (failure) throw failure.reason;
        if (this.inflight !== entry) {
          throw Object.assign(new Error("stale health probe cannot update the cache"), {
            code: "STALE_HEALTH_PROBE",
          });
        }
        this.cache = { at: Date.now(), items };
        return items;
      } finally {
        entry.settled = true;
        if (this.inflight === entry) this.inflight = null;
      }
      })();
      // Every caller may disconnect before the shared probe settles. Keep the
      // underlying rejection observed while the ref-counted waiters unwind.
      entry.promise.catch(() => {});
      this.inflight = entry;
    }
    return this.waitForInflight(entry, signal);
  }

  async map(options) {
    return new Map((await this.all(options)).map((item) => [item.id, item]));
  }
}
