import { performance } from "node:perf_hooks";
import { runProcess } from "./process-runner.mjs";

export class HealthService {
  constructor(profiles, { ttlMs = 30_000, externalProbes = new Map() } = {}) {
    this.profiles = profiles;
    this.ttlMs = ttlMs;
    this.externalProbes = externalProbes;
    this.cache = null;
  }

  async probeProfile(profile) {
    if (!profile.enabled) return { id: profile.id, status: "disabled", available: false, reason: "profile disabled" };
    if (profile.healthMode === "external" || !profile.command) {
      const probe = this.externalProbes.get(profile.id);
      if (probe) return probe(profile);
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
      });
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
      return {
        id: profile.id,
        status: error.code === "ENOENT" ? "missing" : error.code === "PROCESS_TIMEOUT" ? "degraded" : "offline",
        available: false,
        latencyMs: Math.round(performance.now() - started),
        reason: error.message,
      };
    }
  }

  async all({ refresh = false } = {}) {
    if (!refresh && this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.items;
    const items = await Promise.all(this.profiles.map((profile) => this.probeProfile(profile)));
    this.cache = { at: Date.now(), items };
    return items;
  }

  async map(options) {
    return new Map((await this.all(options)).map((item) => [item.id, item]));
  }
}
