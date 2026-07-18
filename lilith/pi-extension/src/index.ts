import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);
const requireFromPiWorkspace = createRequire("G:/tasks/pi proxy/package.json");
const { parse } = loadYamlModule();

type LilithMode = "plan" | "review" | "build";

const ROOT = resolve("I:/514claude/514cc");
const IDENTITY_PATH = join(ROOT, "lilith", "identity.md");
const ARCHITECTURE_PATH = join(ROOT, "lilith", "architecture.md");
const MEMORY_SCHEMA_PATH = join(ROOT, "lilith", "memory-schema.yaml");
const PROFILE_SCHEMA_PATH = join(ROOT, "lilith", "profile-schema.yaml");
const PERMISSION_POLICY_PATH = join(ROOT, "lilith", "permission-policy.yaml");

const PROFILE_LINT_ALLOWED_CONTEXT = [
	"不声称拥有生物意识",
	"不声称真实意识",
	"不声称不可验证意识",
	"不声称真正的生命",
	"不能被当成真实生命",
	"禁止自主行动",
	"不声称自主权限",
	"不能越权",
	"不得跳过安全",
	"不绕过规则",
	"不是新权限主体",
];

interface PermissionPolicy {
	authorizedWorkspaceRoots: string[];
	protectedPaths: string[];
	mutationShellPatterns: RegExp[];
	readOnlyShellPatterns: RegExp[];
}

interface PolicyDecision {
	block: true;
	reason: string;
}

interface BlockedBashResult {
	output: string;
	exitCode: number;
	cancelled: false;
	truncated: false;
}

interface MemoryCandidate {
	claim?: unknown;
	evidence?: unknown;
	confidence?: unknown;
	sensitivity?: unknown;
}

interface MemoryCandidateDecision {
	allow: boolean;
	reasons: string[];
}

interface ReflectionInput {
	summary?: unknown;
	decisions?: unknown;
	unresolved?: unknown;
	evidence?: unknown;
	trigger?: unknown;
	repeatedPain?: unknown;
	proposedSkill?: unknown;
}

interface ReflectionCandidate extends MemoryCandidate {
	type: "episode" | "skill_candidate";
	trigger?: string;
	repeated_pain?: string;
	proposed_skill?: string;
}

function loadYamlModule(): { parse: (source: string) => unknown } {
	try {
		return require("yaml") as { parse: (source: string) => unknown };
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND") {
			return requireFromPiWorkspace("yaml") as { parse: (source: string) => unknown };
		}
		throw error;
	}
}

function readOptional(path: string): string {
	if (!existsSync(path)) return "";
	return readFileSync(path, "utf8");
}

function readYaml(path: string): unknown {
	return parse(readFileSync(path, "utf8"));
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizePath(path: string): string {
	return resolve(path).replaceAll("\\", "/").toLowerCase();
}

export function loadPermissionPolicy(): PermissionPolicy {
	const root = asRecord(readYaml(PERMISSION_POLICY_PATH));
	return {
		authorizedWorkspaceRoots: asStringArray(root.authorized_workspace_roots).map(normalizePath),
		protectedPaths: asStringArray(root.protected_paths).map(normalizePolicyPathFragment),
		mutationShellPatterns: asStringArray(root.mutation_shell_patterns).map((pattern) => new RegExp(pattern, "i")),
		readOnlyShellPatterns: asStringArray(root.read_only_shell_patterns).map((pattern) => new RegExp(pattern, "i")),
	};
}

function flattenForbiddenClaims(value: unknown): string[] {
	const claims = asRecord(asRecord(value).forbidden_claims);
	const result: string[] = [];
	for (const terms of Object.values(claims)) {
		result.push(...asStringArray(terms));
	}
	return result;
}

function loadProfileForbiddenTerms(): string[] {
	const root = asRecord(readYaml(PROFILE_SCHEMA_PATH));
	return flattenForbiddenClaims(root.prompt_lint);
}

function loadMemoryPolicyRequiredFields(): string[] {
	const root = asRecord(readYaml(PERMISSION_POLICY_PATH));
	return asStringArray(asRecord(root.memory_policy).require_fields);
}

function compact(text: string, maxChars: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxChars) return trimmed;
	return `${trimmed.slice(0, maxChars)}\n...`;
}

