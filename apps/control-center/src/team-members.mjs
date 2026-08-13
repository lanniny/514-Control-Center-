import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { findSecretCandidates } from "./redaction.mjs";

const STORE_VERSION = 1;
const STORE_MAX_BYTES = 2 * 1024 * 1024;
const MEMBER_MAX = 512;
const CAPABILITY_MAX = 64;
const ID_MAX = 128;
const LABEL_MAX = 120;
const SHORT_LABEL_MAX = 48;
const ROLE_MAX = 120;
const DESCRIPTION_MAX = 2_000;
const SYSTEM_PROMPT_MAX = 12_000;
const OPTION_MAX = 160;

const PROTOTYPE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const METADATA_KEYS = Object.freeze([
  "label",
  "shortLabel",
  "role",
  "description",
  "systemPrompt",
  "capabilities",
  "defaultModel",
  "defaultEffort",
]);
const METADATA_KEY_SET = new Set(METADATA_KEYS);
const CUSTOM_INPUT_KEYS = new Set(["runtimeProfileId", "mainBrainAllowed", ...METADATA_KEYS]);
const PERSISTED_KEYS = new Set([
  "id",
  "runtimeProfileId",
  "builtin",
  "createdAt",
  "updatedAt",
  "mainBrainAllowed",
  ...METADATA_KEYS,
]);
const MUTATION_CHAINS = new Map();
const execFileAsync = promisify(execFile);
let windowsPrincipalPromise = null;

function fail(message, code = "VALIDATION_FAILED", details = undefined) {
  throw Object.assign(new Error(message), { code }, details);
}

function serializeMutation(path, operation) {
  const previous = MUTATION_CHAINS.get(path) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.catch(() => {});
  MUTATION_CHAINS.set(path, tail);
  void tail.then(() => {
    if (MUTATION_CHAINS.get(path) === tail) MUTATION_CHAINS.delete(path);
  });
  return result;
}

function windowsSystemTool(name) {
  return join(process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows", "System32", name);
}

async function restrictPrivateFile(file) {
  try {
    if (process.platform === "win32") {
      windowsPrincipalPromise ??= execFileAsync(windowsSystemTool("whoami.exe"), ["/user", "/fo", "csv", "/nh"], {
        windowsHide: true,
        timeout: 10_000,
      }).then(({ stdout }) => {
        const sid = String(stdout).match(/S-\d+(?:-\d+)+/i)?.[0];
        if (!sid) fail("current Windows SID is unavailable", "SID_UNAVAILABLE");
        return `*${sid}`;
      });
      const principal = await windowsPrincipalPromise;
      await execFileAsync(windowsSystemTool("icacls.exe"), [file, "/grant:r", `${principal}:(F)`], {
        windowsHide: true,
        timeout: 10_000,
      });
      await execFileAsync(windowsSystemTool("icacls.exe"), [file, "/inheritance:r"], {
        windowsHide: true,
        timeout: 10_000,
      });
      return;
    }
    await chmod(file, 0o600);
  } catch (error) {
    fail("failed to restrict team member store permissions", "MEMBER_STORE_PERMISSION_FAILED", {
      causeCode: error?.code ?? null,
      cause: error,
    });
  }
}

function assertPlainRecord(value, label, code = "VALIDATION_FAILED") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`, code);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} has an unsafe prototype`, code);
  }
  for (const key of Object.keys(value)) {
    if (PROTOTYPE_KEYS.has(key)) fail(`${label} contains a forbidden key: ${key}`, code);
  }
  return value;
}

