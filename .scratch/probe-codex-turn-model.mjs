// 实证探针：codex app-server v2 的 turn/start 是否接受 per-turn model 覆盖。
// 流程：initialize → thread/start(model=A) → turn/start(model=B, 一行琐碎 prompt) → 观察事件。
// 只读性验证，prompt 要求回复一个词，成本可忽略。
import { spawn } from "node:child_process";
import readline from "node:readline";

const THREAD_MODEL = process.env.PROBE_THREAD_MODEL || "gpt-5.6-sol";
const TURN_MODEL = process.env.PROBE_TURN_MODEL || "gpt-5.5";

const child = spawn("codex.cmd", ["-c", "features.code_mode_host=false", "app-server", "--stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  shell: true,
});

let nextId = 1;
const pending = new Map();
const events = [];

const rl = readline.createInterface({ input: child.stdout });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try { message = JSON.parse(trimmed); } catch { return; }
  if (message.id != null && pending.has(message.id)) {
    const { resolve, reject, method } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`${method}: ${message.error.message}`));
    else resolve(message.result);
    return;
  }
  if (message.method) {
    events.push(message.method);
    if (/model|turn|thread|task/i.test(message.method)) {
      const params = message.params || {};
      console.log("[event]", message.method, JSON.stringify({
        model: params.model || params.turn?.model || params.thread?.model || params.info?.model,
        turnId: params.turnId || params.turn?.id,
        status: params.turn?.status || params.thread?.status,
        contextWindow: params.model_context_window || params.turn?.model_context_window,
      }));
    }
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`${method}: timeout`)); } }, 30_000);
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const timer = setTimeout(() => {
  console.log("PROBE-TIMEOUT, events so far:", events.join(","));
  child.kill();
  process.exit(2);
}, 60_000);

try {
  await request("initialize", {
    clientInfo: { name: "514cc-probe", title: "probe", version: "0" },
    capabilities: { experimentalApi: true },
  });
  notify("initialized", {});
  const thread = await request("thread/start", {
    cwd: process.cwd(),
    model: THREAD_MODEL,
    sandbox: "read-only",
    approvalPolicy: "on-request",
    experimentalRawEvents: false,
  });
  console.log("[thread]", thread.thread.id, "model:", thread.thread.model);
  const started = await request("turn/start", {
    threadId: thread.thread.id,
    input: [{ type: "text", text: "Reply with exactly one word: ok", text_elements: [] }],
    model: TURN_MODEL, // ← 探针核心：thread 绑 A，turn 要 B
    effort: "low",
    approvalPolicy: "on-request",
  });
  console.log("[turn-accepted]", started.turn?.id, "model:", started.turn?.model ?? "(no model field echoed)");
  // 等 turn 完成或出错
  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (events.some((m) => /turn\/(completed|failed)|turn\.completed|error/.test(m))) { clearInterval(check); resolve(); }
    }, 200);
    setTimeout(() => { clearInterval(check); resolve(); }, 25_000);
  });
  console.log("[done] events:", events.join(","));
  console.log(`PROBE-RESULT turn-model-override accepted: thread=${THREAD_MODEL} turn=${TURN_MODEL}`);
} catch (error) {
  console.log("PROBE-REJECTED:", error.message);
  console.log("[events]", events.join(","));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  child.kill();
}
