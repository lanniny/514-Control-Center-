#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContent } from "../src/validator.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(appRoot, "..", "..");
const sources = [
  ["control.models", "config/control-center/models.json"],
  ["control.routing", "config/control-center/routing.json"],
  ["control.permissions", "config/control-center/permissions.json"],
  ["control.sources", "config/control-center/sources.json"],
];

const results = [];
for (const [id, relativePath] of sources) {
  const path = resolve(repoRoot, relativePath);
  const result = await validateContent({ id, path, kind: "json" }, await readFile(path, "utf8"));
  results.push({ id, ...result });
}
JSON.parse(await readFile(resolve(repoRoot, "schemas/control-center/contracts.schema.json"), "utf8"));
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
if (results.some((result) => !result.valid)) process.exitCode = 1;
