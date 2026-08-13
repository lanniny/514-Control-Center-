import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { ccSwitchCapabilityEntries, CCSWITCH_UPSTREAM } from "../src/ccswitch/capability-map.mjs";
import { compareCommandCoverage, validateCcSwitchMigration } from "../scripts/validate-ccswitch-migration.mjs";

test("CC-Switch 3.18.0 command ledger maps the pinned 287+1 registry baseline", async () => {
  const result = await validateCcSwitchMigration();
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
  assert.equal(result.commandCount, 288);
  assert.equal(result.namespacedCommandCount, 287);
  assert.equal(typeof result.registryVerified, "boolean");
  assert.equal(Object.values(result.statuses).reduce((sum, count) => sum + count, 0), CCSWITCH_UPSTREAM.commandCount);
});

test("CC-Switch ledger stays valid when the optional upstream scratch tree is absent", async () => {
  const result = await validateCcSwitchMigration({
    registryPath: resolve(".test-fixtures", "missing-ccswitch-registry.rs"),
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
  assert.equal(result.registryVerified, false);
});

test("CC-Switch command coverage fails closed for a newly added or omitted command", () => {
  const mapped = ccSwitchCapabilityEntries();
  const registry = mapped.map((item) => item.command);
  const added = compareCommandCoverage([...registry, "new_upstream_command"], mapped);
  assert.deepEqual(added.missing, ["new_upstream_command"]);
  assert.equal(added.orderMatches, false);

  const omitted = compareCommandCoverage(registry, mapped.slice(0, -1));
  assert.deepEqual(omitted.missing, [registry.at(-1)]);
  assert.equal(omitted.orderMatches, false);
});
