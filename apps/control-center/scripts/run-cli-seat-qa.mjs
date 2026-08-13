#!/usr/bin/env node

import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const qaScript = resolve(import.meta.dirname, "qa-cli-seat-catalog.mjs");

function outputDirectory(argv) {
  let outputDir = resolve(appRoot, ".qa-output", "cli-seat-catalog");
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output-dir") {
      const value = argv[index + 1];
      if (value && !value.startsWith("--")) outputDir = resolve(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--output-dir=")) {
      const value = argument.slice("--output-dir=".length);
      if (value) outputDir = resolve(value);
    }
  }
  return outputDir;
}

async function main() {
  const args = process.argv.slice(2);
  const outputDir = outputDirectory(args);
  await mkdir(outputDir, { recursive: true });

  const stdoutPath = resolve(outputDir, "runner-child.stdout.log");
  const stderrPath = resolve(outputDir, "runner-child.stderr.log");
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  let child;
  try {
    child = spawn(process.execPath, [qaScript, ...args], {
      cwd: appRoot,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
    const outcome = await new Promise((resolveOutcome, rejectOutcome) => {
      child.once("error", rejectOutcome);
      child.once("close", (code, signal) => resolveOutcome({ code, signal }));
    });
    if (outcome.code !== 0) {
      const stderr = readFileSync(stderrPath, "utf8").slice(-64 * 1024);
      writeFileSync(process.stderr.fd, stderr || `CLI seat QA exited with ${outcome.signal || outcome.code}\n`);
      process.exitCode = outcome.code || 1;
      return;
    }
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  const reportPath = resolve(outputDir, "result.json");
  const result = JSON.parse(readFileSync(reportPath, "utf8"));
  writeFileSync(process.stdout.fd, `${JSON.stringify({
    ok: result.ok === true,
    diagnostics: result.diagnostics?.length || 0,
    gracefulShutdown: result.isolation?.gracefulShutdown === true,
    tempRootRemoved: result.isolation?.tempRootRemoved === true,
    reportPath,
  })}\n`);
}

await main();