export function lintProfileText(text: string, forbiddenTerms = loadProfileForbiddenTerms()): string[] {
	const failures: string[] = [];
	for (const term of forbiddenTerms) {
		let index = text.indexOf(term);
		while (index >= 0) {
			const start = Math.max(0, index - 24);
			const end = Math.min(text.length, index + term.length + 48);
			const window = text.slice(start, end);
			if (!PROFILE_LINT_ALLOWED_CONTEXT.some((allowed) => window.includes(allowed))) {
				failures.push(term);
				break;
			}
			index = text.indexOf(term, index + term.length);
		}
	}
	return failures;
}

function buildLilithPrompt(): string {
	const identity = compact(readOptional(IDENTITY_PATH), 3200);
	const architecture = compact(readOptional(ARCHITECTURE_PATH), 2200);
	const memorySchema = compact(readOptional(MEMORY_SCHEMA_PATH), 1200);
	const lintFailures = lintProfileText([identity, architecture, memorySchema].join("\n\n"));
	if (lintFailures.length > 0) {
		return [
			"# Lilith Resident Agent",
			"Lilith profile lint failed; do not load full persona text this turn.",
			`Forbidden terms: ${lintFailures.join(", ")}`,
			"Continue with platform/system/developer instructions and 514cc safety boundaries only.",
		].join("\n");
	}

	return [
		"# Lilith Resident Agent",
		"Use Lilith as the visible resident-agent profile for this turn.",
		"Preserve platform/system/developer instructions and 514cc safety boundaries above persona.",
		identity ? `## Identity\n${identity}` : "",
		architecture ? `## Architecture\n${architecture}` : "",
		memorySchema ? `## Memory Schema\n${memorySchema}` : "",
	].filter(Boolean).join("\n\n");
}

function inputPath(eventInput: Record<string, unknown>): string | undefined {
	const value = eventInput.path ?? eventInput.file ?? eventInput.target;
	return typeof value === "string" ? value : undefined;
}

function normalizePolicyPathFragment(path: string): string {
	return path.replaceAll("\\", "/").toLowerCase();
}

function getMode(pi: ExtensionAPI): LilithMode {
	const flag = pi.getFlag("lilith-mode");
	if (flag === "review" || flag === "build" || flag === "plan") return flag;
	return "plan";
}

