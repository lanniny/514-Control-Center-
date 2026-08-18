import test from "node:test";
import assert from "node:assert/strict";
import { HealthService } from "../src/health.mjs";
import { collectPulseSnapshot } from "../src/pulse.mjs";

const profile = {
  id: "external-test",
  enabled: true,
  healthMode: "external",
  command: null,
};

test("health probe keeps a shared inflight alive while another subscriber remains", async () => {
  let releaseProbe;
  let probeSignal;
  const service = new HealthService([profile], {
    externalProbes: new Map([[profile.id, (_profile, { signal }) => new Promise((resolve, reject) => {
      probeSignal = signal;
      releaseProbe = () => resolve({ id: profile.id, status: "online", available: true });
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })]]),
  });
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = service.all({ signal: firstController.signal });
  const second = service.all({ signal: secondController.signal });
  const reason = Object.assign(new Error("first client disconnected"), { code: "CLIENT_DISCONNECTED" });

  firstController.abort(reason);
  await assert.rejects(first, (error) => error === reason);
  assert.equal(probeSignal.aborted, false, "one disconnected subscriber must not kill a probe still in use");
  releaseProbe();
  assert.deepEqual(await second, [{ id: profile.id, status: "online", available: true }]);
});

test("health probe aborts its underlying work after the final subscriber disconnects", async () => {
  let calls = 0;
  let probeSignal;
  const service = new HealthService([profile], {
    externalProbes: new Map([[profile.id, (_profile, { signal }) => {
      calls += 1;
      probeSignal = signal;
      if (calls > 1) return { id: profile.id, status: "online", available: true };
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }]]),
  });
  const controller = new AbortController();
  const pending = service.all({ signal: controller.signal });
  const reason = Object.assign(new Error("last client disconnected"), { code: "CLIENT_DISCONNECTED" });

  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(probeSignal.aborted, true);
  assert.deepEqual(await service.all(), [{ id: profile.id, status: "online", available: true }]);
  assert.equal(calls, 2, "a new caller must not inherit an aborted inflight probe");
});

test("pre-aborted health reads do not start probes", async () => {
  let calls = 0;
  const service = new HealthService([profile], {
    externalProbes: new Map([[profile.id, () => {
      calls += 1;
      return { id: profile.id, status: "online", available: true };
    }]]),
  });
  const controller = new AbortController();
  const reason = Object.assign(new Error("already disconnected"), { code: "CLIENT_DISCONNECTED" });
  controller.abort(reason);

  await assert.rejects(service.all({ signal: controller.signal }), (error) => error === reason);
  assert.equal(calls, 0);
});

test("a late non-cooperative probe cannot overwrite a newer health cache", async () => {
  let calls = 0;
  let releaseOldProbe;
  const service = new HealthService([profile], {
    externalProbes: new Map([[profile.id, () => {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve) => {
          releaseOldProbe = () => resolve({ id: profile.id, status: "offline", available: false });
        });
      }
      return { id: profile.id, status: "online", available: true };
    }]]),
  });
  const controller = new AbortController();
  const oldRead = service.all({ signal: controller.signal });
  const reason = Object.assign(new Error("old reader disconnected"), { code: "CLIENT_DISCONNECTED" });
  controller.abort(reason);
  await assert.rejects(oldRead, (error) => error === reason);

  const fresh = await service.all();
  assert.equal(fresh[0].status, "online");
  releaseOldProbe();
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 0));
  const cached = await service.all();
  assert.equal(cached[0].status, "online");
  assert.equal(calls, 2);
});

