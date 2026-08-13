import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const sqliteFlag = "--experimental-sqlite";
const forwarded = process.argv.slice(2);
const hasExplicitTarget = forwarded.some((argument) => !argument.startsWith("-"));
const args = [sqliteFlag, "--test", ...forwarded];
if (!hasExplicitTarget) args.push("tests/*.test.mjs");

// NODE_OPTIONS is inherited by server/worker Node processes spawned from tests.
// Keep the explicit CLI flag too, so the test runner itself has node:sqlite on Node 22.5-22.x.
const inheritedNodeOptions = process.env.NODE_OPTIONS?.trim() ?? "";
const hasSqliteFlag = /(?:^|\s)--experimental-sqlite(?:\s|$)/.test(inheritedNodeOptions);
const nodeOptions = hasSqliteFlag ? inheritedNodeOptions : `${inheritedNodeOptions} ${sqliteFlag}`.trim();

const child = spawn(process.execPath, args, {
  cwd: appRoot,
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
  stdio: "inherit",
  windowsHide: true,
  shell: false,
});

child.once("error", (error) => {
  process.stderr.write(`control-center test runner failed: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`control-center test runner terminated by ${signal}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
