import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigManager } from "../src/config-manager.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

async function fixture() {
  const root = await mkdtemp(resolve(appRoot, ".test-config-"));
  const repoRoot = resolve(root, "repo");
  const dataRoot = resolve(repoRoot, ".ai-shared/control-center");
  await mkdir(resolve(repoRoot, "config"), { recursive: true });
  await writeFile(resolve(repoRoot, "config/settings.json"), '{"enabled":true}\n');
  const registryPath = resolve(root, "sources.json");
  await writeFile(registryPath, JSON.stringify({
    version: 1,
    explicit: [{ id: "test.settings", path: "config/settings.json", label: "Settings", kind: "json", scope: "repo", critical: true }],
    discover: [],
    runtime: [],
  }));
  const events = [];
  const eventStore = { emit: async (type, data) => { events.push({ type, data }); } };
  const manager = await new ConfigManager({ repoRoot, dataRoot, registryPath, eventStore }).init();
  return { root, repoRoot, manager, events };
}

test("config transaction validates, locks, backs up and rolls back", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const initial = await fx.manager.read("test.settings");
  const candidate = '{"enabled":false,"mode":"strict"}\n';
  const plan = await fx.manager.plan("test.settings", candidate, initial.sha256);
  assert.equal(plan.validation.valid, true);
  assert.equal(plan.summary.changed, true);
  await assert.rejects(() => fx.manager.apply("test.settings", { content: candidate, baseSha256: initial.sha256, planId: plan.planId }), { code: "CONFIRMATION_REQUIRED" });
  const applied = await fx.manager.apply("test.settings", { content: candidate, baseSha256: initial.sha256, planId: plan.planId, confirmation: "test.settings" });
  assert.equal(applied.changed, true);
  assert.equal(JSON.parse(await readFile(resolve(fx.repoRoot, "config/settings.json"), "utf8")).enabled, false);
  await assert.rejects(() => fx.manager.apply("test.settings", { content: candidate, baseSha256: initial.sha256, planId: plan.planId, confirmation: "test.settings" }), { code: "STALE_BASE" });
  const versions = await fx.manager.versions("test.settings");
  assert.equal(versions.length, 1);
  const rolledBack = await fx.manager.rollback("test.settings", { versionId: versions[0].versionId, baseSha256: applied.sha256, confirmation: "test.settings" });
  assert.equal(rolledBack.changed, true);
  assert.equal(JSON.parse(await readFile(resolve(fx.repoRoot, "config/settings.json"), "utf8")).enabled, true);
  assert.ok(fx.events.some((event) => event.type === "config.rolled_back"));
});

test("apply is bound to the exact previewed target hash", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const initial = await fx.manager.read("test.settings");
  const plan = await fx.manager.plan("test.settings", '{"enabled":false}\n', initial.sha256);
  await assert.rejects(
    () => fx.manager.apply("test.settings", { content: '{"enabled":false,"extra":true}\n', baseSha256: initial.sha256, planId: plan.planId, confirmation: "test.settings" }),
    { code: "PLAN_MISMATCH" },
  );
});

test("config transaction blocks repository secret literals", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const validation = await fx.manager.validate("test.settings", '{"api_key":"abcdefghijklmnop123456"}');
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /secret-like literal/);
});

test("registry paths cannot escape repository root", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = resolve(root, "repo");
  await mkdir(repoRoot, { recursive: true });
  const registryPath = resolve(root, "sources.json");
  await writeFile(registryPath, JSON.stringify({ version: 1, explicit: [{ id: "escape", path: "../outside.json", label: "Escape", kind: "json", scope: "repo" }], discover: [], runtime: [] }));
  await assert.rejects(() => new ConfigManager({ repoRoot, dataRoot: resolve(repoRoot, ".data"), registryPath, eventStore: { emit: async () => {} } }).init(), { code: "PATH_BOUNDARY" });
});

test("concurrent applies on the same base serialize and one fails stale", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const initial = await fx.manager.read("test.settings");
  const left = '{"enabled":false,"winner":"left"}\n';
  const right = '{"enabled":false,"winner":"right"}\n';
  const [leftPlan, rightPlan] = await Promise.all([
    fx.manager.plan("test.settings", left, initial.sha256),
    fx.manager.plan("test.settings", right, initial.sha256),
  ]);
  const results = await Promise.allSettled([
    fx.manager.apply("test.settings", { content: left, baseSha256: initial.sha256, planId: leftPlan.planId, confirmation: "test.settings" }),
    fx.manager.apply("test.settings", { content: right, baseSha256: initial.sha256, planId: rightPlan.planId, confirmation: "test.settings" }),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  const failure = results.find((item) => item.status === "rejected");
  assert.equal(failure.reason.code, "STALE_BASE");
});

test("a committed config write reports audit degradation instead of a false failure", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const initial = await fx.manager.read("test.settings");
  const candidate = '{"enabled":false}\n';
  const plan = await fx.manager.plan("test.settings", candidate, initial.sha256);
  fx.manager.eventStore = { emit: async () => { throw new Error("event disk unavailable"); } };
  const result = await fx.manager.apply("test.settings", {
    content: candidate,
    baseSha256: initial.sha256,
    planId: plan.planId,
    confirmation: "test.settings",
  });
  assert.equal(result.committed, true);
  assert.equal(result.auditDegraded, true);
  assert.equal(JSON.parse(await readFile(resolve(fx.repoRoot, "config/settings.json"), "utf8")).enabled, false);
});