test("repeated disconnects cannot create unbounded non-cooperative health batches", async () => {
  const releases = [];
  let calls = 0;
  const service = new HealthService([profile], {
    maxRetiringBatches: 2,
    externalProbes: new Map([[profile.id, () => {
      calls += 1;
      if (calls > 2) return { id: profile.id, status: "online", available: true };
      return new Promise((resolve) => releases.push(() => resolve({ id: profile.id, status: "online", available: true })));
    }]]),
  });

  for (let index = 0; index < 2; index += 1) {
    const controller = new AbortController();
    const pending = service.all({ signal: controller.signal });
    const reason = Object.assign(new Error(`disconnect ${index}`), { code: "CLIENT_DISCONNECTED" });
    controller.abort(reason);
    await assert.rejects(pending, (error) => error === reason);
  }
  await assert.rejects(service.all(), { code: "HEALTH_PROBE_BUSY" });
  assert.equal(calls, 2, "the third disconnected request must not launch another probe batch");

  for (const release of releases) release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await service.all(), [{ id: profile.id, status: "online", available: true }]);
  assert.equal(calls, 3);
});

test("a signaled health read waits for one retiring slot without starting an overlapping batch", async () => {
  const releases = [];
  let calls = 0;
  const service = new HealthService([profile], {
    maxRetiringBatches: 2,
    retiringWaitMs: 1_000,
    externalProbes: new Map([[profile.id, () => {
      calls += 1;
      if (calls > 2) return { id: profile.id, status: "online", available: true };
      return new Promise((resolve) => releases.push(() => resolve({ id: profile.id, status: "online", available: true })));
    }]]),
  });

  for (let index = 0; index < 2; index += 1) {
    const controller = new AbortController();
    const pending = service.all({ signal: controller.signal });
    const reason = Object.assign(new Error(`disconnect ${index}`), { code: "CLIENT_DISCONNECTED" });
    controller.abort(reason);
    await assert.rejects(pending, (error) => error === reason);
  }

  const waitingController = new AbortController();
  const waiting = service.all({ signal: waitingController.signal });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2, "a waiting reader must not exceed the retiring batch budget");
  releases.shift()();
  assert.deepEqual(await waiting, [{ id: profile.id, status: "online", available: true }]);
  assert.equal(calls, 3);
  for (const release of releases) release();
});

test("a signaled health read fails closed when retirement capacity does not return in time", async () => {
  const service = new HealthService([profile], {
    maxRetiringBatches: 1,
    retiringWaitMs: 5,
    externalProbes: new Map([[profile.id, () => new Promise(() => {})]]),
  });
  const retiredController = new AbortController();
  const retired = service.all({ signal: retiredController.signal });
  retiredController.abort(Object.assign(new Error("disconnect"), { code: "CLIENT_DISCONNECTED" }));
  await assert.rejects(retired, { code: "CLIENT_DISCONNECTED" });

  await assert.rejects(
    service.all({ signal: new AbortController().signal }),
    { code: "HEALTH_PROBE_BUSY" },
  );
});

test("a failed worker cancels its siblings and stays inflight until non-cooperative work settles", async () => {
  const failure = new Error("profile failed");
  let releaseSlowProbe;
  let slowSignal;
  let slowCalls = 0;
  let tailCalls = 0;
  let failOnce = true;
  const profiles = ["fail", "slow", "tail"].map((id) => ({
    id,
    enabled: true,
    healthMode: "external",
    command: null,
  }));
  let slowStarted;
  const slowReady = new Promise((resolveReady) => { slowStarted = resolveReady; });
  const service = new HealthService(profiles, {
    externalProbes: new Map([
      ["fail", async () => {
        await slowReady;
        if (failOnce) {
          failOnce = false;
          throw failure;
        }
        return { id: "fail", status: "online", available: true };
      }],
      ["slow", (_profile, { signal }) => {
        slowCalls += 1;
        slowSignal = signal;
        slowStarted();
        if (slowCalls > 1) return { id: "slow", status: "online", available: true };
        return new Promise((resolveProbe) => {
          releaseSlowProbe = () => resolveProbe({ id: "slow", status: "online", available: true });
        });
      }],
      ["tail", () => {
        tailCalls += 1;
        return { id: "tail", status: "online", available: true };
      }],
    ]),
  });

  const first = service.all();
  await new Promise((resolveAbort) => slowSignal.addEventListener("abort", resolveAbort, { once: true }));
  assert.equal(slowSignal.reason, failure);
  const joined = service.all();
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 0));
  assert.equal(tailCalls, 0, "an aborted batch must not continue consuming profiles or allow an overlapping batch");

  releaseSlowProbe();
  await assert.rejects(first, (error) => error === failure);
  await assert.rejects(joined, (error) => error === failure);
  const fresh = await service.all();
  assert.deepEqual(fresh.map((item) => item.status), ["online", "online", "online"]);
  assert.equal(tailCalls, 1);
});

