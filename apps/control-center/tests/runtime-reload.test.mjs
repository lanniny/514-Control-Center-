import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createControlCenter } from "../src/app.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRepo = resolve(appRoot, "../..");

test("committing core routing atomically activates a new runtime generation", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-runtime-reload-"));
  const repoRoot = resolve(root, "repo");
  const configRoot = resolve(repoRoot, "config/control-center");
  const schemaRoot = resolve(repoRoot, "schemas/control-center");
  await mkdir(configRoot, { recursive: true });
  await mkdir(schemaRoot, { recursive: true });
  for (const name of ["models.json", "routing.json", "permissions.json", "claude-coordinator.md"]) {
    await cp(resolve(sourceRepo, "config/control-center", name), resolve(configRoot, name));
  }
  await cp(resolve(sourceRepo, "schemas/control-center/contracts.schema.json"), resolve(schemaRoot, "contracts.schema.json"));
  await writeFile(resolve(configRoot, "sources.json"), `${JSON.stringify({
    version: 1,
    explicit: [
      { id: "control.models", path: "config/control-center/models.json", label: "Models", kind: "json", scope: "repo", critical: true },
      { id: "control.routing", path: "config/control-center/routing.json", label: "Routing", kind: "json", scope: "repo", critical: true },
      { id: "control.permissions", path: "config/control-center/permissions.json", label: "Permissions", kind: "json", scope: "repo", critical: true },
      { id: "control.claude-coordinator", path: "config/control-center/claude-coordinator.md", label: "Coordinator", kind: "markdown", scope: "repo", critical: true },
    ],
    discover: [],
    runtime: [],
  }, null, 2)}\n`);
  const state = await createControlCenter({ repoRoot, dataRoot: resolve(repoRoot, ".ai-shared/control-center") });
  t.after(async () => { await state.close(); await rm(root, { recursive: true, force: true }); });

  const current = await state.configManager.read("control.routing");
  const candidateObject = JSON.parse(current.content);
  candidateObject.weights.speed = 0.15;
  candidateObject.weights.capability = 0.45;
  const candidate = `${JSON.stringify(candidateObject, null, 2)}\n`;
  const plan = await state.configManager.plan("control.routing", candidate, current.sha256);
  const result = await state.configManager.apply("control.routing", {
    content: candidate,
    baseSha256: current.sha256,
    planId: plan.planId,
    confirmation: "control.routing",
  });
  assert.equal(result.activation.status, "reloaded");
  assert.equal(state.generation, 2);
  assert.equal(state.routing.weights.speed, 0.15);

  const updated = await state.configManager.read("control.routing");
  const invalidObject = JSON.parse(updated.content);
  invalidObject.primaryCoordinator = "missing-profile";
  const invalid = `${JSON.stringify(invalidObject, null, 2)}\n`;
  const invalidPlan = await state.configManager.plan("control.routing", invalid, updated.sha256);
  await assert.rejects(
    () => state.configManager.apply("control.routing", {
      content: invalid,
      baseSha256: updated.sha256,
      planId: invalidPlan.planId,
      confirmation: "control.routing",
    }),
    { code: "RUNTIME_GRAPH_INVALID" },
  );
  assert.equal(JSON.parse(await readFile(resolve(configRoot, "routing.json"), "utf8")).primaryCoordinator, "claude-fable");
});
