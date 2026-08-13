import test from "node:test";
import assert from "node:assert/strict";
import { renameSyncWithRetry, renameWithRetry } from "../src/atomic-rename.mjs";

test("renameWithRetry retries bounded transient replacement failures", async () => {
  const attempts = [];
  const delays = [];
  await renameWithRetry("source", "target", {
    async renameFile(source, target) {
      attempts.push([source, target]);
      if (attempts.length < 3) throw Object.assign(new Error("temporarily locked"), { code: "EPERM" });
    },
    async sleep(delayMs) {
      delays.push(delayMs);
    },
    retryDelaysMs: [1, 2, 3],
  });

  assert.equal(attempts.length, 3);
  assert.deepEqual(delays, [1, 2]);
});

test("renameSyncWithRetry retries bounded transient replacement failures", () => {
  const attempts = [];
  const delays = [];
  renameSyncWithRetry("source", "target", {
    renameFile(source, target) {
      attempts.push([source, target]);
      if (attempts.length < 3) throw Object.assign(new Error("temporarily locked"), { code: "EPERM" });
    },
    sleep(delayMs) {
      delays.push(delayMs);
    },
    retryDelaysMs: [1, 2, 3],
  });

  assert.equal(attempts.length, 3);
  assert.deepEqual(delays, [1, 2]);
});

test("renameSyncWithRetry reruns the pre-attempt guard before every transient retry", () => {
  const guardedAttempts = [];
  let attempts = 0;
  renameSyncWithRetry("source", "target", {
    beforeAttempt({ attempt }) {
      guardedAttempts.push(attempt);
    },
    renameFile() {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("temporarily locked"), { code: "EBUSY" });
    },
    sleep() {},
    retryDelaysMs: [1],
  });
  assert.deepEqual(guardedAttempts, [0, 1]);
});

test("renameSyncWithRetry does not retry permanent failures", () => {
  let attempts = 0;
  assert.throws(() => renameSyncWithRetry("source", "target", {
    renameFile() {
      attempts += 1;
      throw Object.assign(new Error("missing source"), { code: "ENOENT" });
    },
    sleep() {
      assert.fail("permanent failures must not sleep");
    },
  }), { code: "ENOENT" });
  assert.equal(attempts, 1);
});

test("renameSyncWithRetry stops after the configured retry budget", () => {
  let attempts = 0;
  const delays = [];
  assert.throws(() => renameSyncWithRetry("source", "target", {
    renameFile() {
      attempts += 1;
      throw Object.assign(new Error("still locked"), { code: "EBUSY" });
    },
    sleep(delayMs) {
      delays.push(delayMs);
    },
    retryDelaysMs: [4, 8],
  }), { code: "EBUSY" });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [4, 8]);
});

test("renameSyncWithRetry never sleeps past an absolute deadline", () => {
  let attempts = 0;
  let clock = 0;
  const delays = [];
  let caught = null;
  assert.throws(() => renameSyncWithRetry("source", "target", {
    renameFile() {
      attempts += 1;
      throw Object.assign(new Error("locked until deadline"), { code: "EPERM" });
    },
    sleep(delayMs) {
      delays.push(delayMs);
      clock += delayMs;
    },
    retryDelaysMs: [10, 25, 50, 100],
    deadline: 30,
    now: () => clock,
  }), (error) => {
    caught = error;
    return error?.code === "EPERM";
  });

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 19]);
  assert.equal(clock, 29);
  assert.equal(caught.retryDeadlineExceeded, true);
});

test("renameSyncWithRetry refuses the first rename after deadline", () => {
  let attempts = 0;
  assert.throws(() => renameSyncWithRetry("source", "target", {
    renameFile() {
      attempts += 1;
    },
    deadline: 10,
    now: () => 10,
  }), { code: "RENAME_DEADLINE_EXCEEDED" });
  assert.equal(attempts, 0);
});

test("renameSyncWithRetry reports a committed rename that returns after deadline", () => {
  let clock = 0;
  let attempts = 0;
  assert.throws(() => renameSyncWithRetry("source", "target", {
    renameFile() {
      attempts += 1;
      clock = 11;
    },
    deadline: 10,
    now: () => clock,
  }), (error) => error?.code === "RENAME_DEADLINE_EXCEEDED" && error.renameCommitted === true);
  assert.equal(attempts, 1);
});

test("renameWithRetry reports a committed rename that returns after deadline", async () => {
  let clock = 0;
  let attempts = 0;
  await assert.rejects(renameWithRetry("source", "target", {
    async renameFile() {
      attempts += 1;
      clock = 11;
    },
    deadline: 10,
    now: () => clock,
  }), (error) => error?.code === "RENAME_DEADLINE_EXCEEDED" && error.renameCommitted === true);
  assert.equal(attempts, 1);
});
