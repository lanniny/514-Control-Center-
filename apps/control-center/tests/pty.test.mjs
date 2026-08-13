import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPtyService, defaultShell } from "../src/pty.mjs";
import { createRemoteGateService } from "../src/security/remote-gates.mjs";
import { registerPtyRoutes, setPtyServiceForTest, buildSshPtyArgs, sshShellCommand } from "../src/pty/routes.mjs";
import { setSshServiceForTest } from "../src/ssh/routes.mjs";
import { REPO_ROOT } from "../src/paths.mjs";

const isWin = process.platform === "win32";
const ECHO_MARKER = `PTY_TEST_${Date.now()}`;

function waitFor(cond, timeoutMs = 10_000, interval = 50) {
  const start = Date.now();
  return new Promise((resolveWait, rejectWait) => {
    const tick = () => {
      if (cond()) return resolveWait();
      if (Date.now() - start > timeoutMs) return rejectWait(new Error("waitFor timeout"));
      setTimeout(tick, interval);
    };
    tick();
  });
}

test("pty: spawn cmd/sh, echo round-trip through output stream", async (t) => {
  const service = createPtyService({ repoRoot: REPO_ROOT });
  t.after(() => service.closeAll());
  const session = createPtySession(service);
  let received = "";
  const unsubscribe = service.subscribe(session.id, (chunk) => { if (chunk) received += chunk; });
  t.after(unsubscribe);
  await service.write(session.id, isWin ? `echo ${ECHO_MARKER}\r` : `echo ${ECHO_MARKER}\n`);
  await waitFor(() => received.includes(ECHO_MARKER));
  assert.ok(received.includes(ECHO_MARKER));
});

test("pty: input queue preserves order for sequential writes", async (t) => {
  const service = createPtyService({ repoRoot: REPO_ROOT });
  t.after(() => service.closeAll());
  const session = createPtySession(service);
  let received = "";
  service.subscribe(session.id, (chunk) => { if (chunk) received += chunk; });
  const first = `AAA_${Date.now()}`;
  const second = `BBB_${Date.now()}`;
  await Promise.all([
    service.write(session.id, isWin ? `echo ${first}\r` : `echo ${first}\n`),
    service.write(session.id, isWin ? `echo ${second}\r` : `echo ${second}\n`),
  ]);
  await waitFor(() => received.includes(first) && received.includes(second));
  assert.ok(received.indexOf(first) < received.indexOf(second), "first echo appears before second");
});

test("pty: resize clamps and does not crash", async (t) => {
  const service = createPtyService({ repoRoot: REPO_ROOT });
  t.after(() => service.closeAll());
  const session = createPtySession(service);
  const size = service.resize(session.id, 120, 40);
  assert.deepEqual(size, { cols: 120, rows: 40 });
  const clamped = service.resize(session.id, 9999, 5);
  assert.deepEqual(clamped, { cols: 500, rows: 5 });
  // 0/缺省 = 保持当前（实现语义），不是重置
  const kept = service.resize(session.id, 100, 0);
  assert.deepEqual(kept, { cols: 100, rows: 5 });
});

test("pty: kill removes session", async (t) => {
  const service = createPtyService({ repoRoot: REPO_ROOT });
  t.after(() => service.closeAll());
  const session = createPtySession(service);
  assert.ok(service.list().some((entry) => entry.id === session.id));
  assert.equal(service.kill(session.id), true);
  assert.equal(service.get(session.id), null);
  assert.equal(service.kill(session.id), false);
});

test("pty: cwd sandbox rejects escape, accepts repo", async () => {
  const service = createPtyService({ repoRoot: REPO_ROOT });
  assert.throws(() => service.assertCwd("C:/Windows/System32"), { code: "PTY_CWD_BOUNDARY" });
  assert.equal(service.assertCwd(REPO_ROOT), REPO_ROOT);
  assert.equal(service.assertCwd(null), REPO_ROOT);
});

test("pty routes: gate blocks without grant, opens with grant", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-pty-routes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const remoteGates = await createRemoteGateService({ dataRoot: dir }).init();
  const service = createPtyService({ repoRoot: REPO_ROOT });
  t.after(() => { service.closeAll(); setPtyServiceForTest(null); });
  setPtyServiceForTest(service);

  const routes = [];
  const router = {
    get: (prefix, handler) => routes.push({ method: "GET", prefix, handler }),
    post: (prefix, handler) => routes.push({ method: "POST", prefix, handler }),
    delete: (prefix, handler) => routes.push({ method: "DELETE", prefix, handler }),
  };
  const ctx = {
    state: { repoRoot: REPO_ROOT, eventStore: null },
    remoteGates,
    json(response, status, payload) { response.status = status; response.payload = payload; },
    async body() { return {}; },
  };
  registerPtyRoutes(router, ctx);
  assert.ok(remoteGates.list().find((gate) => gate.id === "pty").implemented);

  const dispatch = async (method, path) => {
    const url = new URL(path, "http://localhost");
    for (const route of routes) {
      if (route.method !== method || !url.pathname.startsWith(route.prefix)) continue;
      const response = {};
      if (await route.handler({}, response, url, ctx)) return response;
    }
    return null;
  };

  // 无 grant：501 BLOCKED
  let response = await dispatch("POST", "/api/pty");
  assert.equal(response.status, 501);
  assert.equal(response.payload.code, "REMOTE_GATE_BLOCKED");

  // 授权后：创建 → 列表 → 删除
  await remoteGates.grant("pty", { source: "test" });
  response = await dispatch("POST", "/api/pty");
  assert.equal(response.status, 201);
  const id = response.payload.session.id;
  response = await dispatch("GET", "/api/pty");
  assert.ok(response.payload.sessions.some((entry) => entry.id === id));
  response = await dispatch("DELETE", `/api/pty/${id}`);
  assert.equal(response.status, 200);
});