test("health reports the first worker failure even when a lower-index worker rejects later", async () => {
  const firstFailure = new Error("first failure");
  const lateFailure = new Error("late failure");
  let releaseLate;
  let markLateStarted;
  let markAbortObserved;
  const lateStarted = new Promise((resolve) => { markLateStarted = resolve; });
  const abortObserved = new Promise((resolve) => { markAbortObserved = resolve; });
  const profiles = ["late", "first"].map((id) => ({
    id,
    enabled: true,
    healthMode: "external",
    command: null,
  }));
  const service = new HealthService(profiles, {
    externalProbes: new Map([
      ["late", (_profile, { signal }) => new Promise((_resolve, reject) => {
        releaseLate = () => reject(lateFailure);
        signal.addEventListener("abort", markAbortObserved, { once: true });
        markLateStarted();
      })],
      ["first", async () => {
        await lateStarted;
        throw firstFailure;
      }],
    ]),
  });

  const pending = service.all();
  await abortObserved;
  releaseLate();
  await assert.rejects(pending, (error) => error === firstFailure);
});

test("pulse marks health collection failures as unhealthy instead of reporting an empty healthy set", async () => {
  const failure = Object.assign(new Error("health batch failed"), { code: "HEALTH_BATCH_FAILED" });
  const pulse = await collectPulseSnapshot({
    observability: { pulse: async () => ({ generatedAt: "2026-07-23T00:00:00.000Z" }) },
    orchestrator: { list: () => [] },
    healthService: { all: async () => { throw failure; } },
    automations: { list: () => [], status: () => ({ writable: true }) },
  });

  assert.deepEqual(pulse.runtime.components, []);
  assert.deepEqual(pulse.runtime.unhealthyComponents, ["health-service:error"]);
  assert.deepEqual(pulse.runtime.healthCollectionError, {
    code: "HEALTH_BATCH_FAILED",
    message: "health batch failed",
  });
});

test("pulse treats an internal ABORTED health failure as unhealthy when the caller is still active", async () => {
  const failure = Object.assign(new Error("provider health operation aborted"), { code: "ABORTED" });
  const pulse = await collectPulseSnapshot({
    observability: { pulse: async () => ({ generatedAt: "2026-07-23T00:00:00.000Z" }) },
    orchestrator: { list: () => [] },
    healthService: { all: async () => { throw failure; } },
    automations: { list: () => [], status: () => ({ writable: true }) },
    signal: new AbortController().signal,
  });

  assert.deepEqual(pulse.runtime.unhealthyComponents, ["health-service:error"]);
  assert.deepEqual(pulse.runtime.healthCollectionError, {
    code: "ABORTED",
    message: "provider health operation aborted",
  });
});

test("pulse cancellation releases a caller waiting on observability without waiting for the source", async () => {
  let release;
  const source = new Promise((resolve) => { release = resolve; });
  const controller = new AbortController();
  const reason = Object.assign(new Error("pulse client disconnected"), { code: "CLIENT_DISCONNECTED" });
  const pending = collectPulseSnapshot({
    observability: { pulse: () => source },
    orchestrator: { list: () => [] },
    healthService: { all: async () => [] },
    automations: { list: () => [], status: () => ({ writable: true }) },
    signal: controller.signal,
  });

  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  release({ generatedAt: "2026-07-23T00:00:00.000Z" });
});

test("peekMeta reports a missing cache as stale without probing", () => {
  const service = new HealthService([profile], {
    ttlMs: 30_000,
    externalProbes: new Map([[profile.id, () => {
      throw new Error("peekMeta must not probe");
    }]]),
  });
  const meta = service.peekMeta();
  assert.equal(meta.available, false);
  assert.equal(meta.stale, true);
  assert.equal(meta.profileCount, 1);
  assert.equal(meta.ageMs, null);
});
