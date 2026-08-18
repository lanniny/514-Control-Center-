/**
 * ssh/remote-run.mjs — v41 波二：远程 run 桥（adapter spawn/runProcess 的 SSH 替身）。
 *
 * 设计锚点（proposals/v41-remote-agent-design.md §3）：
 *   - CLI 协议全是 stdio 行 JSON/JSON-RPC，忠实管道即对 SSH 透明；审批走协议内请求-响应
 *   - 远端命令套 `setsid sh -c 'printf PGID; exec "$@"'`：新会话 pgid==pid，
 *     取消=另开短 exec `pkill -TERM -g <pgid>`（升级 KILL），只杀自己这棵树，不宽泛模式串误杀
 *   - PGID 标记行由本封装在 stdout 首行剥离——绝不进 adapter 的协议解析流
 *   - fake child 绝不暴露 pid：terminateChildProcessInternal 在 win32 上有 taskkill /PID 分支，
 *     远端 pid 若泄漏会被当成本地 pid 误杀本机进程（进程级铁律）
 *   - env/凭据策略（§3.4）：本地 env/密钥不经命令行注入远端（`ps` 可见），远端 CLI 用各自登录态
 *
 * 消费方式：
 *   - spawn 型 adapter（claude/kimi/codex-cli/gemini/grok-build/opencode）：
 *     构造注入 runProcessImpl = runner.runProcessImpl(hostId, path)
 *   - 常驻型 adapter（codex app-server / pi-rpc）：构造注入 spawnImpl = runner.spawnImpl(hostId, path)
 * 远端为 POSIX/ssh 假设（setsid/sh）；远端 Windows/无 setsid 的极简系统如实失败（exit 127 回显）。
 */

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runProcess } from "../process-runner.mjs";
import { detectReplacementCorruption, digestPrompt, sealPromptTransport } from "../prompt-transport.mjs";
import { sanitizeRemotePath } from "../remote-projects.mjs";

const PGID_PREFIX = "514CC_PGID=";
const PGID_HEAD_CAP = 4096; // 首行探测缓冲上限：异常远端（无标记）也不会无限积压

function remoteRunError(code, message, httpStatus = 400) {
  return Object.assign(new Error(message), { code, httpStatus });
}

