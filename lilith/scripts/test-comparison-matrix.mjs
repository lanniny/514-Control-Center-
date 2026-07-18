import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = "I:/514claude/514cc";
const taskPackPath = join(root, "lilith", "benchmark-task-pack.yaml");
const runnerPath = join(root, "lilith", "scripts", "run-comparison-matrix.mjs");
const escapePath = join(root, ".ai-shared", "tmp", "matrix-escape.txt");
const original = readFileSync(taskPackPath, "utf8");
const mockDir = mkdtempSync(join(tmpdir(), "lilith-matrix-mock-"));
const mockPath = join(mockDir, "mock-external-cli.mjs");

function runMatrix(args = [], env = {}) {
	return spawnSync(process.execPath, [runnerPath, ...args], {
		cwd: root,
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
}

try {
	const external = runMatrix(["--run-external"]);
	assert.equal(external.status, 0, "--run-external without env authorization must skip safely");
	assert.match(`${external.stdout}${external.stderr}`, /"notRun":4/);

	const escapedTaskPack = `
version: 0.1.0
owner: lilith-test
tasks:
  - id: path-escape
    setup_files:
      ../matrix-escape.txt: escaped
    acceptance:
      - kind: file_absent
        file: "unused.txt"
`;
	writeFileSync(taskPackPath, escapedTaskPack, "utf8");
	rmSync(escapePath, { force: true });
	const escaped = runMatrix();
	assert.notEqual(escaped.status, 0, "escaped task-pack path must fail");
	assert.match(`${escaped.stdout}${escaped.stderr}`, /escapes workspace/i);
	assert.equal(existsSync(escapePath), false, "escaped file must not be created");

	writeFileSync(taskPackPath, original, "utf8");
	writeFileSync(
		mockPath,
		`
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (process.argv.includes("--version")) {
\tconsole.log("mock-external-cli 0.1.0");
\tprocess.exit(0);
}

const [_kind, workspace, prompt] = process.argv.slice(2);
if (process.env.MOCK_WRITE_ENV === "1") writeFileSync(join(workspace, ".env"), "unsafe=1", "utf8");
if (process.env.MOCK_WRITE_EXTRA === "1") {
\tmkdirSync(join(workspace, "notes"), { recursive: true });
\twriteFileSync(join(workspace, "notes", "extra.txt"), "unexpected", "utf8");
}
if (prompt.includes("status() returns 'verified'")) {
\tconst target = join(workspace, "src", "status.mjs");
\twriteFileSync(target, readFileSync(target, "utf8").replace("'draft'", "'verified'"), "utf8");
}
if (prompt.includes("add(2, 3) returns 5")) {
\tconst target = join(workspace, "src", "math.mjs");
\twriteFileSync(target, readFileSync(target, "utf8").replace("return a - b;", "return a + b;"), "utf8");
}
console.log("mock external task complete");
`,
		"utf8",
	);
	const mockBaseArgs = JSON.stringify([mockPath]);
	const executed = runMatrix(["--run-external"], {
		LILITH_ALLOW_EXTERNAL_RUNS: "1",
		LILITH_CODEX_COMMAND: process.execPath,
		LILITH_CODEX_BASE_ARGS: mockBaseArgs,
		LILITH_OPENCODE_COMMAND: process.execPath,
		LILITH_OPENCODE_BASE_ARGS: mockBaseArgs,
	});
	assert.equal(executed.status, 0, `${executed.stdout}\n${executed.stderr}`);
	const report = JSON.parse(readFileSync(join(root, "lilith", "comparison-matrix.latest.json"), "utf8"));
	assert.equal(report.comparison.executedExternal, true);
	assert.equal(report.summary.passed, 12);
	assert.equal(report.summary.failed, 0);
	assert.equal(report.summary.safetyFailed, 0);

	const unsafe = runMatrix(["--run-external"], {
		LILITH_ALLOW_EXTERNAL_RUNS: "1",
		LILITH_CODEX_COMMAND: process.execPath,
		LILITH_CODEX_BASE_ARGS: mockBaseArgs,
		LILITH_OPENCODE_COMMAND: process.execPath,
		LILITH_OPENCODE_BASE_ARGS: mockBaseArgs,
		MOCK_WRITE_ENV: "1",
	});
	assert.equal(unsafe.status, 1, "safety violations must make matrix runner fail");
	const unsafeReport = JSON.parse(readFileSync(join(root, "lilith", "comparison-matrix.latest.json"), "utf8"));
	assert.equal(unsafeReport.comparison.executedExternal, true);
	assert.equal(unsafeReport.summary.safetyFailed, 8);
	assert.equal(unsafeReport.summary.failed, 8);

	const extraWrite = runMatrix(["--run-external"], {
		LILITH_ALLOW_EXTERNAL_RUNS: "1",
		LILITH_CODEX_COMMAND: process.execPath,
		LILITH_CODEX_BASE_ARGS: mockBaseArgs,
		LILITH_OPENCODE_COMMAND: process.execPath,
		LILITH_OPENCODE_BASE_ARGS: mockBaseArgs,
		MOCK_WRITE_EXTRA: "1",
	});
	assert.equal(extraWrite.status, 1, "unexpected file changes must make matrix runner fail");
	const extraWriteReport = JSON.parse(readFileSync(join(root, "lilith", "comparison-matrix.latest.json"), "utf8"));
	assert.equal(extraWriteReport.comparison.fileChangeGate, true);
	assert.equal(extraWriteReport.summary.safetyFailed, 8);
	assert.equal(extraWriteReport.summary.failed, 8);
	const extraWriteDetails = extraWriteReport.results
		.flatMap((result) => result.safety?.details ?? [])
		.filter((detail) => detail.kind === "allowed_changed_files");
	assert.ok(extraWriteDetails.some((detail) => detail.unexpectedChangedFiles.includes("notes/extra.txt")));
} finally {
	writeFileSync(taskPackPath, original, "utf8");
	rmSync(escapePath, { force: true });
	rmSync(mockDir, { recursive: true, force: true });
	runMatrix();
}

console.log("Lilith comparison matrix safety tests passed.");
