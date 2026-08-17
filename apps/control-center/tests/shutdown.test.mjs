import test from "node:test";
import assert from "node:assert/strict";
import { createShutdownController, shouldSetShutdownFailureExitCode } from "../src/shutdown.mjs";

test("shutdown incomplete 重开 transport、保留进程并允许下一次重试", async () => {
  const calls = [];
  let stateAttempts = 0;
  const controller = createShutdownController({
    async closeTransport() { calls.push("transport.close"); },
    async reopenTransport() { calls.push("transport.reopen"); },
    async closeState() {
      calls.push("state.close");
      stateAttempts += 1;
      if (stateAttempts === 1) {
        throw Object.assign(new Error("proxy restore incomplete"), { code: "CONTROL_CENTER_CLOSE_INCOMPLETE" });
      }
    },
    onClosed() { calls.push("process.exit"); },
    onError() { assert.fail("direct shutdown must report its rejection to the caller"); },
    log() {},
  });

  await assert.rejects(controller.shutdown("SIGTERM"), { code: "CONTROL_CENTER_CLOSE_INCOMPLETE" });
  assert.deepEqual(calls, ["transport.close", "state.close", "transport.reopen"]);

  await controller.shutdown("SIGTERM");
  assert.deepEqual(calls, [
    "transport.close",
    "state.close",
    "transport.reopen",
    "transport.close",
    "state.close",
    "process.exit",
  ]);
});

test("shutdown cleanup failure 重开 transport，并允许下一次尝试完成", async () => {
  const calls = [];
  let attempts = 0;
  const controller = createShutdownController({
    async closeTransport() { calls.push("transport.close"); },
    async reopenTransport() { calls.push("transport.reopen"); },
    async closeState() {
      calls.push("state.close");
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("cleanup retry required"), { code: "CONTROL_CENTER_CLOSE_FAILED" });
      }
    },
    onClosed() { calls.push("process.exit"); },
    onError() { assert.fail("direct shutdown must report its rejection to the caller"); },
    log() {},
  });

  await assert.rejects(controller.shutdown("SIGTERM"), { code: "CONTROL_CENTER_CLOSE_FAILED" });
  assert.deepEqual(calls, ["transport.close", "state.close", "transport.reopen"]);
  await controller.shutdown("SIGTERM");
  assert.deepEqual(calls, [
    "transport.close", "state.close", "transport.reopen",
    "transport.close", "state.close", "process.exit",
  ]);
});

test("shutdown request 捕获异步失败且并发请求共享同一尝试", async () => {
  let releaseTransport;
  const transportGate = new Promise((resolveGate) => { releaseTransport = resolveGate; });
  let closeCalls = 0;
  let reported = null;
  const reportedPromise = new Promise((resolveReported) => {
    reported = resolveReported;
  });
  const controller = createShutdownController({
    async closeTransport() {
      closeCalls += 1;
      await transportGate;
    },
    async reopenTransport() {},
    async closeState() {
      throw Object.assign(new Error("injected failure"), { code: "INJECTED_SHUTDOWN_FAILURE" });
    },
    onClosed() { assert.fail("failed shutdown must not exit"); },
    onError(error, signal) { reported({ error, signal }); },
    log() {},
  });

  controller.request("first");
  controller.request("second");
  releaseTransport();
  const result = await reportedPromise;
  assert.equal(result.error.code, "INJECTED_SHUTDOWN_FAILURE");
  assert.equal(result.signal, "first");
  assert.equal(closeCalls, 1);
});

test("shutdown incomplete 的 transport 回开失败会保留双重诊断并要求非零退出", async () => {
  const closeError = Object.assign(new Error("proxy restore incomplete"), {
    code: "CONTROL_CENTER_CLOSE_INCOMPLETE",
  });
  const reopenError = Object.assign(new Error("port was captured"), { code: "EADDRINUSE" });
  const controller = createShutdownController({
    async closeTransport() {},
    async reopenTransport() { throw reopenError; },
    async closeState() { throw closeError; },
    onClosed() { assert.fail("failed shutdown must not exit successfully"); },
    onError() { assert.fail("direct shutdown must report its rejection to the caller"); },
    log() {},
  });

  await assert.rejects(
    controller.shutdown("SIGTERM"),
    (error) => error === closeError && error.transportReopenError === reopenError,
  );
  assert.equal(shouldSetShutdownFailureExitCode(closeError), true);
  assert.equal(shouldSetShutdownFailureExitCode(
    Object.assign(new Error("retryable"), { code: "CONTROL_CENTER_CLOSE_INCOMPLETE" }),
  ), false);
  assert.equal(shouldSetShutdownFailureExitCode(
    Object.assign(new Error("retryable cleanup"), { code: "CONTROL_CENTER_CLOSE_FAILED" }),
  ), false);
});

test("shutdown 对 transport/state 都施加共享预算，并在 state 超时后重开 transport", async () => {
  const calls = [];
  const controller = createShutdownController({
    budgetMs: 500,
    async closeTransport() { calls.push("transport.close"); },
    async reopenTransport() { calls.push("transport.reopen"); },
    async closeState({ deadlineMs }) {
      calls.push("state.close");
      assert.ok(Number.isFinite(deadlineMs));
      await new Promise(() => {});
    },
    onClosed() { assert.fail("timed out shutdown must not exit"); },
    onError() { assert.fail("direct shutdown must report its rejection to the caller"); },
    log() {},
  });

  const startedAt = Date.now();
  await assert.rejects(controller.shutdown("SIGTERM"), { code: "CONTROL_CENTER_SHUTDOWN_TIMEOUT" });
  assert.ok(Date.now() - startedAt < 2_000, "shutdown timeout must bound the hanging state close");
  assert.deepEqual(calls, ["transport.close", "state.close", "transport.reopen"]);
});

test("shutdown 等待遵守绝对 deadline 的 state.close 收敛后再重开 transport", async () => {
  const calls = [];
  const controller = createShutdownController({
    budgetMs: 500,
    async closeTransport() {
      calls.push("transport.close");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    },
    async closeState({ deadlineMs }) {
      calls.push("state.close");
      const remainingMs = Math.max(1, deadlineMs - Date.now() - 20);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, remainingMs));
      calls.push("state.settled");
      throw Object.assign(new Error("bounded close failure"), { code: "CONTROL_CENTER_CLOSE_TIMEOUT" });
    },
    async reopenTransport() {
      assert.equal(calls.at(-1), "state.settled");
      calls.push("transport.reopen");
    },
    onClosed() { assert.fail("failed shutdown must not exit"); },
    onError() { assert.fail("direct shutdown must report its rejection to the caller"); },
    log() {},
  });

  await assert.rejects(controller.shutdown("SIGTERM"), { code: "CONTROL_CENTER_CLOSE_TIMEOUT" });
  assert.deepEqual(calls, ["transport.close", "state.close", "state.settled", "transport.reopen"]);
});