/** POSIX 单引号包裹（'\'' 转义）——远端 shell 命令拼参唯一合法形态（pty/routes.mjs 先例）。 */
export function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function shUnquote(quoted) {
  const text = String(quoted ?? "");
  if (text.length < 2 || !text.startsWith("'") || !text.endsWith("'")) {
    throw Object.assign(new Error("remote argv is not a POSIX single-quoted token"), {
      code: "PROMPT_TRANSPORT_CORRUPT",
      failureClass: "provider_error",
    });
  }
  return text.slice(1, -1).replace(/'\\''/g, "'");
}

export function assertRemoteArgvUtf8(args = []) {
  for (const value of args) {
    const original = String(value ?? "");
    sealPromptTransport({ prompt: original, transport: "ssh" });
    const echoed = shUnquote(shQuote(original));
    if (echoed !== original || detectReplacementCorruption(original, echoed) || digestPrompt(original) !== digestPrompt(echoed)) {
      throw Object.assign(new Error("SSH argv lost UTF-8 while quoting the remote command line"), {
        code: "PROMPT_TRANSPORT_CORRUPT",
        failureClass: "provider_error",
      });
    }
  }
}

/**
 * 远端命令行：`cd <cwd> && setsid sh -c '<script>' 514cc-remote <cmd> <args...>`。
 * script 先 printf PGID 标记行（$$=内层 sh pid，setsid 后 pgid==pid），再 exec 替换为真实 CLI——
 * exec 保 pid 不变，故标记行给出的就是整棵进程树的 pgid。参数走位置参数 "$@"，避免二次套引号。
 */
export function buildRemoteCommandLine({ cwd, command, args = [] }) {
  assertRemoteArgvUtf8([cwd, command, ...args]);
  const script = `printf "${PGID_PREFIX}%s\\n" "$$"; exec "$@"`;
  const tail = [command, ...args].map(shQuote).join(" ");
  return `cd ${shQuote(cwd)} && setsid sh -c ${shQuote(script)} 514cc-remote ${tail}`;
}

/**
 * ChildProcess 形替身：同步返回、异步挂通道（spawnImpl 契约要求同步返回 child）。
 * stdin=PassThrough（挂通道后 pipe 进去，先写先缓冲）；stdout/stderr=PassThrough（通道数据泵入）；
 * stdout 首行剥 PGID 标记后再放行；事件 exit/close/error 与 Node 子进程同序。
 */
function createRemoteChild({ ssh, hostId, commandLine }) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null; // 无 pid 属性——win32 taskkill 误杀守卫（模块头注释）
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.unref = () => {};

  let channel = null;
  let pgid = null;
  let head = Buffer.alloc(0);
  let headDone = false; // PGID 首行已剥离（或判定无标记）
  let killCalled = false;
  let killRequest = Promise.resolve({ ok: true, result: null });

  const feedStdout = (chunk) => {
    if (headDone) {
      stdout.write(chunk);
      return;
    }
    head = Buffer.concat([head, chunk]);
    const lf = head.indexOf(0x0a);
    if (lf < 0) {
      if (head.length > PGID_HEAD_CAP) headDone = true; // 异常远端：放行原样字节
      else return;
      stdout.write(head);
      head = Buffer.alloc(0);
      return;
    }
    headDone = true;
    const firstLine = head.subarray(0, lf).toString("utf8").replace(/\r$/, "");
    if (firstLine.startsWith(PGID_PREFIX)) {
      const parsed = Number.parseInt(firstLine.slice(PGID_PREFIX.length), 10);
      if (Number.isInteger(parsed) && parsed > 0) pgid = parsed;
      else stdout.write(head.subarray(0, lf + 1)); // 标记畸形：如实放行，不假装剥过
    } else {
      stdout.write(head.subarray(0, lf + 1)); // 无标记（setsid/sh 行为差异）：原样放行
    }
    const rest = head.subarray(lf + 1);
    head = Buffer.alloc(0);
    if (rest.length) stdout.write(rest);
  };

  const attach = ssh.openRunChannel(hostId, commandLine).then((stream) => {
    channel = stream;
    stdin.pipe(stream); // PassThrough 缓冲的先写数据此刻泄入；stdin end → channel.end（远端见 EOF）
    stream.on("data", feedStdout);
    stream.stderr.on("data", (chunk) => stderr.write(chunk));
    stream.stderr.on("end", () => stderr.end());
    stream.on("exit", (code, signal) => {
      child.exitCode = typeof code === "number" ? code : null;
      if (signal) child.signalCode = String(signal);
      child.emit("exit", child.exitCode, child.signalCode);
    });
    stream.on("close", () => {
      if (!headDone && head.length) stdout.write(head); // 通道早夭：缓冲残头也不吞
      stdout.end();
      stderr.end();
      stdin.destroy();
      child.emit("close", child.exitCode, child.signalCode);
    });
    // 进程级铁律（ssh2 多 emit('error') 杀进程教训）：channel 错误监听终生在籍
    stream.on("error", (error) => child.emit("error", error));
  });
  // 挂接失败（连接/认证/通道被拒）：异步发 error——监听方在 spawnImpl 返回后才挂，同步抛会逃逸
  attach.catch((error) => {
    queueMicrotask(() => child.emit("error", error));
  });

  /**
   * kill 契约（terminateChildProcessInternal 消费）：
   *   - 首调 TERM：只发远端 pkill（pgid 未知则通道关闭兜底），等远端自然死、通道自然关——保住 stdout 尾
   *   - 二调/KILL：升级 pkill -KILL + 立即拆通道（终止器等 close 事件，不能永远等）
   *   - waitForTerminationRequest：让终止器等到短 exec 回执，不能把 SSH 通道先关误当远端进程树已停
   */
  child.waitForTerminationRequest = async () => {
    const outcome = await killRequest;
    if (!outcome.ok) throw outcome.error;
    return outcome.result;
  };
  child.kill = (signal = "SIGTERM") => {
    const sig = signal === "SIGKILL" ? "SIGKILL" : "SIGTERM";
    child.signalCode ??= sig;
    if (pgid != null) {
      const op = sig === "SIGKILL" ? "KILL" : "TERM";
      // pkill=1 既可能是目标已退出，也可能是信号未送达；用 pgrep 只把“组已不存在”归为成功。
      const terminateCommand = [
        `pkill -${op} -g ${pgid} 2>/dev/null`,
        "status=$?",
        'if [ "$status" -eq 0 ]; then exit 0; fi',
        `pgrep -g ${pgid} >/dev/null 2>&1`,
        "probe=$?",
        'if [ "$probe" -eq 1 ]; then exit 0; fi',
        'exit "$status"',
      ].join("; ");
      killRequest = Promise.resolve(ssh.exec(hostId, {
        command: terminateCommand,
        timeoutMs: 5_000,
      })).then(
        (result) => result?.code === 0
          ? { ok: true, result }
          : {
              ok: false,
              error: remoteRunError("REMOTE_TERMINATION_FAILED", `remote ${op} request failed for process group ${pgid}`, 502),
            },
        (cause) => ({
          ok: false,
          error: Object.assign(
            remoteRunError("REMOTE_TERMINATION_FAILED", `remote ${op} request could not be confirmed for process group ${pgid}`, 502),
            { cause },
          ),
        }),
      );
    } else {
      killRequest = Promise.resolve({ ok: true, result: null });
      channel?.close?.();
    }
    if (sig === "SIGKILL" || killCalled) channel?.close?.();
    killCalled = true;
    return true;
  };

  return child;
}

