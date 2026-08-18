import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  collectProjectBridge,
  createAnchorStore,
  normalizeProjectCwd,
} from "../src/project-bridge.mjs";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

async function createRepo(name) {
  const root = await mkdtemp(join(tmpdir(), `514cc-bridge-${name}-`));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "qa@example.test"]);
  git(root, ["config", "user.name", "QA"]);
  await writeFile(join(root, "README.md"), `${name}\n`, "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  return root;
}

test("client-submitted relative paths are rejected", () => {
  assert.throws(() => normalizeProjectCwd("../escape"), { code: "PROJECT_PATH_REJECTED" });
  assert.throws(() => normalizeProjectCwd("relative"), { code: "PROJECT_PATH_REJECTED" });
});

test("same canonical path reuses the same anchorId", async () => {
  const root = await createRepo("same");
  try {
    const store = createAnchorStore();
    const first = await collectProjectBridge({ cwd: root, store, runtime: { pid: process.pid, generation: 1 } });
    const second = await collectProjectBridge({ cwd: root, store, runtime: { pid: process.pid, generation: 1 } });
    assert.equal(first.anchorId, second.anchorId);
    assert.equal(first.projectId, second.projectId);
    assert.equal(first.faces.source.relocated, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("path move keeps anchorId and marks source stale", async () => {
  const firstRoot = await createRepo("move-a");
  const movedRoot = join(dirname(firstRoot), `${basename(firstRoot)}-moved`);
  try {
    const store = createAnchorStore();
    const first = await collectProjectBridge({
      cwd: firstRoot,
      store,
      runtime: { pid: process.pid, generation: 1 },
      processes: [],
    });
    await rename(firstRoot, movedRoot);
    const second = await collectProjectBridge({
      cwd: movedRoot,
      store,
      runtime: { pid: process.pid, generation: 1 },
      processes: [],
    });
    assert.equal(second.anchorId, first.anchorId);
    assert.equal(second.faces.source.relocated, true);
    assert.equal(second.faces.source.status, "stale");
    assert.notEqual(second.projectId, first.projectId);
    assert.equal(store.lookupByCwd(firstRoot), null);
  } finally {
    await rm(movedRoot, { recursive: true, force: true }).catch(() => rm(firstRoot, { recursive: true, force: true }));
  }
});

test("a folder without git becomes a new identity after move", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "514cc-bridge-nongit-"));
  const movedRoot = `${firstRoot}-moved`;
  try {
    await writeFile(join(firstRoot, "notes.txt"), "local only\n", "utf8");
    const store = createAnchorStore();
    const first = await collectProjectBridge({
      cwd: firstRoot,
      store,
      runtime: { pid: process.pid, generation: 1 },
      processes: [],
    });
    await rename(firstRoot, movedRoot);
    const second = await collectProjectBridge({
      cwd: movedRoot,
      store,
      runtime: { pid: process.pid, generation: 1 },
      processes: [],
    });
    assert.equal(first.faces.source.status, "unknown");
    assert.notEqual(second.anchorId, first.anchorId);
    assert.equal(second.faces.source.relocated, false);
  } finally {
    await rm(movedRoot, { recursive: true, force: true }).catch(() => rm(firstRoot, { recursive: true, force: true }));
  }
});

test("branch switch with old-branch evidence is stale", async () => {
  const root = await createRepo("branch");
  try {
    git(root, ["checkout", "-b", "feature"]);
    const bridge = await collectProjectBridge({
      cwd: root,
      runtime: { pid: process.pid, generation: 2 },
      processes: [],
      evidence: { status: "passed", sourceCommit: git(root, ["rev-parse", "HEAD"]), branch: "main" },
    });
    assert.equal(bridge.faces.source.branch, "feature");
    assert.equal(bridge.faces.source.status, "stale");
    assert.equal(bridge.consistency, "stale");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("process restart with old runtime evidence is stale", async () => {
  const root = await createRepo("restart");
  try {
    const bridge = await collectProjectBridge({
      cwd: root,
      runtime: { pid: process.pid, generation: 9 },
      processes: [{ pid: process.pid }],
      evidence: {
        status: "passed",
        sourceCommit: git(root, ["rev-parse", "HEAD"]),
        runtimePid: process.pid + 99999,
        runtimeGeneration: 1,
      },
    });
    assert.equal(bridge.faces.runtime.status, "stale");
    assert.equal(bridge.consistency, "stale");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("old evidence commit mixed into a new HEAD is stale", async () => {
  const root = await createRepo("evidence");
  try {
    await writeFile(join(root, "next.txt"), "next\n", "utf8");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "next"]);
    const bridge = await collectProjectBridge({
      cwd: root,
      runtime: { pid: process.pid, generation: 1 },
      processes: [],
      evidence: { status: "passed", sourceCommit: "deadbeef".repeat(5) },
    });
    assert.equal(bridge.faces.evidence.status, "stale");
    assert.equal(bridge.consistency, "stale");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing source stays unknown and never claims the bridge is connected", async () => {
  const missing = join(await mkdtemp(join(tmpdir(), "514cc-bridge-missing-")), "gone");
  const parent = resolve(missing, "..");
  try {
    const bridge = await collectProjectBridge({
      cwd: missing,
      runtime: { pid: process.pid, generation: 1 },
      processes: [],
    });
    assert.equal(bridge.faces.source.status, "missing");
    assert.equal(bridge.consistency, "unknown");
    assert.match(bridge.diagnosis, /不能称为项目已接通/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("matching current-round evidence can be consistent", async () => {
  const root = await createRepo("ok");
  try {
    const head = git(root, ["rev-parse", "HEAD"]);
    const bridge = await collectProjectBridge({
      cwd: root,
      runtime: { pid: process.pid, generation: 3 },
      processes: [{ pid: process.pid }],
      evidence: { status: "passed", sourceCommit: head, branch: "main" },
    });
    assert.equal(bridge.faces.source.status, "ok");
    assert.equal(bridge.faces.runtime.status, "ok");
    assert.equal(bridge.faces.process.status, "ok");
    assert.equal(bridge.faces.evidence.status, "ok");
    assert.equal(bridge.consistency, "consistent");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
