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
    Object.assign(new Error("terminal"), { code: "CONTROL_CENTER_CLOSE_FAILED" }),
  ), true);
});
