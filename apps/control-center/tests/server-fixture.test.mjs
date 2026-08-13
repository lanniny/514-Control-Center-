import test from "node:test";
import assert from "node:assert/strict";
import { stopTestServer, testServerEnv } from "./server-fixture.mjs";

test("test server environment cannot disable the isolated shutdown mode", () => {
  const env = testServerEnv({
    CONTROL_CENTER_OPEN: "1",
    CONTROL_CENTER_TEST_MODE: "0",
  });
  assert.equal(env.CONTROL_CENTER_OPEN, "0");
  assert.equal(env.CONTROL_CENTER_TEST_MODE, "1");
});

test("test fixture refuses to terminate a process it did not spawn", async () => {
  let killCalled = false;
  const foreignProcess = {
    pid: process.pid,
    exitCode: null,
    signalCode: null,
    kill() {
      killCalled = true;
      return true;
    },
  };

  await assert.rejects(
    () => stopTestServer(foreignProcess, { token: "not-used" }),
    { code: "TEST_SERVER_NOT_OWNED" },
  );
  assert.equal(killCalled, false);
});