function assertAllowedKeys(value, allowed, label, code = "VALIDATION_FAILED") {
  assertPlainRecord(value, label, code);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains an unsupported field: ${key}`, code);
  }
}

function cleanIdentifier(value, label, code = "VALIDATION_FAILED") {
  if (typeof value !== "string") fail(`${label} must be a string`, code);
  const identifier = value.trim();
  if (
    !identifier
    || identifier.length > ID_MAX
    || PROTOTYPE_KEYS.has(identifier)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(identifier)
  ) {
    fail(`${label} is invalid`, code);
  }
  return identifier;
}

function cleanText(value, label, max, {
  code = "VALIDATION_FAILED",
  required = false,
  nullable = false,
} = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== "string") fail(`${label} must be a string`, code);
  const text = value.trim();
  if (required && !text) fail(`${label} is required`, code);
  if (text.length > max) fail(`${label} exceeds ${max} characters`, code);
  if (findSecretCandidates(text).length) {
    fail(`${label} contains secret-like material; use a credential reference instead`, code);
  }
  return text;
}

function cleanOptionalText(value, label, max, options = {}) {
  if (value === undefined) return undefined;
  return cleanText(value, label, max, options);
}

function cleanBoolean(value, label, { code = "VALIDATION_FAILED", nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== "boolean") fail(`${label} must be a boolean`, code);
  return value;
}

function cleanCapabilities(value, label = "capabilities", {
  code = "VALIDATION_FAILED",
  optional = false,
} = {}) {
  if (value === undefined && optional) return undefined;
  if (!Array.isArray(value)) fail(`${label} must be an array`, code);
  if (value.length > CAPABILITY_MAX) fail(`${label} exceeds ${CAPABILITY_MAX} entries`, code);
  const capabilities = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== "string") fail(`${label} entries must be strings`, code);
    const capability = raw.trim();
    if (
      !capability
      || capability.length > ID_MAX
      || PROTOTYPE_KEYS.has(capability)
    ) {
      fail(`${label} contains an invalid entry`, code);
    }
    if (findSecretCandidates(capability).length) {
      fail(`${label} contains secret-like material`, code);
    }
    if (!seen.has(capability)) {
      seen.add(capability);
      capabilities.push(capability);
    }
  }
  return capabilities;
}

function cleanRuntimeOptions(value, label, { objects = false } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail(`${label} must be an array`, "RUNTIME_CATALOG_INVALID");
  const options = [];
  const seen = new Set();
  for (const raw of value) {
    if (objects) assertPlainRecord(raw, `${label} entry`, "RUNTIME_CATALOG_INVALID");
    const source = objects ? raw.id : raw;
    const option = cleanText(source, `${label} entry`, OPTION_MAX, { code: "RUNTIME_CATALOG_INVALID" });
    if (!option || seen.has(option)) continue;
    seen.add(option);
    options.push(option);
  }
  return options;
}

function cleanTimestamp(value, label, code = "MEMBER_STORE_INVALID") {
  const timestamp = cleanText(value, label, 64, { code, required: true });
  if (!Number.isFinite(Date.parse(timestamp))) fail(`${label} is invalid`, code);
  return timestamp;
}

function nextTimestamp(previous = null) {
  const previousMillis = Date.parse(previous ?? "");
  const millis = Number.isFinite(previousMillis)
    ? Math.max(Date.now(), previousMillis + 1)
    : Date.now();
  return new Date(millis).toISOString();
}

function normalizeRuntimeCatalog(rawCatalog) {
  if (rawCatalog && typeof rawCatalog.then === "function") {
    fail("runtime catalog injection must be synchronous", "RUNTIME_CATALOG_INVALID");
  }
  const entries = Array.isArray(rawCatalog)
    ? rawCatalog
    : rawCatalog && typeof rawCatalog === "object" && Array.isArray(rawCatalog.profiles)
    ? rawCatalog.profiles
    : null;
  if (!entries) fail("runtime catalog must be an array or a profiles object", "RUNTIME_CATALOG_INVALID");
  if (entries.length > MEMBER_MAX) fail(`runtime catalog exceeds ${MEMBER_MAX} profiles`, "RUNTIME_CATALOG_INVALID");

  const profiles = [];
  const byId = new Map();
  for (const raw of entries) {
    assertPlainRecord(raw, "runtime profile", "RUNTIME_CATALOG_INVALID");
    const id = cleanIdentifier(raw.id, "runtime profile id", "RUNTIME_CATALOG_INVALID");
    if (byId.has(id)) fail(`runtime catalog contains duplicate profile: ${id}`, "RUNTIME_CATALOG_INVALID");
    const label = raw.label == null
      ? id
      : cleanText(raw.label, `runtime profile ${id} label`, LABEL_MAX, { code: "RUNTIME_CATALOG_INVALID", required: true });
    const shortLabel = raw.shortLabel == null
      ? label
      : cleanText(raw.shortLabel, `runtime profile ${id} short label`, SHORT_LABEL_MAX, { code: "RUNTIME_CATALOG_INVALID", required: true });
    const enabled = raw.enabled !== false;
    const teamMemberEligible = enabled && raw.teamMemberEligible === true;
    const profile = {
      id,
      label,
      shortLabel,
      role: raw.role == null ? "" : cleanText(raw.role, `runtime profile ${id} role`, ROLE_MAX, { code: "RUNTIME_CATALOG_INVALID" }),
      description: raw.description == null ? "" : cleanText(raw.description, `runtime profile ${id} description`, DESCRIPTION_MAX, { code: "RUNTIME_CATALOG_INVALID" }),
      systemPrompt: raw.systemPrompt == null ? "" : cleanText(raw.systemPrompt, `runtime profile ${id} system prompt`, SYSTEM_PROMPT_MAX, { code: "RUNTIME_CATALOG_INVALID" }),
      capabilities: cleanCapabilities(raw.capabilities ?? [], `runtime profile ${id} capabilities`, { code: "RUNTIME_CATALOG_INVALID" }),
      defaultModel: raw.defaultModel == null && raw.model == null
        ? null
        : cleanText(raw.defaultModel ?? raw.model, `runtime profile ${id} default model`, OPTION_MAX, { code: "RUNTIME_CATALOG_INVALID", nullable: true }),
      defaultEffort: raw.defaultEffort == null && raw.effort == null
        ? null
        : cleanText(raw.defaultEffort ?? raw.effort, `runtime profile ${id} default effort`, OPTION_MAX, { code: "RUNTIME_CATALOG_INVALID", nullable: true }),
      modelOptions: cleanRuntimeOptions(raw.modelOptions ?? [], `runtime profile ${id} model options`, { objects: true }),
      effortLevels: cleanRuntimeOptions(raw.effortLevels ?? [], `runtime profile ${id} effort levels`),
      provider: raw.provider == null ? "" : cleanText(raw.provider, `runtime profile ${id} provider`, OPTION_MAX, { code: "RUNTIME_CATALOG_INVALID" }),
      adapter: raw.adapter == null ? "" : cleanText(raw.adapter, `runtime profile ${id} adapter`, OPTION_MAX, { code: "RUNTIME_CATALOG_INVALID" }),
      adapterLabel: raw.adapterLabel == null ? "" : cleanText(raw.adapterLabel, `runtime profile ${id} adapter label`, OPTION_MAX, { code: "RUNTIME_CATALOG_INVALID" }),
      templateId: raw.templateId == null ? "" : cleanText(raw.templateId, `runtime profile ${id} template id`, OPTION_MAX, { code: "RUNTIME_CATALOG_INVALID" }),
      transport: raw.transport == null ? "" : cleanText(raw.transport, `runtime profile ${id} transport`, OPTION_MAX, { code: "RUNTIME_CATALOG_INVALID" }),
      providerId: raw.providerId == null ? null : cleanIdentifier(raw.providerId, `runtime profile ${id} provider id`, "RUNTIME_CATALOG_INVALID"),
      providerType: raw.providerType == null ? "" : cleanText(raw.providerType, `runtime profile ${id} provider type`, OPTION_MAX, { code: "RUNTIME_CATALOG_INVALID" }),
      providerApp: raw.providerApp == null ? null : cleanText(raw.providerApp, `runtime profile ${id} provider app`, OPTION_MAX, { code: "RUNTIME_CATALOG_INVALID" }),
      providerBindingMode: raw.providerBindingMode == null ? "" : cleanText(raw.providerBindingMode, `runtime profile ${id} provider binding mode`, OPTION_MAX, { code: "RUNTIME_CATALOG_INVALID" }),
      // Pre-seat catalogs did not carry this flag. Treat only an explicit
      // false as custom so existing model profiles migrate as built-ins.
      builtin: raw.builtin !== false,
      enabled,
      teamMemberEligible,
      coordinatorCapable: raw.coordinatorCapable === true || raw.coordinatorEligible === true,
      coordinatorAllowed: raw.coordinatorAllowed !== false,
      coordinatorEligible: teamMemberEligible && raw.coordinatorEligible === true,
      eligibilityReason: teamMemberEligible
        ? null
        : raw.eligibilityReason == null
        ? enabled ? "runtime-profile-ineligible" : "profile-disabled"
        : cleanText(raw.eligibilityReason, `runtime profile ${id} eligibility reason`, OPTION_MAX, { code: "RUNTIME_CATALOG_INVALID" }),
    };
    profiles.push(profile);
    byId.set(id, profile);
  }
  return { profiles, byId };
}

function assertCapabilitySubset(capabilities, runtimeProfile, memberId = "member") {
  const available = new Set(runtimeProfile.capabilities);
  const unsupported = capabilities.filter((capability) => !available.has(capability));
  if (unsupported.length) {
    fail(
      `${memberId} capabilities are not provided by runtime profile ${runtimeProfile.id}: ${unsupported.join(", ")}`,
      "RUNTIME_CAPABILITY_CONFLICT",
      { memberId, runtimeProfileId: runtimeProfile.id, unsupportedCapabilities: unsupported },
    );
  }
}

function runtimeDefaultIssues(member, runtimeProfile) {
  const issues = [];
  const model = member.defaultModel == null ? "" : String(member.defaultModel).trim();
  if (model) {
    const allowedModels = new Set(runtimeProfile.modelOptions);
    if (runtimeProfile.defaultModel) allowedModels.add(runtimeProfile.defaultModel);
    if (!allowedModels.has(model)) issues.push(`unsupported default model: ${model}`);
  }
  const effort = member.defaultEffort == null ? "" : String(member.defaultEffort).trim();
  if (effort) {
    const allowedEfforts = new Set(runtimeProfile.effortLevels);
    if (runtimeProfile.defaultEffort) allowedEfforts.add(runtimeProfile.defaultEffort);
    if (!allowedEfforts.has(effort)) issues.push(`unsupported default effort: ${effort}`);
  }
  return issues;
}

function assertRuntimeDefaults(member, runtimeProfile, memberId = "member") {
  const issues = runtimeDefaultIssues(member, runtimeProfile);
  if (!issues.length) return;
  const modelIssue = issues.find((issue) => issue.startsWith("unsupported default model:"));
  const code = modelIssue ? "RUNTIME_MODEL_CONFLICT" : "RUNTIME_EFFORT_CONFLICT";
  fail(
    `${memberId} defaults are not supported by runtime profile ${runtimeProfile.id}: ${issues.join("; ")}`,
    code,
    { memberId, runtimeProfileId: runtimeProfile.id, issues },
  );
}

function runtimeStatus(member, runtimeById) {
  const runtime = runtimeById.get(member.runtimeProfileId);
  if (!runtime) {
    return {
      provider: null,
      adapter: null,
      enabled: false,
      teamMemberEligible: false,
      coordinatorEligible: false,
      coordinatorCapable: false,
      mainBrainAllowed: member.mainBrainAllowed !== false,
      coordinatorEligibilityReason: "runtime-profile-missing",
      eligibilityReason: "runtime-profile-missing",
    };
  }
  const unsupported = member.capabilities.filter((capability) => !runtime.capabilities.includes(capability));
  const teamMemberEligible = runtime.teamMemberEligible === true && unsupported.length === 0;
  const mainBrainAllowed = member.mainBrainAllowed !== false;
  const coordinatorEligible = teamMemberEligible && runtime.coordinatorEligible === true && mainBrainAllowed;
  return {
    provider: runtime.provider || null,
    adapter: runtime.adapter || null,
    adapterLabel: runtime.adapterLabel || runtime.adapter || null,
    templateId: runtime.templateId || runtime.adapter || null,
    transport: runtime.transport || null,
    providerId: runtime.providerId || null,
    providerType: runtime.providerType || null,
    providerApp: runtime.providerApp || null,
    providerBindingMode: runtime.providerBindingMode || null,
    enabled: runtime.enabled === true,
    teamMemberEligible,
    coordinatorCapable: runtime.coordinatorCapable === true,
    mainBrainAllowed,
    coordinatorEligible,
    coordinatorEligibilityReason: coordinatorEligible
      ? null
      : !mainBrainAllowed
      ? "member-main-brain-disabled"
      : runtime.coordinatorCapable !== true
      ? "adapter-not-coordinator-capable"
      : runtime.coordinatorAllowed === false
      ? "seat-main-brain-disabled"
      : !teamMemberEligible
      ? runtime.eligibilityReason || "runtime-profile-ineligible"
      : "runtime-profile-ineligible",
    eligibilityReason: teamMemberEligible
      ? null
      : runtime.teamMemberEligible !== true
      ? runtime.eligibilityReason || "runtime-profile-ineligible"
      : "runtime-capability-conflict",
  };
}

function metadataFromRuntime(runtime) {
  return {
    label: runtime.label,
    shortLabel: runtime.shortLabel,
    role: runtime.role,
    description: runtime.description,
    systemPrompt: runtime.systemPrompt,
    capabilities: [...runtime.capabilities],
    defaultModel: runtime.defaultModel,
    defaultEffort: runtime.defaultEffort,
  };
}

function cloneMember(member) {
  return { ...member, capabilities: [...member.capabilities] };
}

function normalizeReferenceResult(result) {
  if (result === undefined) {
    fail("member reference lookup returned no decision", "MEMBER_REFERENCE_CHECK_FAILED");
  }
  if (result === null || result === false) return [];
  if (result === true) return ["unknown-team"];
  if (typeof result === "string") return result.trim() ? [result.trim()] : [];
  if (Array.isArray(result)) return result.filter(Boolean).map(String);
  if (typeof result === "object") {
    const references = result.references ?? result.teamIds ?? result.teams;
    if (Array.isArray(references)) return references.filter(Boolean).map(String);
    if (result.referenced === true || result.inUse === true) return ["unknown-team"];
    if (result.referenced === false || result.inUse === false) return [];
  }
  fail("member reference check returned an ambiguous result", "MEMBER_REFERENCE_CHECK_FAILED");
}

export class TeamMemberStore {
  constructor(options = {}) {
    assertPlainRecord(options, "TeamMemberStore options");
    const dataRoot = options.dataRoot;
    if (typeof dataRoot !== "string" || !dataRoot.trim()) fail("dataRoot is required", "VALIDATION_FAILED");
    const runtimeCatalog = options.runtimeCatalog ?? options.catalog;
    if (typeof runtimeCatalog !== "function") {
      fail("runtimeCatalog must be injected as a function", "VALIDATION_FAILED");
    }
    this.dataRoot = resolve(dataRoot);
    this.path = join(this.dataRoot, "team-members.json");
    this.runtimeCatalog = runtimeCatalog;
    this.referenceCheck = options.assertNotReferenced
      ?? options.referencesForMember
      ?? options.isReferenced
      ?? options.referenceCheck
      ?? null;
    this.referenceCheckMode = options.assertNotReferenced ? "assert" : "lookup";
    if (this.referenceCheck != null && typeof this.referenceCheck !== "function") {
      fail("member reference check must be a function", "VALIDATION_FAILED");
    }
    this.guardMemberMutation = options.guardMemberMutation ?? null;
    if (this.guardMemberMutation != null && typeof this.guardMemberMutation !== "function") {
      fail("member mutation guard must be a function", "VALIDATION_FAILED");
    }
    this.beginCatalogTransition = options.beginCatalogTransition ?? null;
    if (this.beginCatalogTransition != null && typeof this.beginCatalogTransition !== "function") {
      fail("catalog transition guard must be a function", "VALIDATION_FAILED");
    }
    this.secureFile = options.secureFile ?? restrictPrivateFile;
    if (typeof this.secureFile !== "function") fail("secureFile must be a function", "VALIDATION_FAILED");
    this.overrides = new Map();
    this.custom = new Map();
  }

  #runtime(catalog = undefined) {
    return normalizeRuntimeCatalog(catalog === undefined ? this.runtimeCatalog() : catalog);
  }

  #validatePersistedOverride(raw) {
    assertAllowedKeys(raw, PERSISTED_KEYS, "persisted builtin member", "MEMBER_STORE_INVALID");
    if (raw.builtin !== true) fail("persisted builtin member has an invalid builtin flag", "MEMBER_STORE_INVALID");
    const id = cleanIdentifier(raw.id, "persisted builtin member id", "MEMBER_STORE_INVALID");
    const runtimeProfileId = cleanIdentifier(raw.runtimeProfileId, "persisted builtin runtime profile id", "MEMBER_STORE_INVALID");
    const record = {
      id,
      runtimeProfileId,
      builtin: true,
      createdAt: cleanTimestamp(raw.createdAt, "persisted builtin createdAt"),
      updatedAt: cleanTimestamp(raw.updatedAt, "persisted builtin updatedAt"),
    };
    if (Object.hasOwn(raw, "mainBrainAllowed")) {
      record.mainBrainAllowed = cleanBoolean(raw.mainBrainAllowed, "persisted builtin mainBrainAllowed", { code: "MEMBER_STORE_INVALID" });
    }
    for (const key of METADATA_KEYS) {
      if (!Object.hasOwn(raw, key)) continue;
      if (key === "capabilities") {
        record.capabilities = cleanCapabilities(raw.capabilities, "persisted builtin capabilities", { code: "MEMBER_STORE_INVALID" });
      } else if (key === "label") {
        record.label = cleanText(raw.label, "persisted builtin label", LABEL_MAX, { code: "MEMBER_STORE_INVALID", required: true });
      } else if (key === "shortLabel") {
        record.shortLabel = cleanText(raw.shortLabel, "persisted builtin short label", SHORT_LABEL_MAX, { code: "MEMBER_STORE_INVALID" });
      } else if (key === "role") {
        record.role = cleanText(raw.role, "persisted builtin role", ROLE_MAX, { code: "MEMBER_STORE_INVALID" });
      } else if (key === "description") {
        record.description = cleanText(raw.description, "persisted builtin description", DESCRIPTION_MAX, { code: "MEMBER_STORE_INVALID" });
      } else if (key === "systemPrompt") {
        record.systemPrompt = cleanText(raw.systemPrompt, "persisted builtin system prompt", SYSTEM_PROMPT_MAX, { code: "MEMBER_STORE_INVALID" });
      } else {
        record[key] = cleanText(raw[key], `persisted builtin ${key}`, OPTION_MAX, { code: "MEMBER_STORE_INVALID", nullable: true });
      }
    }
    return record;
  }

  #validatePersistedCustom(raw) {
    assertAllowedKeys(raw, PERSISTED_KEYS, "persisted custom member", "MEMBER_STORE_INVALID");
    if (raw.builtin !== false) fail("persisted custom member has an invalid builtin flag", "MEMBER_STORE_INVALID");
    const id = cleanIdentifier(raw.id, "persisted custom member id", "MEMBER_STORE_INVALID");
    if (!/^member-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      fail("persisted custom member id was not server-generated", "MEMBER_STORE_INVALID");
    }
    return {
      id,
      label: cleanText(raw.label, "persisted custom label", LABEL_MAX, { code: "MEMBER_STORE_INVALID", required: true }),
      shortLabel: cleanText(raw.shortLabel, "persisted custom short label", SHORT_LABEL_MAX, { code: "MEMBER_STORE_INVALID" }),
      role: cleanText(raw.role, "persisted custom role", ROLE_MAX, { code: "MEMBER_STORE_INVALID" }),
      description: cleanText(raw.description, "persisted custom description", DESCRIPTION_MAX, { code: "MEMBER_STORE_INVALID" }),
      systemPrompt: cleanText(raw.systemPrompt, "persisted custom system prompt", SYSTEM_PROMPT_MAX, { code: "MEMBER_STORE_INVALID" }),
      capabilities: cleanCapabilities(raw.capabilities, "persisted custom capabilities", { code: "MEMBER_STORE_INVALID" }),
      runtimeProfileId: cleanIdentifier(raw.runtimeProfileId, "persisted custom runtime profile id", "MEMBER_STORE_INVALID"),
      defaultModel: cleanText(raw.defaultModel, "persisted custom default model", OPTION_MAX, { code: "MEMBER_STORE_INVALID", nullable: true }),
      defaultEffort: cleanText(raw.defaultEffort, "persisted custom default effort", OPTION_MAX, { code: "MEMBER_STORE_INVALID", nullable: true }),
      mainBrainAllowed: Object.hasOwn(raw, "mainBrainAllowed")
        ? cleanBoolean(raw.mainBrainAllowed, "persisted custom mainBrainAllowed", { code: "MEMBER_STORE_INVALID" })
        : true,
      builtin: false,
      createdAt: cleanTimestamp(raw.createdAt, "persisted custom createdAt"),
      updatedAt: cleanTimestamp(raw.updatedAt, "persisted custom updatedAt"),
    };
  }

  async #readState() {
    let text;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return { overrides: new Map(), custom: new Map() };
      throw error;
    }
    if (Buffer.byteLength(text, "utf8") > STORE_MAX_BYTES) {
      fail(`team member store exceeds ${STORE_MAX_BYTES} bytes`, "MEMBER_STORE_INVALID");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      fail("team member store is not valid JSON", "MEMBER_STORE_INVALID", { cause: error });
    }
    assertAllowedKeys(parsed, new Set(["version", "members"]), "team member store", "MEMBER_STORE_INVALID");
    if (parsed.version !== STORE_VERSION) fail(`unsupported team member store version: ${parsed.version}`, "MEMBER_STORE_INVALID");
    if (!Array.isArray(parsed.members)) fail("team member store members must be an array", "MEMBER_STORE_INVALID");
    if (parsed.members.length > MEMBER_MAX) fail(`team member store exceeds ${MEMBER_MAX} entries`, "MEMBER_STORE_INVALID");

    const overrides = new Map();
    const custom = new Map();
    for (const raw of parsed.members) {
      assertPlainRecord(raw, "persisted member", "MEMBER_STORE_INVALID");
      const member = raw.builtin === true
        ? this.#validatePersistedOverride(raw)
        : this.#validatePersistedCustom(raw);
      if (overrides.has(member.id) || custom.has(member.id)) {
        fail(`team member store contains duplicate id: ${member.id}`, "MEMBER_STORE_INVALID");
      }
      (member.builtin ? overrides : custom).set(member.id, member);
    }
    return { overrides, custom };
  }

  async #refresh() {
    const state = await this.#readState();
    this.overrides = state.overrides;
    this.custom = state.custom;
  }

  async #writeAtomic(overrides, custom) {
    await mkdir(this.dataRoot, { recursive: true, mode: 0o700 });
    const temp = join(dirname(this.path), `.${basename(this.path)}.${process.pid}.${randomUUID()}.tmp`);
    const content = `${JSON.stringify({
      version: STORE_VERSION,
      members: [...overrides.values(), ...custom.values()],
    }, null, 2)}\n`;
    let renamed = false;
    try {
      const emptyHandle = await open(temp, "wx", 0o600);
      try {
        await emptyHandle.sync();
      } finally {
        await emptyHandle.close();
      }
      await this.secureFile(temp);
      const contentHandle = await open(temp, "r+");
      try {
        await contentHandle.writeFile(content, { encoding: "utf8" });
        await contentHandle.sync();
      } finally {
        await contentHandle.close();
      }
      await rename(temp, this.path);
      renamed = true;
      if (process.platform !== "win32") {
        const parent = await open(dirname(this.path), "r");
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      }
    } finally {
      if (!renamed) await rm(temp, { force: true });
    }
  }

  async #commit(overrides, custom) {
    if (overrides.size + custom.size > MEMBER_MAX) fail(`team member store exceeds ${MEMBER_MAX} entries`, "VALIDATION_FAILED");
    await this.#writeAtomic(overrides, custom);
    this.overrides = overrides;
    this.custom = custom;
  }

  async #commitWithCatalogTransition(overrides, custom, memberId, { requireUnreferenced = false } = {}) {
    const candidate = this.catalogForRuntime(undefined, { overrides, custom });
    if (!this.beginCatalogTransition) {
      return this.#withReferenceGuard(memberId, () => this.#commit(overrides, custom));
    }
    const guard = await this.beginCatalogTransition(candidate, {
      unreferencedMemberId: requireUnreferenced ? memberId : null,
    });
    if (requireUnreferenced && guard?.referenceGuardedMemberId !== memberId) {
      await guard?.release?.({ committed: false });
      fail("catalog transition did not provide an authoritative member reference guard", "MEMBER_REFERENCE_CHECK_REQUIRED", {
        memberId,
      });
    }
    let committed = false;
    try {
      await this.#commit(overrides, custom);
      committed = true;
    } finally {
      await guard?.release?.({ committed });
    }
  }

  load() {
    return serializeMutation(this.path, async () => {
      await this.#refresh();
      return this;
    });
  }

  init() {
    return this.load();
  }

  catalogForRuntime(catalog = undefined, state = {}) {
    const { profiles, byId } = this.#runtime(catalog);
    const overrides = state.overrides ?? this.overrides;
    const customState = state.custom ?? this.custom;
    const members = [];
    const seen = new Set();

    for (const runtime of profiles) {
      if (!runtime.builtin) continue;
      const override = overrides.get(runtime.id);
      const metadata = metadataFromRuntime(runtime);
      const boundRuntime = byId.get(override?.runtimeProfileId ?? runtime.id) ?? runtime;
      metadata.defaultModel = boundRuntime.defaultModel;
      metadata.defaultEffort = boundRuntime.defaultEffort;
      if (override) {
        for (const key of METADATA_KEYS) {
          if (Object.hasOwn(override, key)) metadata[key] = key === "capabilities" ? [...override[key]] : override[key];
        }
      }
      const member = {
        id: runtime.id,
        ...metadata,
        runtimeProfileId: override?.runtimeProfileId ?? runtime.id,
        mainBrainAllowed: override?.mainBrainAllowed ?? true,
        builtin: true,
        createdAt: override?.createdAt ?? null,
        updatedAt: override?.updatedAt ?? null,
      };
      members.push({ ...member, ...runtimeStatus(member, byId) });
      seen.add(runtime.id);
    }

    for (const override of overrides.values()) {
      if (seen.has(override.id)) continue;
      const metadata = {
        label: override.label ?? override.id,
        shortLabel: override.shortLabel ?? override.label ?? override.id,
        role: override.role ?? "",
        description: override.description ?? "",
        systemPrompt: override.systemPrompt ?? "",
        capabilities: [...(override.capabilities ?? [])],
        defaultModel: override.defaultModel ?? null,
        defaultEffort: override.defaultEffort ?? null,
      };
      const member = { ...override, ...metadata };
      members.push({ ...member, ...runtimeStatus(member, byId) });
      seen.add(override.id);
    }

    const custom = [...customState.values()].sort((left, right) => (
      left.label.localeCompare(right.label) || left.id.localeCompare(right.id)
    ));
    for (const stored of custom) {
      if (seen.has(stored.id)) fail(`runtime catalog collides with custom member id: ${stored.id}`, "RUNTIME_CATALOG_INVALID");
      const member = cloneMember(stored);
      members.push({ ...member, ...runtimeStatus(member, byId) });
      seen.add(stored.id);
    }
    return members.map(cloneMember);
  }

  list() {
    return this.catalogForRuntime();
  }

  get(id) {
    const memberId = cleanIdentifier(id, "member id");
    const member = this.list().find((item) => item.id === memberId);
    if (!member) fail(`team member not found: ${memberId}`, "SOURCE_NOT_FOUND");
    return member;
  }

  create(input = {}) {
    return serializeMutation(this.path, async () => {
      await this.#refresh();
      assertAllowedKeys(input, CUSTOM_INPUT_KEYS, "custom member");
      const { byId } = this.#runtime();
      const runtimeProfileId = cleanIdentifier(input.runtimeProfileId, "runtimeProfileId");
      const runtime = byId.get(runtimeProfileId);
      if (!runtime) fail(`runtime profile not found: ${runtimeProfileId}`, "RUNTIME_PROFILE_NOT_FOUND");
      if (runtime.teamMemberEligible !== true) {
        fail(`runtime profile is not team-member eligible: ${runtimeProfileId}`, "RUNTIME_PROFILE_INELIGIBLE", {
          runtimeProfileId,
          eligibilityReason: runtime.eligibilityReason,
        });
      }
      const capabilities = input.capabilities === undefined
        ? [...runtime.capabilities]
        : cleanCapabilities(input.capabilities);
      assertCapabilitySubset(capabilities, runtime);
      const now = nextTimestamp();
      let id;
      do id = `member-${randomUUID()}`;
      while (this.custom.has(id) || byId.has(id));
      const member = {
        id,
        label: input.label === undefined
          ? runtime.label
          : cleanText(input.label, "member label", LABEL_MAX, { required: true }),
        shortLabel: input.shortLabel === undefined
          ? runtime.shortLabel
          : cleanText(input.shortLabel, "member short label", SHORT_LABEL_MAX),
        role: input.role === undefined
          ? runtime.role
          : cleanText(input.role, "member role", ROLE_MAX),
        description: input.description === undefined
          ? runtime.description
          : cleanText(input.description, "member description", DESCRIPTION_MAX),
        systemPrompt: input.systemPrompt === undefined
          ? runtime.systemPrompt
          : cleanText(input.systemPrompt, "member system prompt", SYSTEM_PROMPT_MAX),
        capabilities,
        runtimeProfileId,
        defaultModel: input.defaultModel === undefined
          ? runtime.defaultModel
          : cleanText(input.defaultModel, "member default model", OPTION_MAX, { nullable: true }),
        defaultEffort: input.defaultEffort === undefined
          ? runtime.defaultEffort
          : cleanText(input.defaultEffort, "member default effort", OPTION_MAX, { nullable: true }),
        mainBrainAllowed: input.mainBrainAllowed === undefined
          ? true
          : cleanBoolean(input.mainBrainAllowed, "mainBrainAllowed"),
        builtin: false,
        createdAt: now,
        updatedAt: now,
      };
      assertRuntimeDefaults(member, runtime, id);
      const custom = new Map(this.custom);
      custom.set(id, member);
      await this.#commit(new Map(this.overrides), custom);
      return this.get(id);
    });
  }

  update(id, input = {}) {
    return serializeMutation(this.path, async () => {
      await this.#refresh();
      const memberId = cleanIdentifier(id, "member id");
      assertPlainRecord(input, "member update");
      const { byId } = this.#runtime();
      const existingCustom = this.custom.get(memberId);
      if (existingCustom) {
        assertAllowedKeys(input, CUSTOM_INPUT_KEYS, "custom member update");
        const runtimeProfileId = Object.hasOwn(input, "runtimeProfileId")
          ? cleanIdentifier(input.runtimeProfileId, "runtimeProfileId")
          : existingCustom.runtimeProfileId;
        const bindingChanged = runtimeProfileId !== existingCustom.runtimeProfileId;
        const runtime = byId.get(runtimeProfileId);
        if (!runtime) fail(`runtime profile not found: ${runtimeProfileId}`, "RUNTIME_PROFILE_NOT_FOUND");
        if (runtime.teamMemberEligible !== true) {
          fail(`runtime profile is not team-member eligible: ${runtimeProfileId}`, "RUNTIME_PROFILE_INELIGIBLE", {
            runtimeProfileId,
            eligibilityReason: runtime.eligibilityReason,
          });
        }
        const member = cloneMember(existingCustom);
        member.runtimeProfileId = runtimeProfileId;
        if (bindingChanged && !Object.hasOwn(input, "defaultModel")) member.defaultModel = runtime.defaultModel;
        if (bindingChanged && !Object.hasOwn(input, "defaultEffort")) member.defaultEffort = runtime.defaultEffort;
        if (Object.hasOwn(input, "label")) member.label = cleanText(input.label, "member label", LABEL_MAX, { required: true });
        if (Object.hasOwn(input, "shortLabel")) member.shortLabel = cleanText(input.shortLabel, "member short label", SHORT_LABEL_MAX);
        if (Object.hasOwn(input, "role")) member.role = cleanText(input.role, "member role", ROLE_MAX);
        if (Object.hasOwn(input, "description")) member.description = cleanText(input.description, "member description", DESCRIPTION_MAX);
        if (Object.hasOwn(input, "systemPrompt")) member.systemPrompt = cleanText(input.systemPrompt, "member system prompt", SYSTEM_PROMPT_MAX);
        if (Object.hasOwn(input, "capabilities")) member.capabilities = cleanCapabilities(input.capabilities);
        if (Object.hasOwn(input, "defaultModel")) member.defaultModel = cleanText(input.defaultModel, "member default model", OPTION_MAX, { nullable: true });
        if (Object.hasOwn(input, "defaultEffort")) member.defaultEffort = cleanText(input.defaultEffort, "member default effort", OPTION_MAX, { nullable: true });
        if (Object.hasOwn(input, "mainBrainAllowed")) member.mainBrainAllowed = cleanBoolean(input.mainBrainAllowed, "mainBrainAllowed");
        assertCapabilitySubset(member.capabilities, runtime, memberId);
        assertRuntimeDefaults(member, runtime, memberId);
        member.updatedAt = nextTimestamp(existingCustom.updatedAt);
        const custom = new Map(this.custom);
        custom.set(memberId, member);
        const affectsCatalog = bindingChanged || Object.hasOwn(input, "capabilities") || Object.hasOwn(input, "mainBrainAllowed");
        if (affectsCatalog) {
          await this.#commitWithCatalogTransition(new Map(this.overrides), custom, memberId, {
            requireUnreferenced: bindingChanged,
          });
        }
        else await this.#commit(new Map(this.overrides), custom);
        return this.get(memberId);
      }

      const existingOverride = this.overrides.get(memberId);
      const defaultRuntime = byId.get(memberId);
      if (!defaultRuntime && !existingOverride) fail(`team member not found: ${memberId}`, "SOURCE_NOT_FOUND");
      const allowed = new Set([...METADATA_KEYS, "runtimeProfileId", "mainBrainAllowed"]);
      assertAllowedKeys(input, allowed, "builtin member update");
      if (!defaultRuntime) fail(`runtime profile not found: ${memberId}`, "RUNTIME_PROFILE_NOT_FOUND");
      const runtimeProfileId = Object.hasOwn(input, "runtimeProfileId")
        ? input.runtimeProfileId === null ? memberId : cleanIdentifier(input.runtimeProfileId, "runtimeProfileId")
        : existingOverride?.runtimeProfileId ?? memberId;
      const bindingChanged = runtimeProfileId !== (existingOverride?.runtimeProfileId ?? memberId);
      const runtime = byId.get(runtimeProfileId);
      if (!runtime) fail(`runtime profile not found: ${runtimeProfileId}`, "RUNTIME_PROFILE_NOT_FOUND");
      if (runtime.teamMemberEligible !== true) {
        fail(`runtime profile is not team-member eligible: ${runtimeProfileId}`, "RUNTIME_PROFILE_INELIGIBLE", {
          runtimeProfileId,
          eligibilityReason: runtime.eligibilityReason,
        });
      }
      const now = nextTimestamp(existingOverride?.updatedAt);
      const override = existingOverride
        ? { ...existingOverride }
        : { id: memberId, runtimeProfileId: memberId, builtin: true, createdAt: now, updatedAt: now };
      if (override.capabilities) override.capabilities = [...override.capabilities];
      override.runtimeProfileId = runtimeProfileId;
      if (bindingChanged && !Object.hasOwn(input, "defaultModel")) delete override.defaultModel;
      if (bindingChanged && !Object.hasOwn(input, "defaultEffort")) delete override.defaultEffort;
      if (Object.hasOwn(input, "mainBrainAllowed")) {
        if (input.mainBrainAllowed === null) delete override.mainBrainAllowed;
        else override.mainBrainAllowed = cleanBoolean(input.mainBrainAllowed, "mainBrainAllowed");
      }
      for (const key of METADATA_KEYS) {
        if (!Object.hasOwn(input, key)) continue;
        if (input[key] === null) {
          delete override[key];
          continue;
        }
        if (key === "capabilities") override.capabilities = cleanCapabilities(input.capabilities);
        else if (key === "label") override.label = cleanText(input.label, "member label", LABEL_MAX, { required: true });
        else if (key === "shortLabel") override.shortLabel = cleanText(input.shortLabel, "member short label", SHORT_LABEL_MAX);
        else if (key === "role") override.role = cleanText(input.role, "member role", ROLE_MAX);
        else if (key === "description") override.description = cleanText(input.description, "member description", DESCRIPTION_MAX);
        else if (key === "systemPrompt") override.systemPrompt = cleanText(input.systemPrompt, "member system prompt", SYSTEM_PROMPT_MAX);
        else override[key] = cleanText(input[key], `member ${key}`, OPTION_MAX, { nullable: true });
      }
      assertCapabilitySubset(override.capabilities ?? defaultRuntime.capabilities, runtime, memberId);
      assertRuntimeDefaults({
        defaultModel: Object.hasOwn(override, "defaultModel") ? override.defaultModel : runtime.defaultModel,
        defaultEffort: Object.hasOwn(override, "defaultEffort") ? override.defaultEffort : runtime.defaultEffort,
      }, runtime, memberId);
      override.updatedAt = now;
      const overrides = new Map(this.overrides);
      const hasOverride = METADATA_KEYS.some((key) => Object.hasOwn(override, key))
        || Object.hasOwn(override, "mainBrainAllowed")
        || override.runtimeProfileId !== memberId;
      if (hasOverride) overrides.set(memberId, override);
      else overrides.delete(memberId);
      const affectsCatalog = bindingChanged
        || Object.hasOwn(input, "capabilities")
        || Object.hasOwn(input, "mainBrainAllowed");
      if (affectsCatalog) {
        await this.#commitWithCatalogTransition(overrides, new Map(this.custom), memberId, {
          requireUnreferenced: bindingChanged,
        });
      }
      else await this.#commit(overrides, new Map(this.custom));
      return this.get(memberId);
    });
  }

  async assertNotReferenced(id, referenceCheck = undefined) {
    const memberId = cleanIdentifier(id, "member id");
    let checker = this.referenceCheck;
    let checkMode = this.referenceCheckMode;
    if (typeof referenceCheck === "function") {
      checker = referenceCheck;
      checkMode = "assert";
    } else if (referenceCheck && typeof referenceCheck === "object") {
      checker = referenceCheck.assertNotReferenced ?? referenceCheck.referencesForMember ?? referenceCheck.isReferenced;
      checkMode = referenceCheck.assertNotReferenced ? "assert" : "lookup";
    }
    if (typeof checker !== "function" && this.guardMemberMutation && referenceCheck === undefined) {
      await this.guardMemberMutation(memberId, async () => undefined);
      return { valid: true, memberId };
    }
    if (typeof checker !== "function") {
      fail("member deletion requires an authoritative team reference check", "MEMBER_REFERENCE_CHECK_REQUIRED", { memberId });
    }
    let result;
    try {
      result = await checker(memberId);
    } catch (error) {
      if (error?.code === "MEMBER_IN_USE") throw error;
      fail("member reference check failed; deletion was blocked", "MEMBER_REFERENCE_CHECK_FAILED", {
        memberId,
        causeCode: error?.code ?? null,
        cause: error,
      });
    }
    const references = checkMode === "assert" && result === undefined
      ? []
      : normalizeReferenceResult(result);
    if (references.length) {
      fail(`team member is referenced and cannot be deleted or rebound: ${memberId}`, "MEMBER_IN_USE", { memberId, references });
    }
    return { valid: true, memberId };
  }

  async #withReferenceGuard(memberId, mutation, referenceCheck = undefined) {
    if (this.guardMemberMutation && referenceCheck === undefined) {
      return this.guardMemberMutation(memberId, mutation);
    }
    await this.assertNotReferenced(memberId, referenceCheck);
    return mutation();
  }

  remove(id, referenceCheck = undefined) {
    return serializeMutation(this.path, async () => {
      await this.#refresh();
      const memberId = cleanIdentifier(id, "member id");
      if (!this.custom.has(memberId)) {
        const { byId } = this.#runtime();
        if (byId.has(memberId) || this.overrides.has(memberId)) {
          fail("builtin members cannot be deleted", "FROZEN_BLOCK");
        }
        fail(`team member not found: ${memberId}`, "SOURCE_NOT_FOUND");
      }
      const custom = new Map(this.custom);
      custom.delete(memberId);
      return this.#withReferenceGuard(memberId, async () => {
        await this.#commit(new Map(this.overrides), custom);
        return { removed: memberId };
      }, referenceCheck);
    });
  }

  assertRuntimeCompatible(catalog = undefined) {
    const { byId } = this.#runtime(catalog);
    const conflicts = [];
    for (const member of [...this.overrides.values(), ...this.custom.values()]) {
      const runtime = byId.get(member.runtimeProfileId);
      const reasons = [];
      if (!runtime) reasons.push("runtime profile is missing");
      else {
        if (runtime.teamMemberEligible !== true) {
          reasons.push(`runtime profile is ineligible (${runtime.eligibilityReason || "unknown"})`);
        }
        const unsupported = (member.capabilities ?? []).filter((capability) => !runtime.capabilities.includes(capability));
        if (unsupported.length) reasons.push(`unsupported capabilities: ${unsupported.join(", ")}`);
        reasons.push(...runtimeDefaultIssues(member, runtime));
      }
      if (reasons.length) {
        conflicts.push({
          id: member.id,
          runtimeProfileId: member.runtimeProfileId,
          builtin: member.builtin,
          reasons,
        });
      }
    }
    if (!conflicts.length) return { valid: true, conflicts: [] };
    const summary = conflicts
      .map((item) => `${item.id} -> ${item.runtimeProfileId}: ${item.reasons.join("; ")}`)
      .join(" | ");
    fail(`runtime catalog would invalidate saved team members: ${summary}`, "MEMBER_RUNTIME_CONFLICT", { conflicts });
  }
}
