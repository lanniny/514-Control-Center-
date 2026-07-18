import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexAppServerAdapter } from "../src/adapters/codex-app-server.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(appRoot, "..", "..");
const events = [];
const adapter = new CodexAppServerAdapter({
  cwd: repoRoot,
  eventStore: { emit: async (type, data) => { events.push({ type, data }); } },
});

try {
  await adapter.start();
  process.stdout.write(`${JSON.stringify({ ok: true, protocol: "codex-app-server-v2", initialized: true, diagnostics: events }, null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, protocol: "codex-app-server-v2", error: error.message, code: error.code || null, diagnostics: events }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (process.env.CONTROL_CENTER_DEBUG_CLOSE === "1") process.stderr.write("CLOSE_START\n");
  const closeResult = await Promise.race([
    adapter.close().then(() => "closed", (error) => `error:${error.message}`),
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout("timeout"), 10_000)),
  ]);
  if (process.env.CONTROL_CENTER_DEBUG_CLOSE === "1") process.stderr.write(`CLOSE_RESULT ${closeResult}\n`);
  process.exit(process.exitCode || 0);
}
