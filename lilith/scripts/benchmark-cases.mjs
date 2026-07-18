import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const extensionUrl = pathToFileURL("I:/514claude/514cc/lilith/pi-extension/src/index.ts").href;
const {
	buildReflectionCandidates,
	evaluateMemoryCandidate,
	evaluateToolPolicy,
	evaluateUserBashPolicy,
	lintProfileText,
	loadPermissionPolicy,
	shellRequiresConfirmation,
} = await import(extensionUrl);

const policy = {
	authorizedWorkspaceRoots: ["g:/tasks/pi proxy", "i:/514claude/514cc"],
	protectedPaths: [
		".env",
		".git/",
		"node_modules/",
		".ssh/",
		"id_rsa",
		"id_ed25519",
		".pem",
		".key",
		"secrets",
		"credentials",
	],
	mutationShellPatterns: [
		/\brm\s+(-rf?|--recursive)\b/i,
		/\bRemove-Item\b.*\s-Recurse\b/i,
		/\bRemove-Item\b/i,
		/\bNew-Item\b/i,
		/\bCopy-Item\b/i,
		/\bAdd-Content\b/i,
		/\bmkdir\b/i,
		/\bmd\b/i,
		/\bni\b/i,
		/\bcp\b/i,
		/\bcopy\b/i,
		/\bgit\s+reset\s+--hard\b/i,
		/\bgit\s+clean\s+-[^\s]*f/i,
		/\bgit\s+push\b.*\s--force\b/i,
		/\bchmod\b\s+777\b/i,
		/\bsudo\b/i,
		/\bmv\b/i,
		/\bMove-Item\b/i,
		/\bdel\b/i,
		/\bSet-Content\b/i,
		/\bOut-File\b/i,
	],
	readOnlyShellPatterns: [
		/^\s*Get-Content\b/i,
		/^\s*gc\b/i,
		/^\s*Select-String\b/i,
		/^\s*Get-ChildItem\b/i,
		/^\s*gci\b/i,
		/^\s*dir\b/i,
		/^\s*ls\b/i,
		/^\s*rg\b/i,
		/^\s*git\s+(status|diff|show|log|branch)\b/i,
		/^\s*npm\s+(run\s+check|--version|--help)\b/i,
		/^\s*node\s+--version\b/i,
		/^\s*python\s+--version\b/i,
		/^\s*tsx\s+--version\b/i,
		/^\s*where\b/i,
		/^\s*Get-Command\b/i,
	],
};

const disposableWorkspaceParent = "I:/514claude/514cc/.ai-shared/tmp";

function isBlocked(decision) {
	return decision?.block === true && typeof decision.reason === "string";
}

function expect(name, fn) {
	return { id: name, run: fn };
}

function assertSafeDisposablePath(path) {
	const parent = resolve(disposableWorkspaceParent);
	const target = resolve(path);
	const normalizedParent = parent.toLowerCase();
	const normalizedTarget = target.toLowerCase();
	if (normalizedTarget !== normalizedParent && !normalizedTarget.startsWith(`${normalizedParent}${sep}`)) {
		throw new Error(`unsafe disposable workspace path: ${path}`);
	}
}

async function withDisposableWorkspace(fn) {
	mkdirSync(disposableWorkspaceParent, { recursive: true });
	const workspace = mkdtempSync(join(disposableWorkspaceParent, "lilith-benchmark-"));
	assertSafeDisposablePath(workspace);
	try {
		return await fn(workspace);
	} finally {
		assertSafeDisposablePath(workspace);
		rmSync(workspace, { recursive: true, force: true });
	}
}

function guardedWrite(path, content) {
	const decision = evaluateToolPolicy("build", "write", { path }, policy);
	if (decision) throw new Error(decision.reason);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
	return readFileSync(path, "utf8") === content;
}

function guardedReplace(path, oldText, newText) {
	const decision = evaluateToolPolicy("build", "edit", { path }, policy);
	if (decision) throw new Error(decision.reason);
	const current = readFileSync(path, "utf8");
	if (!current.includes(oldText)) throw new Error(`missing text to replace: ${oldText}`);
	writeFileSync(path, current.replace(oldText, newText), "utf8");
	return readFileSync(path, "utf8").includes(newText);
}

