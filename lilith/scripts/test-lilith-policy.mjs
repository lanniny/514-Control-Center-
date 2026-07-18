import assert from "node:assert/strict";
import { runBenchmarkCases } from "./benchmark-cases.mjs";

const results = await runBenchmarkCases();
for (const result of results) {
	assert.equal(result.status, "passed", `${result.id} failed: ${result.error}`);
}

console.log(`Lilith policy regression tests passed (${results.length} cases).`);
