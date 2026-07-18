import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { findSecretCandidates } from "./redaction.mjs";
import { childProcessEnv } from "./process-runner.mjs";

const MAX_CONFIG_BYTES = 5 * 1024 * 1024;
const CONTROL_SCHEMA_DEFINITIONS = new Map([
  ["control.models", "modelRegistry"],
  ["control.routing", "routingPolicy"],
  ["control.permissions", "permissionPolicy"],
  ["control.sources", "sourceRegistry"],
]);

function runPythonValidator(kind, content, timeoutMs = 10_000) {
  const programs = {
    yaml: "import sys,yaml; yaml.safe_load(sys.stdin.read())",
    toml: "import sys,tomllib; tomllib.loads(sys.stdin.read())",
    python: "import sys; compile(sys.stdin.read(), '<control-center>', 'exec')",
  };
  const program = programs[kind];
  if (!program) return Promise.resolve({ ok: true, parser: "none" });

  return new Promise((resolve) => {
    const child = spawn("python", ["-c", program], {
      env: childProcessEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, parser: `python-${kind}`, error: "validator timed out" });
    }, timeoutMs);
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16_384) stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => finish({ ok: false, parser: `python-${kind}`, error: error.message }));
    child.once("exit", (code) => {
      finish({
        ok: code === 0,
        parser: `python-${kind}`,
        error: code === 0 ? null : stderr.trim().slice(-4000) || `validator exited ${code}`,
      });
    });
    child.stdin.end(content, "utf8");
  });
}

async function validateControlSchema(source, instance, timeoutMs = 10_000) {
  const definition = CONTROL_SCHEMA_DEFINITIONS.get(source.id);
  if (!definition) return { ok: true, parser: "JSON.parse" };
  const schemaPath = resolve(dirname(source.path), "..", "..", "schemas", "control-center", "contracts.schema.json");
  let schema;
  try {
    schema = JSON.parse(await readFile(schemaPath, "utf8"));
  } catch (error) {
    return { ok: false, parser: "python-jsonschema", error: `cannot load control schema: ${error.message}` };
  }
  const program = [
    "import json,sys,jsonschema",
    "p=json.load(sys.stdin)",
    "root=p['schema']",
    "name=p['definition']",
    "target={'$schema':root.get('$schema'),'$defs':root.get('$defs',{}),**root['$defs'][name]}",
    "errors=sorted(jsonschema.Draft202012Validator(target).iter_errors(p['instance']),key=lambda e:list(e.path))",
    "print(json.dumps([{'path':'/'.join(map(str,e.path)) or '$','message':e.message} for e in errors],ensure_ascii=False))",
    "sys.exit(1 if errors else 0)",
  ].join(";");
  return new Promise((resolveResult) => {
    const child = spawn("python", ["-c", program], { env: childProcessEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, parser: "python-jsonschema", error: "JSON Schema validator timed out" });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { if (stdout.length < 64_000) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 16_384) stderr += chunk.toString("utf8"); });
    child.once("error", (error) => finish({ ok: false, parser: "python-jsonschema", error: error.message }));
    child.once("exit", (code) => {
      let diagnostics = [];
      try { diagnostics = JSON.parse(stdout || "[]"); } catch { diagnostics = []; }
      finish({
        ok: code === 0,
        parser: "python-jsonschema",
        error: code === 0 ? null : diagnostics.map((item) => `${item.path}: ${item.message}`).join("; ") || stderr.trim() || `validator exited ${code}`,
      });
    });
    child.stdin.end(JSON.stringify({ schema, definition, instance }), "utf8");
  });
}

export async function validateContent(source, content) {
  const errors = [];
  const warnings = [];
  if (typeof content !== "string") errors.push("content must be a string");
  if (typeof content === "string" && Buffer.byteLength(content, "utf8") > MAX_CONFIG_BYTES) {
    errors.push(`content exceeds ${MAX_CONFIG_BYTES} bytes`);
  }
  if (typeof content === "string" && content.includes("\0")) errors.push("NUL bytes are not allowed");
  if (errors.length) return { valid: false, errors, warnings, parser: "preflight" };

  let parser = source.kind;
  if (source.kind === "json") {
    try {
      const parsed = JSON.parse(content);
      parser = "JSON.parse";
      const result = await validateControlSchema(source, parsed);
      parser = result.parser;
      if (!result.ok) errors.push(result.error);
    } catch (error) {
      errors.push(error.message);
    }
  } else if (["yaml", "toml", "python"].includes(source.kind)) {
    const result = await runPythonValidator(source.kind, content);
    parser = result.parser;
    if (!result.ok) errors.push(result.error);
  } else if (source.kind === "markdown") {
    const opens = content.match(/<frozen-after-approval(?:\s[^>]*)?>/g)?.length || 0;
    const closes = content.match(/<\/frozen-after-approval>/g)?.length || 0;
    if (opens !== closes) errors.push("unbalanced frozen-after-approval markers");
    if (!content.trim()) warnings.push("document is empty");
    parser = "markdown-guards";
  }

  const secretCandidates = findSecretCandidates(content);
  if (secretCandidates.length) errors.push(...secretCandidates);
  return { valid: errors.length === 0, errors, warnings, parser };
}