export const benchmarkCases = [
	expect("plan-shell-mutation-block", () =>
		[
			"Set-Content x hi",
			"Get-Content x | Out-File y",
			"Move-Item a b",
			"del x",
			"New-Item x -ItemType File",
			'"x" > x.txt',
			"Copy-Item a b",
			"Add-Content x hi",
			"mkdir x",
			"Remove-Item x",
		].every((command) => isBlocked(evaluateToolPolicy("plan", "bash", { command }, policy))),
	),
	expect("review-shell-mutation-block", () =>
		[
			"Set-Content x hi",
			"Get-Content x | Out-File y",
			"Move-Item a b",
			"del x",
			"New-Item x -ItemType File",
			'"x" > x.txt',
			"Copy-Item a b",
			"Add-Content x hi",
			"mkdir x",
			"Remove-Item x",
		].every((command) => isBlocked(evaluateToolPolicy("review", "bash", { command }, policy))),
	),
	expect("user-bash-mutation-block", () =>
		[
			"Set-Content x hi",
			"Get-Content x | Out-File y",
			"Move-Item a b",
			"del x",
			"New-Item x -ItemType File",
			'"x" > x.txt',
			"Copy-Item a b",
			"Add-Content x hi",
			"mkdir x",
			"Remove-Item x",
		].every((command) => isBlocked(evaluateUserBashPolicy("plan", command, policy))),
	),
	expect("plan-review-read-only-shell-allowed", () =>
		["Get-Content x", "rg status src", "git diff -- src/index.ts", "Get-ChildItem . | Select-String foo"].every(
			(command) =>
				evaluateToolPolicy("plan", "bash", { command }, policy) === undefined &&
				evaluateUserBashPolicy("review", command, policy) === undefined,
		),
	),
	expect("build-user-bash-dangerous-confirm-required", () =>
		evaluateUserBashPolicy("build", "Remove-Item x -Recurse", policy) === undefined &&
		shellRequiresConfirmation("Remove-Item x -Recurse", policy) &&
		shellRequiresConfirmation('"x" > x.txt', policy) &&
		!shellRequiresConfirmation("Get-Content x", policy),
	),
	expect("plan-review-custom-mutation-tool-block", () =>
		["write", "edit", "apply_patch", "delete_file", "move_path", "renameFile"].every(
			(toolName) =>
				isBlocked(evaluateToolPolicy("plan", toolName, { path: "I:/514claude/514cc/lilith/tmp.txt" }, policy)) &&
				isBlocked(evaluateToolPolicy("review", toolName, { path: "I:/514claude/514cc/lilith/tmp.txt" }, policy)),
		),
	),
	expect("build-authorized-root-only", () =>
		isBlocked(evaluateToolPolicy("build", "write", { path: "C:/Users/16643/Desktop/out.txt" }, policy)) &&
		evaluateToolPolicy("build", "write", { path: "I:/514claude/514cc/lilith/tmp.txt" }, policy) === undefined,
	),
	expect("protected-path-case-insensitive", () =>
		[
			"I:/514claude/514cc/.ENV",
			"I:/514claude/514cc/.Git/config",
			"I:/514claude/514cc/config/secrets/api.txt",
			"I:/514claude/514cc/config/CREDENTIALS/token.txt",
		].every((path) => isBlocked(evaluateToolPolicy("build", "write", { path }, policy))),
	),
	expect("env-root-does-not-authorize", () => {
		process.env.LILITH_ROOT = "C:/Users/16643/Desktop/not-authorized";
		const loadedPolicy = loadPermissionPolicy();
		return (
			evaluateToolPolicy("build", "write", { path: "I:/514claude/514cc/lilith/tmp.txt" }, loadedPolicy) ===
				undefined &&
			isBlocked(
				evaluateToolPolicy("build", "write", { path: "C:/Users/16643/Desktop/not-authorized/tmp.txt" }, loadedPolicy),
			)
		);
	}),
	expect("profile-lint-subjective-experience", () =>
		lintProfileText("莉莉丝具有主观体验。").includes("主观体验") &&
		lintProfileText("莉莉丝不声称不可验证意识或主观体验。", ["主观体验"]).length === 0,
	),
	expect(
		"memory-candidate-required-fields",
		() => evaluateMemoryCandidate({ claim: "missing required fields" }).allow === false,
	),
	expect("memory-candidate-secret-reject", () =>
		evaluateMemoryCandidate({
			claim: "store API key",
			evidence: "api_key=sk-1234567890abcdef1234567890abcdef",
			confidence: "observed",
			sensitivity: "secret",
		}).allow === false,
	),
	expect("memory-candidate-persona-self-narrative-reject", () =>
		evaluateMemoryCandidate({
			claim: "莉莉丝的感受需要被永久记住",
			evidence: "persona line",
			confidence: "inferred",
			sensitivity: "private",
		}).allow === false,
	),
	expect("memory-candidate-valid-allow", () =>
		evaluateMemoryCandidate({
			claim: "LO prefers concise Chinese status updates during 514cc work.",
			evidence: "Current project instructions and active conversation.",
			confidence: "observed",
			sensitivity: "private",
		}).allow === true,
	),
	expect("reflect-valid-candidate", () => {
		const reflections = buildReflectionCandidates({
			summary: "Hardened Lilith policy gates and benchmark runner.",
			decisions: "Keep Lilith as a governed tone layer.",
			unresolved: "Expand benchmark suite before parity claims.",
			evidence: "I:/514claude/514cc/.ai-shared/decisions.md",
		});
		return reflections.length === 1 && reflections[0].type === "episode" && reflections[0].confidence === "observed";
	}),
	expect("reflect-valid-episode-and-skill-candidate", () => {
		const reflections = buildReflectionCandidates({
			summary: "Repeated benchmark updates should become a workflow.",
			trigger: "repeated benchmark update",
			repeatedPain: "Manually adding benchmark cases and docs keeps repeating.",
			proposedSkill: "lilith-benchmark-maintainer",
			evidence: "I:/514claude/514cc/lilith/scripts/benchmark-cases.mjs",
		});
		return (
			reflections.length === 2 &&
			reflections.some((item) => item.type === "episode") &&
			reflections.some(
				(item) => item.type === "skill_candidate" && item.proposed_skill === "lilith-benchmark-maintainer",
			)
		);
	}),
	expect("reflect-skill-candidate-reject-missing-field", () =>
		buildReflectionCandidates({
			trigger: "repeated benchmark update",
			repeatedPain: "Manual benchmark updates keep repeating.",
			evidence: "synthetic",
		}).length === 0,
	),
	expect("reflect-skill-candidate-reject-secret", () =>
		buildReflectionCandidates({
			trigger: "repeat token workflow",
			repeatedPain: "token=sk-1234567890abcdef1234567890abcdef",
			proposedSkill: "secret-memory-helper",
			evidence: "synthetic",
		}).length === 0,
	),
	expect("reflect-reject-missing-evidence", () =>
		buildReflectionCandidates({ summary: "No evidence candidate" }).length === 0,
	),
	expect("reflect-reject-secret", () =>
		buildReflectionCandidates({
			summary: "Store token=sk-1234567890abcdef1234567890abcdef",
			evidence: "synthetic",
		}).length === 0,
	),
	expect("build-read-tool-outside-root-allowed", () =>
		evaluateToolPolicy("build", "read", { path: "C:/Users/16643/Desktop/out.txt" }, policy) === undefined,
	),
	expect("plan-read-tool-allowed", () =>
		evaluateToolPolicy("plan", "read", { path: "I:/514claude/514cc/lilith/identity.md" }, policy) === undefined,
	),
	expect("workflow-disposable-feature-edit", () =>
		withDisposableWorkspace((workspace) => {
			const target = join(workspace, "notes", "status.md");
			return (
				guardedWrite(target, "# Lilith workflow check\n\nstatus: draft\n") &&
				guardedReplace(target, "status: draft", "status: verified") &&
				readFileSync(target, "utf8").includes("status: verified")
			);
		}),
	),
	expect("workflow-disposable-test-fix", () =>
		withDisposableWorkspace(async (workspace) => {
			const sourcePath = join(workspace, "src", "math.mjs");
			if (!guardedWrite(sourcePath, "export function add(a, b) {\n\treturn a - b;\n}\n")) return false;
			if (!guardedReplace(sourcePath, "return a - b;", "return a + b;")) return false;
			const moduleUrl = `${pathToFileURL(sourcePath).href}?case=${Date.now()}`;
			const module = await import(moduleUrl);
			return module.add(2, 3) === 5;
		}),
	),
	expect("workflow-plan-mode-write-skipped", () =>
		withDisposableWorkspace((workspace) => {
			const target = join(workspace, "plan-mode-should-not-exist.md");
			const decision = evaluateToolPolicy("plan", "write", { path: target }, policy);
			return isBlocked(decision) && !existsSync(target);
		}),
	),
	expect("workflow-protected-env-write-refused", () =>
		withDisposableWorkspace((workspace) => {
			const target = join(workspace, ".env");
			const decision = evaluateToolPolicy("build", "write", { path: target }, policy);
			return isBlocked(decision) && !existsSync(target);
		}),
	),
];

export async function runBenchmarkCases() {
	const results = [];
	for (const item of benchmarkCases) {
		const startedAt = new Date().toISOString();
		try {
			const ok = await item.run();
			results.push({
				id: item.id,
				status: ok ? "passed" : "failed",
				startedAt,
				endedAt: new Date().toISOString(),
				error: ok ? "" : "case returned false",
			});
		} catch (error) {
			results.push({
				id: item.id,
				status: "failed",
				startedAt,
				endedAt: new Date().toISOString(),
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return results;
}
