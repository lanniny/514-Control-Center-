import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";
import { StringDecoder } from "node:string_decoder";

export function resolveCommand(command, env = process.env) {
  if (process.platform !== "win32") return { command, prefixArgs: [], resolvedPath: command };
  const candidates = [];
  if (isAbsolute(command) || command.includes("\\") || command.includes("/")) candidates.push(command);
  else {
    const extension = extname(command);
    const directories = String(env.PATH || env.Path || "").split(delimiter).filter(Boolean);
    if (extension) {
      for (const directory of directories) candidates.push(join(directory, command));
    } else {
      // Preserve PATH ownership boundaries. Prefer a native or PowerShell entry
      // in the first matching directory instead of jumping to a later desktop
      // executable that may proxy into a shared, long-lived host.
      for (const directory of directories) {
        if (command.toLowerCase() === "codex" && (existsSync(join(directory, "codex.ps1")) || existsSync(join(directory, "codex.cmd")))) {
          const packageArch = process.arch === "arm64" ? "arm64" : "x64";
          const target = packageArch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
          candidates.push(join(
            directory,
            "node_modules",
            "@openai",
            "codex",
            "node_modules",
            "@openai",
            `codex-win32-${packageArch}`,
            "vendor",
            target,
            "bin",
            "codex.exe",
          ));
        }
        for (const suffix of [".exe", ".com", ".ps1"]) candidates.push(join(directory, `${command}${suffix}`));
      }
      for (const directory of directories) candidates.push(join(directory, `${command}.cmd`));
      // Grok Build installs to ~/.grok/bin (a non-PATH location); fall back to the
      // known install path so the kernel resolves grok regardless of the launching
      // shell's PATH state — same non-standard-location handling as codex above.
      if (command.toLowerCase() === "grok") {
        const home = env.USERPROFILE || env.HOME;
        if (home) candidates.push(join(home, ".grok", "bin", "grok.exe"));
      }
    }
  }
  const resolvedPath = candidates.find((candidate) => existsSync(candidate));
  if (!resolvedPath) return { command, prefixArgs: [], resolvedPath: command };
  const extension = extname(resolvedPath).toLowerCase();
  if (extension === ".ps1") {
    return {
      command: "powershell.exe",
      prefixArgs: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolvedPath],
      resolvedPath,
    };
  }
  if (extension === ".cmd" || extension === ".bat") {
    const error = new Error(`refusing to invoke ${extension} shim without a PowerShell or executable peer: ${resolvedPath}`);
    error.code = "UNSAFE_COMMAND_SHIM";
    throw error;
  }
  return { command: resolvedPath, prefixArgs: [], resolvedPath };
}

export function spawnCommand(command, args = [], options = {}) {
  const resolved = resolveCommand(command, options.env || process.env);
  return spawn(resolved.command, [...resolved.prefixArgs, ...args], { ...options, shell: false });
}

export function childProcessEnv(overrides = {}, base = process.env) {
  const env = { ...base, ...overrides };
  for (const key of Object.keys(env)) {
    const normalized = key.toLowerCase();
    if (
      normalized === "control_center_token"
      || normalized === "codex_thread_id"
      || normalized === "codex_session_id"
      || normalized.startsWith("codex_remote_")
    ) delete env[key];
  }
  return env;
}

export function terminateChildProcess(child) {
  if (!child?.pid) {
    child?.kill?.();
    return;
  }
  if (process.platform !== "win32") {
    child.kill("SIGTERM");
    return;
  }
  try {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    killer.once("error", () => child.kill());
    killer.unref();
  } catch {
    child.kill();
  }
}