export function createRemoteRunner({ getService, gates = null } = {}) {
  const serviceOrThrow = () => {
    const ssh = typeof getService === "function" ? getService() : null;
    if (!ssh) throw remoteRunError("REMOTE_UNAVAILABLE", "ssh service is not registered; open the remote hosts panel once or check server wiring", 503);
    return ssh;
  };

  /** 入参归一：{hostId, path} 形状校验 + POSIX 路径消毒（remote-projects 同源）。 */
  function validateRemote(input) {
    if (input == null || typeof input !== "object") {
      throw remoteRunError("INVALID_REMOTE", "remote must be an object { hostId, path }", 422);
    }
    const hostId = String(input.hostId ?? "").trim();
    if (!hostId) throw remoteRunError("INVALID_REMOTE", "remote.hostId is required", 422);
    let path;
    try {
      path = sanitizeRemotePath(input.path);
    } catch (error) {
      throw remoteRunError("INVALID_REMOTE_PATH", error.message, 422);
    }
    return { hostId, path };
  }

  /** 每次远程派工准入：重新核验 gate 与主机启用态，不重复执行远端路径探针。 */
  function assertDispatchable(hostId, path) {
    const normalized = validateRemote({ hostId, path });
    gates?.assert?.("ssh"); // 未授权 501 REMOTE_GATE_BLOCKED（路由面同款语义）
    const ssh = serviceOrThrow();
    const host = ssh.list().find((item) => item.id === normalized.hostId);
    if (!host) throw remoteRunError("REMOTE_HOST_NOT_FOUND", `host not found: ${normalized.hostId}`, 404);
    if (host.enabled === false) throw remoteRunError("REMOTE_HOST_DISABLED", `host is disabled: ${host.host}`, 409);
    return { ssh, host, ...normalized };
  }

  /** 建 run 准入：每次派工防线 + 远端 `test -d` 探针（仅此一次，失败 422 如实）。 */
  async function assertRunnable(hostId, path) {
    const dispatch = assertDispatchable(hostId, path);
    const probe = await dispatch.ssh.exec(dispatch.hostId, { command: `test -d ${shQuote(dispatch.path)} && printf ok`, timeoutMs: 15_000 });
    if (probe.code !== 0 || !probe.stdout.includes("ok")) {
      throw remoteRunError("INVALID_REMOTE_PATH", `remote path is not a directory on ${dispatch.host.name || dispatch.hostId}: ${dispatch.path}`, 422);
    }
    return { host: dispatch.host, path: dispatch.path };
  }

  /** 审批哈希口径（§3.3）：远程工作区用规范化串，绝不进本机 resolve()/git。 */
  function workspaceLabel(hostId, path) {
    return `ssh://${hostId}${path}`;
  }

  /** 常驻型 adapter 注入（codex app-server / pi-rpc）：(command, args, options) => child，同步返回。 */
  function spawnImpl(hostId, path) {
    return (command, args = [], _options = {}) => {
      const dispatch = assertDispatchable(hostId, path);
      // options.cwd/env 是本地语义，刻意丢弃——远端 cwd 用台账 path，env 用远端 CLI 各自登录态（§3.4）
      return createRemoteChild({
        ssh: dispatch.ssh,
        hostId: dispatch.hostId,
        commandLine: buildRemoteCommandLine({ cwd: dispatch.path, command, args }),
      });
    };
  }

  /** spawn 型 adapter 注入（runProcessImpl 契约）：复用 runProcess 的超时/信号/封顶/解码器，只换 spawn 替身。 */
  function runProcessImpl(hostId, path) {
    const remoteSpawn = spawnImpl(hostId, path);
    return (command, args = [], options = {}) => runProcess(command, args, {
      ...options,
      cwd: undefined, // 远端 path 由 spawnImpl 闭包持有；本地 cwd 绝不往远端套
      env: {}, // 本地密钥/env 不经命令行/env 出机（§3.4）；fake child 本就忽略 env，此处双保险
      spawnImpl: remoteSpawn,
    });
  }

  return { validateRemote, assertDispatchable, assertRunnable, workspaceLabel, spawnImpl, runProcessImpl };
}