test("pty: create passes args/title through, sanitizes honestly", () => {
  const calls = [];
  const fakeProc = { pid: 4242, onData() {}, onExit() {}, write() {}, resize() {}, kill() {} };
  const service = createPtyService({
    repoRoot: REPO_ROOT,
    spawnImpl: (command, args, options) => { calls.push({ command, args, options }); return fakeProc; },
  });
  const session = service.create({ shell: "ssh.exe", args: ["-tt", "-p", "51451", "u@h"], title: "lanniny-45 · /srv/data" });
  assert.equal(calls[0].command, "ssh.exe");
  assert.deepEqual(calls[0].args, ["-tt", "-p", "51451", "u@h"]);
  assert.equal(session.title, "lanniny-45 · /srv/data");
  assert.equal(service.list()[0].title, "lanniny-45 · /srv/data");
  // 元素 String 化；title 去 NUL/trim 并截断 120
  const second = service.create({ shell: "cmd.exe", args: [1, 2], title: `  ab\0${"x".repeat(200)}  ` });
  assert.deepEqual(calls[1].args, ["1", "2"]);
  assert.equal(second.title.length, 120);
  // 非数组 / NUL / 超帽：如实 400，不静默截断
  assert.throws(() => service.create({ args: "-tt" }), { code: "PTY_BAD_ARGS" });
  assert.throws(() => service.create({ args: ["a\0b"] }), { code: "PTY_BAD_ARGS" });
  assert.throws(() => service.create({ args: Array(33).fill("x") }), { code: "PTY_BAD_ARGS" });
  assert.throws(() => service.create({ args: ["x".repeat(4097)] }), { code: "PTY_BAD_ARGS" });
  service.closeAll();
});

test("pty routes: buildSshPtyArgs assembles openssh client argv", () => {
  const host = { name: "lanniny-45", host: "45.205.25.155", port: 51451, user: "lanniny", identityFile: "C:/Users/me/.ssh/ssh" };
  const full = buildSshPtyArgs(host, "/srv/data");
  assert.deepEqual(full.slice(0, 3), ["-tt", "-p", "51451"]);
  assert.equal(full[3], "-i");
  assert.equal(full[4], "C:/Users/me/.ssh/ssh");
  assert.equal(full[5], "lanniny@45.205.25.155");
  assert.equal(full[6], "cd '/srv/data' && exec $SHELL -l");
  // 单引号按 shell 惯例转义
  const tricky = buildSshPtyArgs({ ...host, identityFile: null }, "/srv/it's");
  assert.equal(tricky.at(-1), "cd '/srv/it'\\''s' && exec $SHELL -l");
  // 空 path 不带远程命令；无 identityFile 不带 -i
  assert.deepEqual(
    buildSshPtyArgs({ ...host, identityFile: null }, ""),
    ["-tt", "-p", "51451", "lanniny@45.205.25.155"],
  );
  // %token 走 expandIdentityPath（%r=user）
  const token = buildSshPtyArgs({ ...host, identityFile: "~/.ssh/id_%r" }, "");
  const expanded = token[token.indexOf("-i") + 1];
  assert.ok(expanded.includes(".ssh") && expanded.endsWith("id_lanniny"), `identityFile expanded: ${expanded}`);
  assert.equal(sshShellCommand("win32"), "ssh.exe");
  assert.equal(sshShellCommand("linux"), "ssh");
});

