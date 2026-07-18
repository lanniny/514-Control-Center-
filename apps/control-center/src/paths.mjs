import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = dirname(fileURLToPath(import.meta.url));

export const APP_ROOT = resolve(sourceDir, "..");
export const REPO_ROOT = resolve(process.env.CONTROL_CENTER_REPO_ROOT || resolve(APP_ROOT, "..", ".."));
export const DATA_ROOT = resolve(
  process.env.CONTROL_CENTER_DATA_DIR || resolve(REPO_ROOT, ".ai-shared", "control-center"),
);

export function expandPathTemplate(value, env = process.env) {
  const expanded = value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => env[name] || "");
  if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    return resolve(homedir(), expanded.slice(2));
  }
  return isAbsolute(expanded) ? resolve(expanded) : resolve(REPO_ROOT, expanded);
}

export function isWithin(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertWithin(root, candidate, label = "path") {
  if (!isWithin(root, candidate)) {
    const error = new Error(`${label} escapes its allowed root`);
    error.code = "PATH_BOUNDARY";
    throw error;
  }
  return resolve(candidate);
}

export function toPortablePath(value) {
  return value.split(sep).join("/");
}
