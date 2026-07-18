#!/usr/bin/env node

import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createControlCenter } from "./src/app.mjs";
import { childProcessEnv, runProcess } from "./src/process-runner.mjs";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(appRoot, "public");
const token = process.env.CONTROL_CENTER_TOKEN || randomBytes(32).toString("base64url");
const port = Number(process.env.CONTROL_CENTER_PORT || process.argv.find((value) => value.startsWith("--port="))?.split("=")[1] || 0);
const host = "127.0.0.1";
const state = await createControlCenter();

const securityHeaders = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function json(response, status, payload) {
  response.writeHead(status, { ...securityHeaders, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function body(request, maxBytes = 6 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("request body is too large"), { code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("request body must be valid JSON"), { code: "INVALID_JSON" });
  }
}

function authorized(request) {
  return request.headers.authorization === `Bearer ${token}`;
}

function secretReferenceStatus(health) {
  const byId = new Map(health.map((item) => [item.id, item]));
  const grokReferences = ["GROK_SEARCH_RS_COMPAT_API_URL", "GROK_SEARCH_RS_COMPAT_API_KEY", "GROK_SEARCH_RS_COMPAT_MODEL"];
  return [
    {
      id: "control-access",
      name: "Control Center Access",
      reference: "URL fragment -> sessionStorage -> Authorization header",
      configured: true,
    },
    {
      id: "claude-cli-session",
      name: "Claude CLI Session",
      reference: "local CLI credential store",
      configured: byId.get("claude-fable")?.available ?? null,
    },
    {
      id: "codex-cli-session",
      name: "Codex CLI Session",
      reference: "CODEX_HOME credential store",
      configured: byId.get("codex-technical")?.available ?? null,
    },
    {
      id: "grok-search-env",
      name: "Grok Search",
      reference: grokReferences.join(" + "),
      configured: grokReferences.every((name) => Boolean(process.env[name])),
    },
  ];
}

function statusFor(error) {
  if (["SOURCE_NOT_FOUND", "RUN_NOT_FOUND", "VERSION_NOT_FOUND", "APPROVAL_NOT_FOUND"].includes(error.code)) return 404;
  if (["STALE_BASE", "RUN_ACTIVE", "TURN_ACTIVE", "APPROVAL_HASH_MISMATCH", "APPROVAL_IN_PROGRESS", "PLAN_REQUIRED", "PLAN_MISMATCH", "APPROVAL_REQUIRED", "RECOVERY_REQUIRED", "RUNTIME_BUSY"].includes(error.code)) return 409;
  if (["CONFIRMATION_REQUIRED", "DEPLOYMENT_REQUIRED", "READ_ONLY_SOURCE", "FROZEN_BLOCK"].includes(error.code)) return 403;
  if (["VALIDATION_FAILED", "INVALID_PROMPT", "INVALID_JSON", "INVALID_DECISION", "PROVIDER_NOT_FOUND", "PROVIDER_UNAVAILABLE", "NO_ROUTE", "NO_INDEPENDENT_ROUTE", "ROUND_LIMIT", "INSUFFICIENT_ROUNDS", "SENSITIVE_PROMPT", "UNSUPPORTED_APPROVAL", "UNSUPPORTED_PERMISSION", "POLICY_VIOLATION", "ADAPTER_UNAVAILABLE", "TRANSACTION_INCONSISTENT"].includes(error.code)) return 422;
  if (error.code === "BODY_TOO_LARGE") return 413;
  if (error.code === "PROCESS_TIMEOUT") return 408; // 系统选择框挂满 5 分钟未选属预期流程，不是服务端故障
  if (error.code === "OUTPUT_LIMIT") return 413;
  return 500;
}

async function serveStatic(pathname, response) {
  if (pathname === "/favicon.ico") {
    response.writeHead(204, { ...securityHeaders, "cache-control": "public, max-age=86400" });
    response.end();
    return true;
  }
  const paths = { "/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/markdown.js": "markdown.js", "/theme.js": "theme.js", "/styles.css": "styles.css" };
  const file = paths[pathname];
  if (!file) return false;
  const content = await readFile(join(publicRoot, file));
  const type = extname(file) === ".js" ? "text/javascript; charset=utf-8" : extname(file) === ".css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
  response.writeHead(200, { ...securityHeaders, "content-type": type, "cache-control": "no-store" });
  response.end(content);
  return true;
}

async function api(request, response, url) {
  const { pathname } = url;
  if (request.method === "GET" && pathname === "/api/bootstrap") {
    const [health, sources] = await Promise.all([state.healthService.all(), state.configManager.listSources()]);
    return json(response, 200, {
      version: "0.1.0",
      runtime: { generation: state.generation, activation: "live" },
      repoRoot: state.repoRoot,
      providers: state.models.profiles,
      health,
      sources,
      runs: state.orchestrator.list(),
      approvals: state.approvalBroker.list(),
      routing: state.routing,
      permissions: state.permissions,
      security: { secrets: secretReferenceStatus(health) },
    });
  }
  if (request.method === "GET" && pathname === "/api/health") {
    return json(response, 200, { items: await state.healthService.all({ refresh: url.searchParams.get("refresh") === "1" }) });
  }
  if (request.method === "POST" && pathname === "/api/runtime/reload") {
    return json(response, 200, await state.reloadRuntime({ reason: "operator request" }));
  }
  if (request.method === "GET" && pathname === "/api/config/sources") {
    return json(response, 200, { sources: await state.configManager.listSources() });
  }
  if (request.method === "GET" && pathname === "/api/observability/summary") return json(response, 200, await state.observability.summary());
  if (request.method === "GET" && pathname === "/api/observability/routegate") {
    return json(response, 200, await state.observability.routeGate({ days: Number(url.searchParams.get("days")) || 7 }));
  }
  if (request.method === "GET" && pathname === "/api/observability/delta") return json(response, 200, await state.observability.deltaLedger());
  if (request.method === "GET" && pathname === "/api/observability/handoffs") return json(response, 200, { handoffs: await state.observability.handoffs() });
  const handoffMatch = pathname.match(/^\/api\/observability\/handoffs\/([^/]+)$/);
  if (request.method === "GET" && handoffMatch) return json(response, 200, await state.observability.handoffContent(decodeURIComponent(handoffMatch[1])));
  if (request.method === "POST" && pathname === "/api/observability/drift") return json(response, 200, await state.observability.drift());
  if (request.method === "GET" && pathname === "/api/sessions") {
    return json(response, 200, await state.sessions.list({ includeSummaries: url.searchParams.get("summaries") === "1" }));
  }
  if (request.method === "GET" && pathname === "/api/sessions/projects") {
    return json(response, 200, await state.sessions.projects({ includeSummaries: url.searchParams.get("summaries") === "1" }));
  }
  const previewMatch = pathname.match(/^\/api\/sessions\/claude\/([^/]+)\/([^/]+)\/preview$/);
  if (request.method === "GET" && previewMatch) {
    return json(response, 200, await state.sessions.preview({
      project: decodeURIComponent(previewMatch[1]),
      id: decodeURIComponent(previewMatch[2]),
    }));
  }

  if (request.method === "GET" && pathname === "/api/teams") {
    // rejectedOnLoad 暴露给前端——团队被拒载必须可见，不许静默消失（烛 R11 建议）
    return json(response, 200, { teams: state.teams.list(), rejectedOnLoad: state.teams.rejectedOnLoad });
  }
  if (request.method === "POST" && pathname === "/api/teams") return json(response, 201, await state.teams.create(await body(request)));
  const teamMatch = pathname.match(/^\/api\/teams\/([^/]+)$/);
  if (teamMatch) {
    const teamId = decodeURIComponent(teamMatch[1]);
    if (request.method === "GET") return json(response, 200, state.teams.get(teamId));
    if (request.method === "PUT") return json(response, 200, await state.teams.update(teamId, await body(request)));
    if (request.method === "DELETE") return json(response, 200, await state.teams.remove(teamId));
  }

  if (request.method === "GET" && pathname === "/api/runs") return json(response, 200, { runs: state.orchestrator.list() });
  if (request.method === "POST" && pathname === "/api/runs") return json(response, 202, await state.orchestrator.create(await body(request)));
  if (request.method === "POST" && pathname === "/api/runs/clear-finished") return json(response, 200, await state.orchestrator.clearFinished());
  if (request.method === "POST" && pathname === "/api/system/pick-directory") {
    // 弹本机资源管理器目录选择框（Console 是 loopback 本地服务的特权面）。
    // 单例锁：同时只允许一个系统对话框，重复请求 409 而非叠窗。
    if (state.pickingDirectory) return json(response, 409, { error: { code: "PICKER_BUSY", message: "a directory picker is already open" } });
    state.pickingDirectory = true;
    try {
      const script = [
        // stdout 编码钉死 UTF-8：中文 Windows 的 powershell 管道默认 OEM 码页（GBK），
        // runProcess 按 UTF-8 解码会把含中文的路径整条打成 U+FFFD（附件/项目地址静默失效）
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
        "Add-Type -AssemblyName System.Windows.Forms",
        "$f = New-Object System.Windows.Forms.FolderBrowserDialog",
        "$f.Description = '选择会话项目地址'",
        "$f.ShowNewFolderButton = $true",
        "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; WindowState = 'Minimized' }",
        "$owner.Show(); $owner.Activate()",
        "$result = $f.ShowDialog($owner)",
        "$owner.Close()",
        "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }",
      ].join("; ");
      const picked = await runProcess("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
        timeoutMs: 5 * 60_000, // 给用户足够的翻找时间
        maxOutputBytes: 64 * 1024,
      });
      const path = picked.stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      return json(response, 200, path ? { path } : { cancelled: true });
    } finally {
      state.pickingDirectory = false;
    }
  }
  if (request.method === "POST" && pathname === "/api/system/pick-file") {
    // 附件文件选择框（与目录选择器共用单例锁：同时只弹一个系统对话框）
    if (state.pickingDirectory) return json(response, 409, { error: { code: "PICKER_BUSY", message: "a system picker is already open" } });
    state.pickingDirectory = true;
    try {
      const script = [
        // stdout 编码钉死 UTF-8：中文 Windows 的 powershell 管道默认 OEM 码页（GBK），
        // runProcess 按 UTF-8 解码会把含中文的路径整条打成 U+FFFD（附件/项目地址静默失效）
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
        "Add-Type -AssemblyName System.Windows.Forms",
        "$f = New-Object System.Windows.Forms.OpenFileDialog",
        "$f.Title = '附加资料文件'",
        "$f.Multiselect = $true",
        "$f.CheckFileExists = $true",
        "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; WindowState = 'Minimized' }",
        "$owner.Show(); $owner.Activate()",
        "$result = $f.ShowDialog($owner)",
        "$owner.Close()",
        "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { $f.FileNames | ForEach-Object { Write-Output $_ } }",
      ].join("; ");
      const picked = await runProcess("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
        timeoutMs: 5 * 60_000,
        maxOutputBytes: 256 * 1024, // Multiselect 数百条长路径也容得下
      });
      const paths = picked.stdout.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      return json(response, 200, paths.length ? { paths } : { cancelled: true });
    } finally {
      state.pickingDirectory = false;
    }
  }
  if (request.method === "POST" && pathname === "/api/system/reveal") {
    // 在资源管理器中打开（本地特权面）：目录直接开，文件定位选中；路径必须真实存在
    const { path } = await body(request);
    const target = String(path || "").trim();
    if (!target) throw Object.assign(new Error("path is required"), { code: "VALIDATION_FAILED" });
    let info;
    try {
      info = await stat(target);
    } catch {
      throw Object.assign(new Error(`path does not exist: ${target}`), { code: "SOURCE_NOT_FOUND" });
    }
    // explorer.exe 常以非 0 退出码返回（历史行为），fire-and-forget 不据此报错
    const args = info.isDirectory() ? [target] : [`/select,${target}`];
    spawn("explorer.exe", args, { detached: true, stdio: "ignore", windowsHide: false }).unref();
    return json(response, 200, { revealed: target });
  }
  if (request.method === "POST" && pathname === "/api/system/worktree") {
    // 在新工作树中继续：基于该目录 HEAD 建 detached worktree（同级 <name>-wt-<stamp>），返回新路径
    const { path } = await body(request);
    const target = String(path || "").trim();
    if (!target) throw Object.assign(new Error("path is required"), { code: "VALIDATION_FAILED" });
    const probe = await runProcess("git", ["-C", target, "rev-parse", "--show-toplevel"], { timeoutMs: 15_000, maxOutputBytes: 16 * 1024 });
    if (probe.code !== 0) {
      throw Object.assign(new Error(`${target} 不在 git 仓库内，无法创建工作树：${probe.stderr.trim().slice(0, 160)}`), { code: "VALIDATION_FAILED" });
    }
    const repoTop = probe.stdout.trim().split(/\r?\n/).pop();
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const worktreePath = join(dirname(repoTop), `${basename(repoTop)}-wt-${stamp}`);
    const created = await runProcess("git", ["-C", repoTop, "worktree", "add", "--detach", worktreePath], { timeoutMs: 60_000, maxOutputBytes: 64 * 1024 });
    if (created.code !== 0) {
      throw Object.assign(new Error(`git worktree add 失败：${created.stderr.trim().slice(0, 200)}`), { code: "VALIDATION_FAILED" });
    }
    return json(response, 200, { worktree: worktreePath, base: repoTop });
  }
  if (pathname === "/api/projects/prefs") {
    // 项目侧栏偏好（置顶/重命名/隐藏）：dataRoot 下单文件，键=归一化项目路径
    const prefsPath = join(state.dataRoot, "project-prefs.json");
    if (request.method === "GET") {
      try {
        return json(response, 200, JSON.parse(await readFile(prefsPath, "utf8")));
      } catch {
        return json(response, 200, { projects: {} });
      }
    }
    if (request.method === "PUT") {
      const payload = await body(request);
      const projects = payload?.projects;
      if (!projects || typeof projects !== "object" || Array.isArray(projects)) {
        throw Object.assign(new Error("projects object is required"), { code: "VALIDATION_FAILED" });
      }
      const clean = {};
      for (const [key, value] of Object.entries(projects)) {
        if (typeof key !== "string" || key.length > 500 || !value || typeof value !== "object") continue;
        const entry = {};
        if (value.pinned !== undefined) entry.pinned = Boolean(value.pinned);
        if (value.hidden !== undefined) entry.hidden = Boolean(value.hidden);
        if (typeof value.name === "string" && value.name.trim()) entry.name = value.name.trim().slice(0, 120);
        if (Object.keys(entry).length) clean[key] = entry;
      }
      await mkdir(state.dataRoot, { recursive: true });
      await writeFile(prefsPath, `${JSON.stringify({ projects: clean }, null, 2)}\n`, "utf8");
      return json(response, 200, { projects: clean });
    }
  }
  if (request.method === "POST" && pathname === "/api/projects/archive-finished") {
    const { cwd } = await body(request);
    if (!String(cwd || "").trim()) throw Object.assign(new Error("cwd is required"), { code: "VALIDATION_FAILED" });
    return json(response, 200, await state.orchestrator.archiveFinishedByCwd(cwd));
  }

  const runEventsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (request.method === "GET" && runEventsMatch) {
    // per-run 全量事件回放——不受全局最近窗口限制，供前端重建长会话完整历史（含工具过程）
    return json(response, 200, { events: await state.eventStore.listByRun(decodeURIComponent(runEventsMatch[1])) });
  }
  if (request.method === "POST" && pathname === "/api/router/preview") {
    const input = await body(request);
    delete input.allowedProviders; // 白名单只能由服务端从 teamId 推导，不信客户端直提（烛 R10 致命2）
    // 缺省解析内置团队——预览与 orchestrator.create 完全同契约（烛 R11 建议）
    input.allowedProviders = [...state.teams.get(String(input.teamId || "team-514cc")).members];
    return json(response, 200, await state.router.preview(input));
  }
  if (request.method === "GET" && pathname === "/api/approvals") return json(response, 200, { approvals: state.approvalBroker.list() });

  let match = pathname.match(/^\/api\/approvals\/([^/]+)\/resolve$/);
  if (request.method === "POST" && match) return json(response, 200, await state.approvalBroker.resolve(decodeURIComponent(match[1]), await body(request)));

  match = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (request.method === "GET" && match) return json(response, 200, state.orchestrator.get(decodeURIComponent(match[1])));
  match = pathname.match(/^\/api\/runs\/([^/]+)\/(cancel|messages)$/);
  if (request.method === "POST" && match) {
    const id = decodeURIComponent(match[1]);
    return json(response, 200, match[2] === "cancel" ? await state.orchestrator.cancel(id) : await state.orchestrator.continue(id, await body(request)));
  }
  match = pathname.match(/^\/api\/runs\/([^/]+)\/meta$/);
  if (request.method === "PATCH" && match) {
    return json(response, 200, await state.orchestrator.updateMeta(decodeURIComponent(match[1]), await body(request)));
  }

  match = pathname.match(/^\/api\/config\/(.+?)\/versions\/([^/]+)\/content$/);
  if (request.method === "GET" && match) {
    // 回滚预览：指定版本原文（鉴权走 /api 全局 bearer；VERSION_NOT_FOUND/SOURCE_NOT_FOUND→404 由 statusFor 映射）
    return json(response, 200, await state.configManager.versionContent(decodeURIComponent(match[1]), decodeURIComponent(match[2])));
  }
  match = pathname.match(/^\/api\/config\/(.+?)\/(versions|validate|plan|apply|rollback)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const action = match[2];
    if (request.method === "GET" && action === "versions") return json(response, 200, { versions: await state.configManager.versions(id) });
    if (request.method === "POST") {
      const input = await body(request);
      if (action === "validate") return json(response, 200, await state.configManager.validate(id, input.content));
      if (action === "plan") return json(response, 200, await state.configManager.plan(id, input.content, input.baseSha256));
      if (action === "apply") return json(response, 200, await state.configManager.apply(id, input));
      if (action === "rollback") return json(response, 200, await state.configManager.rollback(id, input));
    }
  }
  match = pathname.match(/^\/api\/config\/(.+)$/);
  if (request.method === "GET" && match) return json(response, 200, await state.configManager.read(decodeURIComponent(match[1])));

  if (request.method === "GET" && pathname === "/api/events") {
    response.writeHead(200, {
      ...securityHeaders,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    const requestedAfter = Number(url.searchParams.get("after") || request.headers["last-event-id"] || 0);
    const afterSequence = Number.isSafeInteger(requestedAfter) && requestedAfter >= 0 ? requestedAfter : 0;
    const maxPendingChunks = 1024;
    let replaying = true;
    let lastSequence = afterSequence;
    let blocked = false;
    let closed = false;
    let heartbeat = null;
    const pendingChunks = [];
    const queuedEvents = [];
    let unsubscribe = () => {};
    const closeStream = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      response.off("drain", flushChunks);
    };
    const writeChunk = (chunk) => {
      if (closed) return false;
      if (blocked) {
        if (pendingChunks.length >= maxPendingChunks) {
          closeStream();
          response.destroy();
          return false;
        }
        pendingChunks.push(chunk);
        return true;
      }
      try {
        blocked = !response.write(chunk);
        return true;
      } catch {
        closeStream();
        return false;
      }
    };
    function flushChunks() {
      if (closed) return;
      blocked = false;
      while (pendingChunks.length) {
        try {
          if (!response.write(pendingChunks.shift())) {
            blocked = true;
            return;
          }
        } catch {
          closeStream();
          return;
        }
      }
    }
    const writeEvent = (event) => {
      if ((Number(event.sequence) || 0) <= lastSequence) return;
      lastSequence = Number(event.sequence) || lastSequence;
      writeChunk(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    unsubscribe = state.eventStore.subscribe((event) => {
      if (replaying) {
        if (queuedEvents.length >= maxPendingChunks) {
          writeChunk(`event: replay_gap\ndata: ${JSON.stringify({ code: "LIVE_REPLAY_OVERFLOW", afterSequence: lastSequence })}\n\n`);
          closeStream();
          response.end();
          return;
        }
        queuedEvents.push(event);
      }
      else writeEvent(event);
    });
    response.on("drain", flushChunks);
    response.once("error", closeStream);
    response.once("close", closeStream);
    writeChunk(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ requestId: randomUUID(), afterSequence })}\n\n`);
    try {
      if (afterSequence > 0) {
        let cursor = afterSequence;
        while (!closed) {
          const page = await state.eventStore.replay(cursor, 2000);
          for (const event of page.events) writeEvent(event);
          if (!page.hasMore || !page.events.length) break;
          cursor = Number(page.events.at(-1)?.sequence) || cursor;
        }
      } else {
        for (const event of await state.eventStore.list(50)) writeEvent(event);
      }
    } catch (error) {
      writeChunk(`event: replay_error\ndata: ${JSON.stringify({ code: "EVENT_REPLAY_FAILED", message: error.message })}\n\n`);
      closeStream();
      response.end();
      return;
    }
    replaying = false;
    for (const event of queuedEvents) writeEvent(event);
    heartbeat = setInterval(() => writeChunk(": heartbeat\n\n"), 20_000);
    return;
  }
  return json(response, 404, { error: { code: "NOT_FOUND", message: "API route not found" } });
}

const server = createServer(async (request, response) => {
  const requestId = randomUUID();
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || host}`);
    if (url.pathname.startsWith("/api/")) {
      if (!authorized(request)) return json(response, 401, { error: { code: "UNAUTHORIZED", message: "Missing or invalid local access token", requestId } });
      return await api(request, response, url);
    }
    if (request.method === "GET" && (await serveStatic(url.pathname, response))) return;
    return json(response, 404, { error: { code: "NOT_FOUND", message: "Not found", requestId } });
  } catch (error) {
    await state.eventStore.emit("server.error", { requestId, code: error.code || null, message: error.message }, { sensitivity: "internal" }).catch(() => {});
    return json(response, statusFor(error), {
      error: {
        code: error.code || "INTERNAL_ERROR",
        message: error.message,
        requestId,
        validation: error.validation,
        currentSha256: error.currentSha256,
        candidates: error.candidates,
      },
    });
  }
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${actualPort}/#token=${token}`;
  process.stdout.write(`514cc Control Center: ${url}\n`);
  process.stdout.write(`API token is ephemeral and will be invalid after restart.\n`);
  if (process.env.CONTROL_CENTER_OPEN === "1") {
    const opener = process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
    const child = spawn(opener[0], opener[1], { env: childProcessEnv(), stdio: "ignore", windowsHide: true, detached: true, shell: false });
    child.once("error", (error) => process.stderr.write(`Could not open browser: ${error.message}\n`));
    child.unref();
  }
});

async function shutdown(signal) {
  process.stdout.write(`Shutting down (${signal})...\n`);
  const serverClosed = new Promise((resolveClosed) => server.close(resolveClosed));
  server.closeAllConnections?.();
  await state.close();
  await serverClosed;
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