test("pty routes: ssh branch spawns openssh terminal from ledger host", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-pty-ssh-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const remoteGates = await createRemoteGateService({ dataRoot: dir }).init();
  remoteGates.registerImplementation("ssh"); // 生产由 registerSshRoutes 声明；这里只借门闸语义

  const created = [];
  const fakePty = {
    create(payload) { created.push(payload); return { id: "abc123", shell: payload.shell, title: payload.title ?? null }; },
    list: () => [],
    get: () => null,
  };
  const ledger = [
    { id: "h1", name: "lanniny-45", host: "45.205.25.155", port: 51451, user: "lanniny", enabled: true, identityFile: null },
    { id: "h2", name: "off-host", host: "10.0.0.2", port: 22, user: "u", enabled: false, identityFile: null },
  ];
  setPtyServiceForTest(fakePty);
  setSshServiceForTest({ list: () => ledger });
  t.after(() => { setPtyServiceForTest(null); setSshServiceForTest(null); });

  const routes = [];
  const router = {
    get: (prefix, handler) => routes.push({ method: "GET", prefix, handler }),
    post: (prefix, handler) => routes.push({ method: "POST", prefix, handler }),
    delete: (prefix, handler) => routes.push({ method: "DELETE", prefix, handler }),
  };
  let nextBody = {};
  const ctx = {
    state: { repoRoot: REPO_ROOT, eventStore: null },
    remoteGates,
    json(response, status, payload) { response.status = status; response.payload = payload; },
    async body() { return nextBody; },
  };
  registerPtyRoutes(router, ctx);
  const dispatch = async (method, path) => {
    const url = new URL(path, "http://localhost");
    for (const route of routes) {
      if (route.method !== method || !url.pathname.startsWith(route.prefix)) continue;
      const response = {};
      if (await route.handler({}, response, url, ctx)) return response;
    }
    return null;
  };

  await remoteGates.grant("pty", { source: "test" });
  // ssh 门闸未授权：双门闸如实 501
  nextBody = { ssh: { hostId: "h1" } };
  let response = await dispatch("POST", "/api/pty");
  assert.equal(response.status, 501);
  assert.equal(response.payload.code, "REMOTE_GATE_BLOCKED");

  await remoteGates.grant("ssh", { source: "test" });
  // 未知主机 404 / 停用主机 409 / 坏路径 400
  nextBody = { ssh: { hostId: "nope" } };
  response = await dispatch("POST", "/api/pty");
  assert.equal(response.status, 404);
  assert.equal(response.payload.code, "SSH_HOST_NOT_FOUND");
  nextBody = { ssh: { hostId: "h2" } };
  response = await dispatch("POST", "/api/pty");
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, "SSH_HOST_DISABLED");
  nextBody = { ssh: { hostId: "h1", path: "/srv/bad\0path" } };
  response = await dispatch("POST", "/api/pty");
  assert.equal(response.status, 400);
  assert.equal(response.payload.code, "PTY_BAD_SSH_PATH");

  // 正常：create 收到 ssh 命令、组装好的 argv 与标题
  nextBody = { ssh: { hostId: "h1", path: "/srv/data" } };
  response = await dispatch("POST", "/api/pty");
  assert.equal(response.status, 201);
  assert.equal(created.length, 1);
  assert.equal(created[0].shell, sshShellCommand());
  assert.deepEqual(created[0].args, ["-tt", "-p", "51451", "lanniny@45.205.25.155", "cd '/srv/data' && exec $SHELL -l"]);
  assert.equal(created[0].title, "lanniny-45 · /srv/data");
  assert.equal(response.payload.session.title, "lanniny-45 · /srv/data");
  // 空 path 不带远程命令
  nextBody = { ssh: { hostId: "h1" } };
  response = await dispatch("POST", "/api/pty");
  assert.equal(response.status, 201);
  assert.deepEqual(created[1].args, ["-tt", "-p", "51451", "lanniny@45.205.25.155"]);
  assert.equal(created[1].title, "lanniny-45");
});

function createPtySession(service) {
  // 机制类用例（spawn/echo/写队列/resize/kill）显式用最轻的 shell：默认 shell 已改为 pwsh，
  // 它要加载用户 profile，往返会超时且与这些用例要验的东西无关。
  // 默认 shell 的选择逻辑由下方 "default shell prefers PowerShell" 纯函数用例覆盖。
  return service.create(isWin ? { shell: "cmd.exe" } : { shell: "sh" });
}

// LO 2026-08-08：终端要和本机 PowerShell 一致，而不是 cmd。
// Windows 依次探测 pwsh → powershell → COMSPEC，只认 PATH 中真实存在的可执行文件。
test("pty: default shell prefers PowerShell on Windows and falls back honestly", () => {
  const dirs = { PATH: "C:/tools;C:/ps" };
  assert.equal(defaultShell("win32", dirs, (p) => p.endsWith("pwsh.exe")), join("C:/tools", "pwsh.exe"));
  assert.equal(
    defaultShell("win32", dirs, (p) => p.endsWith("powershell.exe")),
    join("C:/tools", "powershell.exe"),
  );
  // pwsh 优先于 powershell：两者都在时必须选 7.x
  assert.equal(defaultShell("win32", dirs, () => true), join("C:/tools", "pwsh.exe"));
  // 探测不到就老实回落，不猜路径
  assert.equal(defaultShell("win32", { PATH: "C:/tools", COMSPEC: "C:/W/cmd.exe" }, () => false), "C:/W/cmd.exe");
  assert.equal(defaultShell("win32", {}, () => false), "cmd.exe");
  // 存在性探测抛错（不可读目录）不得当作命中
  assert.equal(defaultShell("win32", { PATH: "C:/tools", COMSPEC: "C:/W/cmd.exe" }, () => { throw new Error("EACCES"); }), "C:/W/cmd.exe");
  assert.equal(defaultShell("linux", { SHELL: "/bin/zsh" }, () => false), "/bin/zsh");
  assert.equal(defaultShell("linux", {}, () => false), "sh");
});
