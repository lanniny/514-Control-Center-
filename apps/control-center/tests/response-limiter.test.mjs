import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ResponseLeaseLimiter } from "../src/response-limiter.mjs";

class FakeResponse extends EventEmitter {
  writableFinished = false;
  writableEnded = false;
  destroyed = false;

  finish() {
    this.writableFinished = true;
    this.emit("finish");
  }

  close() {
    this.destroyed = true;
    this.emit("close");
  }
}

class FakeRequest extends EventEmitter {
  aborted = false;
  destroyed = false;
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

test("response leases bound global and same-run fan-out through work and socket lifecycles", async () => {
  const limiter = new ResponseLeaseLimiter({ maxActive: 2, maxActivePerKey: 1 });
  const firstResponse = new FakeResponse();
  const secondResponse = new FakeResponse();
  const firstWork = deferred();
  const secondWork = deferred();

  const first = limiter.run("run-a", firstResponse, () => firstWork.promise);
  await assert.rejects(
    limiter.run("run-a", new FakeResponse(), async () => {}),
    { code: "EVENT_INDEX_BUSY", retryAfterSeconds: 1 },
  );

  const second = limiter.run("run-b", secondResponse, () => secondWork.promise);
  await assert.rejects(
    limiter.run("run-c", new FakeResponse(), async () => {}),
    { code: "EVENT_INDEX_BUSY", retryAfterSeconds: 1 },
  );

  firstWork.resolve("first");
  assert.equal(await first, "first");
  await assert.rejects(
    limiter.run("run-a", new FakeResponse(), async () => {}),
    { code: "EVENT_INDEX_BUSY" },
    "completed history work still owns its lease until the response flushes or closes",
  );

  firstResponse.finish();
  const retryResponse = new FakeResponse();
  const retry = limiter.run("run-a", retryResponse, async () => "retry");
  retryResponse.finish();
  assert.equal(await retry, "retry");

  secondResponse.close();
  await assert.rejects(
    limiter.run("run-b", new FakeResponse(), async () => {}),
    { code: "EVENT_INDEX_BUSY" },
    "a closed client cannot release capacity while history cloning is still active",
  );
  secondWork.resolve("second");
  assert.equal(await second, "second");

  const finalResponse = new FakeResponse();
  const final = limiter.run("run-c", finalResponse, async () => "final");
  finalResponse.finish();
  assert.equal(await final, "final");
});

test("a rejected operation keeps its lease until the error response finishes", async () => {
  const limiter = new ResponseLeaseLimiter({ maxActive: 1, maxActivePerKey: 1 });
  const failedResponse = new FakeResponse();
  await assert.rejects(
    limiter.run("run-error", failedResponse, async () => {
      throw Object.assign(new Error("history read failed"), { code: "READ_FAILED" });
    }),
    { code: "READ_FAILED" },
  );
  await assert.rejects(
    limiter.run("run-retry", new FakeResponse(), async () => {}),
    { code: "EVENT_INDEX_BUSY" },
  );

  failedResponse.finish();
  const retryResponse = new FakeResponse();
  const retry = limiter.run("run-retry", retryResponse, async () => "ok");
  retryResponse.finish();
  assert.equal(await retry, "ok");
});

test("a disconnected response aborts signal-aware work and releases its lease", async () => {
  const limiter = new ResponseLeaseLimiter({ maxActive: 1, maxActivePerKey: 1 });
  const response = new FakeResponse();
  let observedSignal = null;
  const running = limiter.run("run-abort", response, (signal) => {
    observedSignal = signal;
    return new Promise((resolveWork, rejectWork) => {
      signal.addEventListener("abort", () => rejectWork(signal.reason), { once: true });
    });
  });

  response.close();
  await assert.rejects(running, { name: "AbortError", code: "CLIENT_DISCONNECTED" });
  assert.equal(observedSignal?.aborted, true);

  const retryResponse = new FakeResponse();
  const retry = limiter.run("run-abort", retryResponse, async () => "recovered");
  retryResponse.finish();
  assert.equal(await retry, "recovered");
});

test("an already disconnected client never starts work and immediately returns its lease", async () => {
  const limiter = new ResponseLeaseLimiter({ maxActive: 1, maxActivePerKey: 1 });
  let operationCalls = 0;

  const closedResponse = new FakeResponse();
  closedResponse.destroyed = true;
  await assert.rejects(
    limiter.run("run-preclosed", closedResponse, async () => { operationCalls += 1; }),
    { name: "AbortError", code: "CLIENT_DISCONNECTED" },
  );

  const abortedRequest = new FakeRequest();
  abortedRequest.aborted = true;
  await assert.rejects(
    limiter.run("run-preaborted", new FakeResponse(), async () => { operationCalls += 1; }, { request: abortedRequest }),
    { name: "AbortError", code: "CLIENT_DISCONNECTED" },
  );
  assert.equal(operationCalls, 0, "pre-disconnected clients must not start history work");

  const retryResponse = new FakeResponse();
  const retry = limiter.run("run-retry", retryResponse, async () => "reusable");
  retryResponse.finish();
  assert.equal(await retry, "reusable");
});