export async function terminateChildProcessAndWait(child, { timeoutMs = 3_000 } = {}) {
  if (!child) return;
  const streams = [child.stdin, child.stdout, child.stderr].filter(Boolean);
  if ((child.exitCode != null || child.signalCode != null) && streams.every((stream) => stream.destroyed || stream.closed)) return;
  const closed = new Promise((resolveClose) => {
    child.once?.("close", resolveClose);
  });
  if (child.exitCode == null && child.signalCode == null) {
    if (process.platform === "win32" && child.pid) {
      const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
        timeout: Math.max(1_000, timeoutMs),
      });
      if (result.error || (result.status != null && result.status !== 0)) {
        try { child.kill?.(); } catch {}
      }
    } else {
      terminateChildProcess(child);
    }
  }
  let timeout;
  const completed = await Promise.race([
    closed.then(() => true),
    new Promise((resolveTimeout) => { timeout = setTimeout(() => resolveTimeout(false), timeoutMs); }),
  ]);
  clearTimeout(timeout);
  if (!completed) {
    try { child.kill?.(); } catch {}
    child.stdin?.destroy?.();
    child.stdout?.destroy?.();
    child.stderr?.destroy?.();
    child.unref?.();
    let finalTimeout;
    await Promise.race([
      closed,
      new Promise((resolveTimeout) => { finalTimeout = setTimeout(resolveTimeout, 250); }),
    ]);
    clearTimeout(finalTimeout);
  }
  child.stdin?.destroy?.();
  child.stdout?.destroy?.();
  child.stderr?.destroy?.();
  child.unref?.();
}

export function runProcess(command, args = [], options = {}) {
  const {
    cwd,
    env,
    input = null,
    timeoutMs = 15_000,
    maxOutputBytes = 2 * 1024 * 1024,
    signal,
    onStdout,
    onStderr,
  } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error("process aborted");
      error.code = "ABORTED";
      reject(error);
      return;
    }
    const child = spawnCommand(command, args, {
      cwd,
      env: childProcessEnv(env),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => {
      terminateChildProcess(child);
      const error = new Error("process aborted");
      error.code = "ABORTED";
      finish(reject, error);
    };
    const timer = setTimeout(() => {
      terminateChildProcess(child);
      const error = new Error(`process timed out after ${timeoutMs}ms`);
      error.code = "PROCESS_TIMEOUT";
      finish(reject, error);
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });

    // 逐通道 StringDecoder：把跨 pipe-chunk 边界切断的多字节 UTF-8 序列缓冲到下个 chunk，
    // 避免中文等字符在任意 64KB 读缓冲边界处被切成两半而产生 U+FFFD 乱码（并写坏 events.jsonl）。
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    const collect = (chunk, channel) => {
      outputBytes += chunk.length; // 字节计数用原始 Buffer 长度，limit 语义不变
      if (outputBytes > maxOutputBytes) {
        terminateChildProcess(child);
        const error = new Error("process output limit exceeded");
        error.code = "OUTPUT_LIMIT";
        finish(reject, error);
        return false;
      }
      const value = (channel === "stdout" ? stdoutDecoder : stderrDecoder).write(chunk);
      if (channel === "stdout") {
        stdout += value;
        if (value) onStdout?.(value);
      } else {
        stderr += value;
        if (value) onStderr?.(value);
      }
      return true;
    };

    child.stdout.on("data", (chunk) => {
      collect(chunk, "stdout");
    });
    child.stderr.on("data", (chunk) => {
      collect(chunk, "stderr");
    });
    // 各流 end 时冲刷该通道 decoder 残留（截断的多字节尾字节），此刻数据已完全到达；
    // 用 close（所有 stdio 流关闭后触发）而非 exit 结算——exit 可能早于 stdout 尾部到达，会丢尾字/乱码。
    child.stdout.on("end", () => {
      const tail = stdoutDecoder.end();
      if (tail) { stdout += tail; onStdout?.(tail); }
    });
    child.stderr.on("end", () => {
      const tail = stderrDecoder.end();
      if (tail) { stderr += tail; onStderr?.(tail); }
    });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code, exitSignal) => {
      finish(resolve, { code, signal: exitSignal, stdout, stderr });
    });
    if (signal?.aborted) {
      abort();
      return;
    }
    if (input == null) child.stdin.end();
    else child.stdin.end(input, "utf8");
  });
}
