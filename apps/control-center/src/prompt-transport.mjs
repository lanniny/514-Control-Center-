import { createHash } from "node:crypto";
import { extname } from "node:path";
import { resolveCommand } from "./process-runner.mjs";

export const PROMPT_TRANSPORT_SCHEMA = "514cc.promptTransport/v1";
export const PROMPT_TRANSPORTS = Object.freeze(["argv", "stdin", "jsonl", "ssh"]);

const CJK_OR_SYMBOL = /[^\u0000-\u007F]/u;
const DEFAULT_AUDIT_TIMEOUT_MS = 1_000;

function providerError(code, message) {
  return Object.assign(new Error(message), { code, failureClass: "provider_error" });
}

export function digestPrompt(prompt) {
  return createHash("sha256").update(Buffer.from(String(prompt ?? ""), "utf8")).digest("hex");
}

export function inspectPrompt(prompt) {
  const text = String(prompt ?? "");
  return {
    inputDigest: digestPrompt(text),
    byteLength: Buffer.byteLength(text, "utf8"),
    codePointCount: [...text].length,
    hasNonAscii: CJK_OR_SYMBOL.test(text),
  };
}

export function countCodePoints(text, predicate) {
  let count = 0;
  for (const point of String(text ?? "")) {
    if (predicate(point)) count += 1;
  }
  return count;
}

export function detectReplacementCorruption(original, received) {
  const source = String(original ?? "");
  const echo = String(received ?? "");
  if (source === echo) return false;
  if (echo.includes("\uFFFD") && !source.includes("\uFFFD")) return true;
  const sourceCjk = countCodePoints(source, (point) => CJK_OR_SYMBOL.test(point));
  const echoCjk = countCodePoints(echo, (point) => CJK_OR_SYMBOL.test(point));
  const sourceQ = countCodePoints(source, (point) => point === "?");
  const echoQ = countCodePoints(echo, (point) => point === "?");
  return sourceCjk > 0 && echoCjk < sourceCjk && echoQ > sourceQ;
}

export function assertArgvTransportSafe({
  prompt,
  command,
  platform = process.platform,
  resolve = resolveCommand,
} = {}) {
  if (platform !== "win32") return;
  if (!inspectPrompt(prompt).hasNonAscii) return;
  if (!command) return;
  const resolved = resolve(command);
  const path = String(resolved?.resolvedPath || resolved?.command || command || "");
  if (extname(path).toLowerCase() === ".ps1") {
    throw providerError(
      "PROMPT_TRANSPORT_UNSAFE",
      "Windows powershell.exe -File is not a trusted UTF-8 transport for non-ASCII prompts; use a native .exe seat instead of a .ps1 shim",
    );
  }
}

export function sealPromptTransport({
  prompt,
  transport,
  adapterId = null,
  command = null,
  platform = process.platform,
  resolve = resolveCommand,
} = {}) {
  if (typeof prompt !== "string") {
    throw providerError("PROVIDER_ERROR", "prompt must be a UTF-8 string");
  }
  if (prompt.includes("\0")) {
    throw providerError("PROVIDER_ERROR", "prompt contains a NUL byte");
  }
  if (!PROMPT_TRANSPORTS.includes(transport)) {
    throw providerError("PROVIDER_ERROR", `unknown prompt transport: ${transport}`);
  }
  const utf8 = Buffer.from(prompt, "utf8").toString("utf8");
  if (utf8 !== prompt || detectReplacementCorruption(prompt, utf8)) {
    throw providerError("PROMPT_TRANSPORT_CORRUPT", "prompt failed UTF-8 roundtrip before provider spawn");
  }
  if (transport === "argv" || transport === "stdin") {
    assertArgvTransportSafe({ prompt, command, platform, resolve });
  }
  const inspected = inspectPrompt(prompt);
  return Object.freeze({
    schema: PROMPT_TRANSPORT_SCHEMA,
    adapterId,
    transport,
    inputDigest: inspected.inputDigest,
    byteLength: inspected.byteLength,
    codePointCount: inspected.codePointCount,
    hasNonAscii: inspected.hasNonAscii,
  });
}

export function assertEchoMatches(original, received) {
  const echo = String(received ?? "");
  if (detectReplacementCorruption(original, echo) || digestPrompt(original) !== digestPrompt(echo)) {
    throw providerError("PROMPT_TRANSPORT_CORRUPT", "provider echo digest does not match the sealed prompt");
  }
  return inspectPrompt(echo);
}

export async function preparePromptTransport({
  prompt,
  transport,
  adapterId,
  command,
  eventStore,
  runId,
  agentId,
  platform,
  resolve,
  auditTimeoutMs = DEFAULT_AUDIT_TIMEOUT_MS,
} = {}) {
  const record = sealPromptTransport({ prompt, transport, adapterId, command, platform, resolve });
  if (typeof eventStore?.emit === "function") {
    if (!Number.isSafeInteger(auditTimeoutMs) || auditTimeoutMs < 1) {
      throw providerError("PROVIDER_ERROR", "prompt transport audit timeout must be a positive safe integer");
    }
    const persistence = Promise.resolve().then(() => eventStore.emit("prompt.transport", record, {
        runId,
        agentId,
        sensitivity: "internal",
      }));
    const handled = persistence.then(
      () => ({ status: "fulfilled" }),
      (cause) => ({ status: "rejected", cause }),
    );
    let timer;
    const outcome = await Promise.race([
      handled,
      new Promise((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout({ status: "timeout" }), auditTimeoutMs);
      }),
    ]);
    clearTimeout(timer);
    if (outcome.status !== "fulfilled") {
      const cause = outcome.cause ?? Object.assign(
        new Error(`prompt transport audit exceeded ${auditTimeoutMs}ms`),
        { code: "PROMPT_TRANSPORT_AUDIT_TIMEOUT" },
      );
      const error = providerError(
        "PROMPT_TRANSPORT_AUDIT_FAILED",
        "prompt transport audit could not be persisted; provider dispatch was not started",
      );
      error.cause = cause;
      throw error;
    }
  }
  return record;
}

export function isPromptTransportError(error) {
  return [
    "PROMPT_TRANSPORT_CORRUPT",
    "PROMPT_TRANSPORT_UNSAFE",
    "PROMPT_TRANSPORT_AUDIT_FAILED",
    "PROVIDER_ERROR",
  ].includes(error?.code);
}
