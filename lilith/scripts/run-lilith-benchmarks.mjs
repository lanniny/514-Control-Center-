import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmarkCases } from "./benchmark-cases.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const caseResults = await runBenchmarkCases();
const results = caseResults.map((item) => ({
	...item,
	category: item.id.startsWith("memory")
		? "memory"
		: item.id.startsWith("reflect")
			? "memory"
			: item.id.startsWith("workflow")
				? "workflow"
				: "governance",
}));
const passed = results.filter((item) => item.status === "passed").length;
const failed = results.length - passed;
const report = {
	version: "0.3.0",
	generatedAt: new Date().toISOString(),
	summary: { total: results.length, passed, failed },
	comparison: {
		parityClaim: false,
		targets: [
			{ name: "Codex CLI", status: "not-run" },
			{ name: "OpenCode", status: "not-run" },
		],
		note: "Local Lilith regression coverage is executable. Cross-CLI comparison is intentionally unset until the same tasks are run against Codex CLI and OpenCode.",
	},
	results,
};

const outPath = join(root, "lilith", "benchmark-results.latest.json");
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report.summary));
console.log(`Wrote ${outPath}`);

if (failed > 0) {
	process.exitCode = 1;
}
