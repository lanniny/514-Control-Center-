#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContent, validateRepositoryTruth } from "../src/validator.mjs";
import { validateCcSwitchMigration } from "./validate-ccswitch-migration.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(appRoot, "..", "..");
const sources = [
  ["control.models", "config/control-center/models.json", "json"],
  ["control.routing", "config/control-center/routing.json", "json"],
  ["control.permissions", "config/control-center/permissions.json", "json"],
  ["control.sources", "config/control-center/sources.json", "json"],
  ["core.module", "module.yaml", "yaml"],
];

const results = [];
for (const [id, relativePath, kind] of sources) {
  const path = resolve(repoRoot, relativePath);
  const result = await validateContent({ id, path, kind }, await readFile(path, "utf8"));
  results.push({ id, ...result });
}
JSON.parse(await readFile(resolve(repoRoot, "schemas/control-center/contracts.schema.json"), "utf8"));
JSON.parse(await readFile(resolve(repoRoot, "schemas/module.schema.json"), "utf8"));
results.push(...await validateRepositoryTruth(repoRoot));
const ccSwitch = await validateCcSwitchMigration();
results.push({
  id: "ccswitch.3.18.0-capability-ledger",
  valid: ccSwitch.valid,
  errors: ccSwitch.errors,
  commandCount: ccSwitch.commandCount,
  registryVerified: ccSwitch.registryVerified,
  statuses: ccSwitch.statuses,
});
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
if (results.some((result) => !result.valid)) process.exitCode = 1;