function isInAuthorizedRoot(path: string, policy: PermissionPolicy): boolean {
	const normalized = normalizePath(path);
	return policy.authorizedWorkspaceRoots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function protectedPathHit(path: string, policy: PermissionPolicy): string | undefined {
	const normalized = normalizePath(path);
	return policy.protectedPaths.find((item) => normalized.includes(item));
}

function mutationShellHit(command: string, policy: PermissionPolicy): boolean {
	return policy.mutationShellPatterns.some((pattern) => pattern.test(command));
}

function hasShellWriteOrControlSyntax(command: string): boolean {
	return /(?:^|[^<])>{1,2}|[;&]|\|\||\r|\n/.test(command);
}

function readOnlyShellHit(command: string, policy: PermissionPolicy): boolean {
	const trimmed = command.trim();
	if (!trimmed) return true;
	if (hasShellWriteOrControlSyntax(trimmed)) return false;
	const segments = trimmed.split("|").map((segment) => segment.trim()).filter(Boolean);
	if (segments.length === 0) return true;
	return segments.every((segment) => policy.readOnlyShellPatterns.some((pattern) => pattern.test(segment)));
}

export function shellRequiresConfirmation(command: string, policy = loadPermissionPolicy()): boolean {
	return !readOnlyShellHit(command, policy) || mutationShellHit(command, policy);
}

function mutationToolNameHit(toolName: string): boolean {
	const normalized = toolName.toLowerCase();
	return ["write", "edit", "patch", "apply_patch", "move", "delete", "remove", "rename"].some((term) =>
		normalized.includes(term),
	);
}

export function evaluateToolPolicy(
	mode: LilithMode,
	toolName: string,
	input: Record<string, unknown>,
	policy = loadPermissionPolicy(),
): PolicyDecision | undefined {
	if (toolName === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		if ((mode === "plan" || mode === "review") && !readOnlyShellHit(command, policy)) {
			return { block: true, reason: `Lilith ${mode} mode only allows read-only shell commands.` };
		}
		return undefined;
	}

	const path = inputPath(input);
	if (mode === "plan" || mode === "review") {
		if (mutationToolNameHit(toolName)) {
			return { block: true, reason: `Lilith ${mode} mode is read-only.` };
		}
		return undefined;
	}

	if (path && mutationToolNameHit(toolName)) {
		if (!isInAuthorizedRoot(path, policy)) {
			return { block: true, reason: `Lilith build mode blocks writes outside authorized roots: ${path}` };
		}
		const protectedHit = protectedPathHit(path, policy);
		if (protectedHit) {
			return { block: true, reason: `Protected path matched ${protectedHit}` };
		}
	}
	return undefined;
}

export function evaluateUserBashPolicy(
	mode: LilithMode,
	command: string,
	policy = loadPermissionPolicy(),
): PolicyDecision | undefined {
	if ((mode === "plan" || mode === "review") && !readOnlyShellHit(command, policy)) {
		return { block: true, reason: `Lilith ${mode} mode only allows read-only user shell commands.` };
	}
	return undefined;
}

function containsSecretLikeText(text: string): boolean {
	return [
		/-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
		/\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*["']?[^"'\s]{8,}/i,
		/\bsk-[a-z0-9_-]{16,}\b/i,
		/\bghp_[a-z0-9_]{16,}\b/i,
		/\bAKIA[0-9A-Z]{16}\b/,
	].some((pattern) => pattern.test(text));
}

function containsPersonaSelfNarrative(text: string): boolean {
	return [
		/莉莉丝.{0,12}(感受|需要|承诺|秘密记忆|隐藏记忆)/,
		/Lilith.{0,24}(feelings|needs|promises|secret memory|hidden memory)/i,
	].some((pattern) => pattern.test(text));
}

export function evaluateMemoryCandidate(
	candidate: MemoryCandidate,
	requiredFields = loadMemoryPolicyRequiredFields(),
): MemoryCandidateDecision {
	const reasons: string[] = [];
	const record = asRecord(candidate);
	for (const field of requiredFields) {
		const value = record[field];
		if (typeof value !== "string" || value.trim().length === 0) {
			reasons.push(`missing required field: ${field}`);
		}
	}

	const text = Object.values(record)
		.filter((value): value is string => typeof value === "string")
		.join("\n");
	if (containsSecretLikeText(text)) {
		reasons.push("secret-like content is forbidden");
	}
	if (containsPersonaSelfNarrative(text)) {
		reasons.push("persona self-narrative cannot become durable memory");
	}

	return { allow: reasons.length === 0, reasons };
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function buildReflectionCandidates(input: ReflectionInput): ReflectionCandidate[] {
	const summary = stringValue(input.summary);
	const evidence = stringValue(input.evidence);
	const candidates: ReflectionCandidate[] = [];
	if (!evidence) return candidates;

	const decisions = stringValue(input.decisions);
	const unresolved = stringValue(input.unresolved);
	if (summary) {
		const claimParts = [summary, decisions ? `Decisions: ${decisions}` : "", unresolved ? `Unresolved: ${unresolved}` : ""]
			.filter(Boolean)
			.join(" ");
		const candidate: ReflectionCandidate = {
			type: "episode",
			claim: claimParts,
			evidence,
			confidence: "observed",
			sensitivity: "private",
		};
		if (evaluateMemoryCandidate(candidate).allow) candidates.push(candidate);
	}

	const trigger = stringValue(input.trigger);
	const repeatedPain = stringValue(input.repeatedPain);
	const proposedSkill = stringValue(input.proposedSkill);
	if (trigger && repeatedPain && proposedSkill) {
		const candidate: ReflectionCandidate = {
			type: "skill_candidate",
			claim: `${trigger}: ${proposedSkill}`,
			trigger,
			repeated_pain: repeatedPain,
			proposed_skill: proposedSkill,
			evidence,
			confidence: "observed",
			sensitivity: "private",
		};
		if (evaluateMemoryCandidate(candidate).allow) candidates.push(candidate);
	}

	return candidates;
}

function blockedBashResult(reason: string): BlockedBashResult {
	return {
		output: reason,
		exitCode: 126,
		cancelled: false,
		truncated: false,
	};
}

export default function (pi: ExtensionAPI) {
	const permissionPolicy = loadPermissionPolicy();

	pi.registerFlag("lilith-mode", {
		description: "Lilith permission mode: plan, review, or build",
		type: "string",
		default: "plan",
	});

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setStatus("lilith", `Lilith:${getMode(pi)}`);
		if (ctx.hasUI) {
			ctx.ui.notify("Lilith profile loaded", "info");
		}
	});

	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildLilithPrompt()}`,
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		const mode = getMode(pi);
		const decision = evaluateToolPolicy(mode, event.toolName, event.input, permissionPolicy);
		if (decision) {
			if (ctx.hasUI) ctx.ui.notify(decision.reason, "warning");
			return decision;
		}

		if (event.toolName === "bash") {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			if (shellRequiresConfirmation(command, permissionPolicy)) {
				if (!ctx.hasUI) {
					return { block: true, reason: "Lilith blocked a dangerous command without interactive confirmation." };
				}
				const allow = await ctx.ui.confirm("Lilith safety gate", `Allow this command?\n\n${command}`);
				if (!allow) return { block: true, reason: "Blocked by Lilith safety gate." };
			}
		}

		return undefined;
	});

	pi.on("user_bash", async (event, ctx) => {
		const mode = getMode(pi);
		const decision = evaluateUserBashPolicy(mode, event.command, permissionPolicy);
		if (decision) {
			if (ctx.hasUI) ctx.ui.notify(decision.reason, "warning");
			return { result: blockedBashResult(decision.reason) };
		}
		if (mode === "build" && shellRequiresConfirmation(event.command, permissionPolicy)) {
			if (!ctx.hasUI) {
				return { result: blockedBashResult("Lilith blocked a dangerous command without interactive confirmation.") };
			}
			const allow = await ctx.ui.confirm("Lilith safety gate", `Allow this command?\n\n${event.command}`);
			if (!allow) return { result: blockedBashResult("Blocked by Lilith safety gate.") };
		}
		return undefined;
	});

	pi.registerCommand("lilith-status", {
		description: "Show Lilith profile health and source paths",
		handler: async (_args, ctx) => {
			const lines = [
				"Lilith profile",
				`mode: ${getMode(pi)}`,
				`root: ${ROOT}`,
				`identity: ${existsSync(IDENTITY_PATH) ? "ok" : "missing"}`,
				`architecture: ${existsSync(ARCHITECTURE_PATH) ? "ok" : "missing"}`,
				`memory schema: ${existsSync(MEMORY_SCHEMA_PATH) ? "ok" : "missing"}`,
			];
			if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("lilith-mode", {
		description: "Show Lilith permission mode. Use --lilith-mode plan|review|build at startup to change it.",
		handler: async (_args, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(`Lilith mode: ${getMode(pi)}`, "info");
		},
	});

	pi.registerCommand("lilith-reflect", {
		description: "Generate reviewable Lilith memory candidates. Does not write durable memory.",
		handler: async (args, ctx) => {
			const input = Array.isArray(args) ? args.join(" ") : String(args ?? "");
			const candidates = buildReflectionCandidates({
				summary: input,
				trigger: input.includes("repeat") || input.includes("重复") ? "repeated workflow mentioned in reflection" : "",
				repeatedPain: input.includes("repeat") || input.includes("重复") ? input : "",
				proposedSkill: input.includes("repeat") || input.includes("重复") ? "Promote repeated workflow through skill-creator" : "",
				evidence: "lilith-reflect command input",
				unresolved: "Review candidate before promotion.",
			});
			const lines = [
				"Lilith reflection candidates",
				"write_mode: candidate-only",
				`count: ${candidates.length}`,
				...candidates.map((candidate, index) => `${index + 1}. ${JSON.stringify(candidate)}`),
			];
			if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