test("manifest finalization failure blocks further writes until restart reconciliation", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const initial = await fx.manager.read("test.settings");
  const candidate = '{"enabled":false}\n';
  const plan = await fx.manager.plan("test.settings", candidate, initial.sha256);
  const atomicReplace = fx.manager.atomicReplace.bind(fx.manager);
  fx.manager.atomicReplace = async (path, content) => {
    if (path.endsWith(".manifest.json") && content.includes('"state": "committed"')) {
      throw new Error("manifest volume unavailable");
    }
    return atomicReplace(path, content);
  };
  const result = await fx.manager.apply("test.settings", {
    content: candidate,
    baseSha256: initial.sha256,
    planId: plan.planId,
    confirmation: "test.settings",
  });
  assert.equal(result.committed, true);
  assert.equal(result.auditDegraded, true);
  assert.equal((await fx.manager.read("test.settings")).transactionBlocked, true);
  await assert.rejects(
    () => fx.manager.plan("test.settings", '{"enabled":true}\n', result.sha256),
    { code: "TRANSACTION_INCONSISTENT" },
  );
});

test("backup namespaces cannot collide across lossy-looking source ids", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-backup-key-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = resolve(root, "repo");
  const dataRoot = resolve(repoRoot, ".ai-shared/control-center");
  await mkdir(resolve(repoRoot, "config"), { recursive: true });
  await writeFile(resolve(repoRoot, "config/a.json"), '{"value":1}\n');
  await writeFile(resolve(repoRoot, "config/b.json"), '{"value":1}\n');
  const registryPath = resolve(root, "sources.json");
  await writeFile(registryPath, JSON.stringify({
    version: 1,
    explicit: [
      { id: "repo:skills/a/b.toml", path: "config/a.json", label: "A", kind: "json", scope: "repo", critical: false },
      { id: "repo:skills/a_b.toml", path: "config/b.json", label: "B", kind: "json", scope: "repo", critical: false },
    ],
    discover: [],
    runtime: [],
  }));
  const manager = await new ConfigManager({ repoRoot, dataRoot, registryPath, eventStore: { emit: async () => {} } }).init();
  for (const id of ["repo:skills/a/b.toml", "repo:skills/a_b.toml"]) {
    const current = await manager.read(id);
    const candidate = '{"value":2}\n';
    const plan = await manager.plan(id, candidate, current.sha256);
    await manager.apply(id, { content: candidate, baseSha256: current.sha256, planId: plan.planId });
  }
  const [aVersions, bVersions] = await Promise.all([manager.versions("repo:skills/a/b.toml"), manager.versions("repo:skills/a_b.toml")]);
  assert.equal(aVersions.length, 1);
  assert.equal(bVersions.length, 1);
  assert.equal(aVersions[0].sourceId, "repo:skills/a/b.toml");
  assert.equal(bVersions[0].sourceId, "repo:skills/a_b.toml");
});

test("rollback reports secondary audit degradation after the file is already restored", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const initial = await fx.manager.read("test.settings");
  const candidate = '{"enabled":false}\n';
  const plan = await fx.manager.plan("test.settings", candidate, initial.sha256);
  const applied = await fx.manager.apply("test.settings", {
    content: candidate,
    baseSha256: initial.sha256,
    planId: plan.planId,
    confirmation: "test.settings",
  });
  const version = (await fx.manager.versions("test.settings"))[0];
  const emit = fx.manager.eventStore.emit.bind(fx.manager.eventStore);
  fx.manager.eventStore.emit = async (type, data) => {
    if (type === "config.rolled_back") throw new Error("secondary audit unavailable");
    return emit(type, data);
  };
  const result = await fx.manager.rollback("test.settings", {
    versionId: version.versionId,
    baseSha256: applied.sha256,
    confirmation: "test.settings",
  });
  assert.equal(result.committed, true);
  assert.equal(result.auditDegraded, true);
  assert.match(result.auditError, /rollback audit event failed/);
  assert.equal(JSON.parse(await readFile(resolve(fx.repoRoot, "config/settings.json"), "utf8")).enabled, true);
});

test("post-commit activation is reported without turning a committed write into a false failure", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  fx.manager.onCommitted = async ({ sourceId }) => ({ status: "reloaded", generation: 2, sourceId });
  const initial = await fx.manager.read("test.settings");
  const candidate = '{"enabled":false}\n';
  const plan = await fx.manager.plan("test.settings", candidate, initial.sha256);
  const result = await fx.manager.apply("test.settings", {
    content: candidate,
    baseSha256: initial.sha256,
    planId: plan.planId,
    confirmation: "test.settings",
  });
  assert.equal(result.activation.status, "reloaded");
  assert.equal(result.activation.generation, 2);
});

test("versionContent returns the exact stored text for rollback preview", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const initial = await fx.manager.read("test.settings");
  const candidate = '{"enabled":false,"mode":"strict"}\n';
  const plan = await fx.manager.plan("test.settings", candidate, initial.sha256);
  await fx.manager.apply("test.settings", { content: candidate, baseSha256: initial.sha256, planId: plan.planId, confirmation: "test.settings" });
  const version = (await fx.manager.versions("test.settings"))[0];
  const preview = await fx.manager.versionContent("test.settings", version.versionId);
  assert.equal(preview.content, initial.content, "版本原文=该版本提交前的文件内容");
  assert.equal(preview.sha256, initial.sha256);
  assert.equal(preview.versionId, version.versionId);
  assert.equal(preview.id, "test.settings");
  assert.equal(preview.path, version.sourcePath);
  await assert.rejects(() => fx.manager.versionContent("test.settings", "no-such-version"), { code: "VERSION_NOT_FOUND" });
  await assert.rejects(() => fx.manager.versionContent("no.such.source", version.versionId), { code: "SOURCE_NOT_FOUND" });
});
