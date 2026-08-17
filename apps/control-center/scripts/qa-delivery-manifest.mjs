#!/usr/bin/env node

import { execFile } from "node:child_process";
import { realpath, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultRepoRoot = resolve(appRoot, "..", "..");

export const DEFAULT_FOCUS_PATHS = Object.freeze([
  "apps/control-center/src",
  "apps/control-center/public",
  "apps/control-center/tests",
  "apps/control-center/scripts",
]);

const CODE_EXTENSIONS = new Set([
  ".cjs", ".css", ".html", ".jsx", ".js", ".json", ".mjs", ".py", ".rs", ".ts", ".tsx", ".yaml", ".yml",
]);

function toRepoPath(path) {
  return path.split(sep).join("/");
}

function isInside(repoRoot, path) {
  const rel = relative(repoRoot, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isCodeOrTestPath(repoPath) {
  const normalized = toRepoPath(repoPath);
  if (normalized.includes("/tests/") || normalized.startsWith("apps/control-center/tests/")) return true;
  const dot = normalized.lastIndexOf(".");
  if (dot < 0) return false;
  const extension = normalized.slice(dot).toLowerCase();
  return CODE_EXTENSIONS.has(extension);
}

function pathKey(path) {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

async function listPhysicalFiles(repoRealRoot, current, result = []) {
  let currentRealPath;
  try {
    currentRealPath = await realpath(current);
  } catch (error) {
    if (error?.code === "ENOENT") return result;
    throw error;
  }
  if (!isInside(repoRealRoot, currentRealPath)) {
    throw new Error(`focus path resolves outside repository root: ${current}`);
  }
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return result;
    throw error;
  }
  for (const entry of entries) {
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) {
      await listPhysicalFiles(repoRealRoot, path, result);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      result.push(path);
    }
  }
  return result;
}

async function gitLsFiles(repoRoot, focusPaths) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repoRoot, "ls-files", "-z", "--", ...focusPaths],
    { encoding: "utf8", windowsHide: true },
  );
  return stdout.split("\0").filter(Boolean).map(toRepoPath);
}

async function gitLsUntrackedFiles(repoRoot, focusPaths) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repoRoot, "ls-files", "-z", "--others", "--exclude-standard", "--", ...focusPaths],
    { encoding: "utf8", windowsHide: true },
  );
  return stdout.split("\0").filter(Boolean).map(toRepoPath);
}

function normalizeFocusPaths(repoRoot, focusPaths) {
  return focusPaths.map((path) => {
    const absolute = resolve(repoRoot, path);
    if (!isInside(repoRoot, absolute)) {
      throw new Error(`focus path escapes repository root: ${path}`);
    }
    return toRepoPath(relative(repoRoot, absolute));
  });
}

export async function collectDeliveryManifest({ repoRoot = defaultRepoRoot, focusPaths = DEFAULT_FOCUS_PATHS } = {}) {
  const resolvedRepoRoot = resolve(repoRoot);
  const normalizedFocusPaths = normalizeFocusPaths(resolvedRepoRoot, focusPaths);
  const uniqueFocusPaths = [...new Map(normalizedFocusPaths.map((path) => [pathKey(path), path])).values()];
  const repoRealRoot = await realpath(resolvedRepoRoot);
  const [trackedFiles, untrackedFiles, physicalByRoot] = await Promise.all([
    gitLsFiles(resolvedRepoRoot, uniqueFocusPaths),
    gitLsUntrackedFiles(resolvedRepoRoot, uniqueFocusPaths),
    Promise.all(uniqueFocusPaths.map((path) => listPhysicalFiles(repoRealRoot, resolve(resolvedRepoRoot, path)))),
  ]);
  const physicalFilesOnDisk = [...new Map(physicalByRoot
    .flat()
    .map((path) => toRepoPath(relative(resolvedRepoRoot, path)))
    .map((path) => [pathKey(path), path])).values()].sort();
  const physicalSet = new Set(physicalFilesOnDisk.map(pathKey));
  const physicalFiles = [...new Map([
    ...trackedFiles.filter((path) => physicalSet.has(pathKey(path))),
    ...untrackedFiles,
  ].map((path) => [pathKey(path), path])).values()].sort();
  const deletedTrackedFiles = trackedFiles.filter((path) => !physicalSet.has(pathKey(path))).sort();
  const sortedUntrackedFiles = [...untrackedFiles].sort();
  const untrackedSourceOrTests = sortedUntrackedFiles.filter(isCodeOrTestPath);
  const missingSourceOrTests = deletedTrackedFiles.filter(isCodeOrTestPath);

  return {
    repoRoot: resolvedRepoRoot,
    focusPaths: uniqueFocusPaths,
    trackedFiles: [...trackedFiles].sort(),
    physicalFiles,
    untrackedFiles: sortedUntrackedFiles,
    untrackedSourceOrTests,
    deletedTrackedFiles,
    missingSourceOrTests,
    clean: sortedUntrackedFiles.length === 0 && deletedTrackedFiles.length === 0,
    strictFailure: untrackedSourceOrTests.length > 0 || missingSourceOrTests.length > 0,
  };
}

function formatList(title, entries) {
  if (!entries.length) return `${title}: 0`;
  return [`${title}: ${entries.length}`, ...entries.map((entry) => `  - ${entry}`)].join("\n");
}

export function renderDeliveryReport(manifest, { json = false } = {}) {
  if (json) return `${JSON.stringify(manifest, null, 2)}\n`;
  const lines = [
    "514cc delivery manifest (read-only)",
    `repo: ${manifest.repoRoot}`,
    `focus: ${manifest.focusPaths.join(", ")}`,
    `tracked: ${manifest.trackedFiles.length}; physical: ${manifest.physicalFiles.length}`,
    `status: ${manifest.clean ? "clean" : "drift"}; strict: ${manifest.strictFailure ? "fail" : "pass"}`,
    formatList("untracked source/test", manifest.untrackedSourceOrTests),
    formatList("untracked other focus files", manifest.untrackedFiles.filter((entry) => !manifest.untrackedSourceOrTests.includes(entry))),
    formatList("deleted tracked source/test", manifest.missingSourceOrTests),
    formatList("deleted tracked other focus files", manifest.deletedTrackedFiles.filter((entry) => !manifest.missingSourceOrTests.includes(entry))),
  ];
  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2), {
  repoRoot = defaultRepoRoot,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const strict = argv.includes("--strict");
  const json = argv.includes("--json");
  const unknown = argv.filter((argument) => !["--strict", "--json"].includes(argument));
  if (unknown.length) {
    stderr.write(`Unknown option: ${unknown.join(", ")}\nUsage: node scripts/qa-delivery-manifest.mjs [--strict] [--json]\n`);
    return 2;
  }
  try {
    const manifest = await collectDeliveryManifest({ repoRoot });
    stdout.write(renderDeliveryReport(manifest, { json }));
    return strict && manifest.strictFailure ? 1 : 0;
  } catch (error) {
    stderr.write(`delivery manifest failed: ${error?.message || error}\n`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
