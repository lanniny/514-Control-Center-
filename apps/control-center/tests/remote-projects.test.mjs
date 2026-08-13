/**
 * remote-projects 契约测试：远程项目台账 service（校验/持久化/去重/hostMissing）+ 路由状态码。
 * 不连网：sshService 用假台账；路由用收集式假 router（同 pty 测试范式）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRemoteProjectsService, sanitizeRemotePath } from "../src/remote-projects.mjs";
import { registerRemoteProjectRoutes, setRemoteProjectGraphForTest, setRemoteProjectsServiceForTest } from "../src/remote-projects/routes.mjs";
import { setSshServiceForTest } from "../src/ssh/routes.mjs";

const LEDGER = [
  { id: "h1", name: "lanniny-45", host: "45.205.25.155", port: 51451, user: "lanniny", enabled: true, trusted: true },
  { id: "h2", name: "off-host", host: "10.0.0.2", port: 22, user: "u", enabled: false, trusted: false },
];

function fakeSsh(hosts = LEDGER) {
  return { list: () => hosts };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("sanitizeRemotePath: POSIX 绝对路径语义", () => {
  assert.equal(sanitizeRemotePath("/home/lo/proj"), "/home/lo/proj");
  assert.equal(sanitizeRemotePath("  /srv/data  "), "/srv/data");
  assert.throws(() => sanitizeRemotePath(""), /INVALID_REMOTE_PATH|required/);
  assert.throws(() => sanitizeRemotePath("home/lo"), /POSIX absolute/);
  assert.throws(() => sanitizeRemotePath("C:\\lo"), /POSIX absolute/);
  assert.throws(() => sanitizeRemotePath("/home/\0x"), /required/);
  assert.throws(() => sanitizeRemotePath("/home/../etc"), /\.\./);
  assert.throws(() => sanitizeRemotePath(`/${"a".repeat(500)}`), /too long/);
});

test("remote-projects service: 校验 / 持久化 / 去重 / hostMissing", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-projects-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = createRemoteProjectsService({ dataRoot: dir, sshService: fakeSsh() });

  // 校验链：无名 → 未知主机 → 停用主机 → 坏路径（按 error.code 断言，message 不含 code 串）
  await assert.rejects(() => service.create({ name: "", hostId: "h1", path: "/srv/data" }), { code: "INVALID_REMOTE_PROJECT" });
  await assert.rejects(() => service.create({ name: "x", hostId: "nope", path: "/srv/data" }), { code: "REMOTE_HOST_NOT_FOUND" });
  await assert.rejects(() => service.create({ name: "x", hostId: "h2", path: "/srv/data" }), { code: "REMOTE_HOST_DISABLED" });
  await assert.rejects(() => service.create({ name: "x", hostId: "h1", path: "srv/data" }), { code: "INVALID_REMOTE_PATH" });

  const created = await service.create({ name: "new-api", hostId: "h1", path: "/home/lanniny/new-api" });
  assert.match(created.id, /^rp-/);
  assert.equal(created.hostMissing, false);
  assert.equal(created.host.name, "lanniny-45");
  assert.equal(created.host.trusted, true);

  // 同 hostId+path 去重 409
  await assert.rejects(
    () => service.create({ name: "dup", hostId: "h1", path: "/home/lanniny/new-api" }),
    { code: "REMOTE_PROJECT_EXISTS" },
  );

  // 持久化：磁盘 schema + 新实例回放
  const onDisk = JSON.parse(await readFile(join(dir, "remote-projects.json"), "utf8"));
  assert.equal(onDisk.schema, "514cc.remote-projects/v1");
  assert.equal(onDisk.records.length, 1);
  const replayed = createRemoteProjectsService({ dataRoot: dir, sshService: fakeSsh() });
  assert.equal((await replayed.list()).length, 1);
  assert.equal((await replayed.get(created.id))?.path, "/home/lanniny/new-api");
  assert.equal(await replayed.get("missing"), null);

  // 主机从台账消失：如实 hostMissing，不静默删记录
  const orphaned = createRemoteProjectsService({ dataRoot: dir, sshService: fakeSsh([]) });
  const [record] = await orphaned.list();
  assert.equal(record.hostMissing, true);
  assert.equal(record.host, null);

  // remove：存在 200 语义 true，不存在 false
  assert.equal(await replayed.remove(created.id), true);
  assert.equal(await replayed.remove(created.id), false);
});

test("remote-projects service: Promise.all 并发 create 串行提交且使用唯一临时文件", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-projects-concurrent-create-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tempPaths = [];
  const service = createRemoteProjectsService({
    dataRoot: dir,
    sshService: fakeSsh(),
    fileSystem: {
      async writeFile(path, ...args) {
        tempPaths.push(path);
        return writeFile(path, ...args);
      },
    },
  });

  const created = await Promise.all(
    Array.from({ length: 12 }, (_, index) => service.create({
      name: `project-${index}`,
      hostId: "h1",
      path: `/srv/project-${index}`,
    })),
  );

  assert.equal(new Set(created.map((project) => project.id)).size, 12);
  assert.equal(tempPaths.length, 12);
  assert.equal(new Set(tempPaths).size, 12);
  assert.ok(tempPaths.every((path) => path.endsWith(".tmp")));
  assert.equal((await service.list()).length, 12);

  const replayed = createRemoteProjectsService({ dataRoot: dir, sshService: fakeSsh() });
  assert.deepEqual(
    (await replayed.list()).map((project) => project.path).sort(),
    created.map((project) => project.path).sort(),
  );

  const duplicateResults = await Promise.allSettled([
    service.create({ name: "duplicate-a", hostId: "h1", path: "/srv/shared" }),
    service.create({ name: "duplicate-b", hostId: "h1", path: "/srv/shared" }),
  ]);
  assert.equal(duplicateResults.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(duplicateResults.filter(({ status }) => status === "rejected").length, 1);
  assert.equal(duplicateResults.find(({ status }) => status === "rejected")?.reason.code, "REMOTE_PROJECT_EXISTS");
  assert.equal((await service.list()).filter((project) => project.path === "/srv/shared").length, 1);
});

test("remote-projects service: 并发 create/remove 基于最后提交状态生成下一快照", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-projects-create-remove-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = createRemoteProjectsService({ dataRoot: dir, sshService: fakeSsh() });
  const oldProject = await service.create({ name: "old", hostId: "h1", path: "/srv/old" });

  const [newProject, removed] = await Promise.all([
    service.create({ name: "new", hostId: "h1", path: "/srv/new" }),
    service.remove(oldProject.id),
  ]);

  assert.equal(removed, true);
  assert.deepEqual((await service.list()).map((project) => project.id), [newProject.id]);
  const replayed = createRemoteProjectsService({ dataRoot: dir, sshService: fakeSsh() });
  assert.deepEqual((await replayed.list()).map((project) => project.id), [newProject.id]);
});

test("remote-projects service: rename 提交前不发布内存且后续写不得进入持久化", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-projects-commit-point-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const firstRenameEntered = deferred();
  const releaseFirstRename = deferred();
  let renameCalls = 0;
  const service = createRemoteProjectsService({
    dataRoot: dir,
    sshService: fakeSsh(),
    fileSystem: {
      async rename(source, target) {
        renameCalls += 1;
        if (renameCalls === 1) {
          firstRenameEntered.resolve();
          await releaseFirstRename.promise;
        }
        return rename(source, target);
      },
    },
  });

  const first = service.create({ name: "first", hostId: "h1", path: "/srv/first" });
  await firstRenameEntered.promise;
  const second = service.create({ name: "second", hostId: "h1", path: "/srv/second" });
  await Promise.resolve();

  assert.equal(renameCalls, 1);
  assert.deepEqual(await service.list(), []);

  releaseFirstRename.resolve();
  await Promise.all([first, second]);
  assert.equal(renameCalls, 2);
  assert.deepEqual((await service.list()).map((project) => project.path), ["/srv/first", "/srv/second"]);
});

test("remote-projects service: rename 失败不发布幽灵状态，写链可恢复且重启回读一致", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-projects-failed-persist-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const baseline = createRemoteProjectsService({ dataRoot: dir, sshService: fakeSsh() });
  const committed = await baseline.create({ name: "committed", hostId: "h1", path: "/srv/committed" });
  let failNextRename = true;
  const service = createRemoteProjectsService({
    dataRoot: dir,
    sshService: fakeSsh(),
    fileSystem: {
      async rename(source, target) {
        if (failNextRename) {
          failNextRename = false;
          throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
        }
        return rename(source, target);
      },
    },
  });

  await assert.rejects(
    () => service.create({ name: "ghost", hostId: "h1", path: "/srv/ghost" }),
    { code: "EIO" },
  );
  assert.deepEqual((await service.list()).map((project) => project.id), [committed.id]);
  assert.equal((await readdir(dir)).some((name) => name.endsWith(".tmp")), false);

  const restartedAfterFailure = createRemoteProjectsService({ dataRoot: dir, sshService: fakeSsh() });
  assert.deepEqual((await restartedAfterFailure.list()).map((project) => project.id), [committed.id]);

  const recovered = await service.create({ name: "recovered", hostId: "h1", path: "/srv/recovered" });
  failNextRename = true;
  await assert.rejects(() => service.remove(committed.id), { code: "EIO" });
  assert.deepEqual(
    (await service.list()).map((project) => project.id),
    [committed.id, recovered.id],
  );

  const restartedAfterRecovery = createRemoteProjectsService({ dataRoot: dir, sshService: fakeSsh() });
  assert.deepEqual(
    (await restartedAfterRecovery.list()).map((project) => project.id),
    [committed.id, recovered.id],
  );
});

test("remote-projects service: 损坏或不兼容台账 fail-closed 且不覆盖原文件", async (t) => {
  const cases = [
    ["invalid-json", "{not-json"],
    ["unsupported-schema", JSON.stringify({ schema: "514cc.remote-projects/v2", records: [] })],
    ["invalid-records", JSON.stringify({ schema: "514cc.remote-projects/v1", records: {} })],
    ["invalid-record", JSON.stringify({ schema: "514cc.remote-projects/v1", records: [{ id: "rp-bad" }] })],
  ];

  for (const [name, original] of cases) {
    await t.test(name, async (t) => {
      const dir = await mkdtemp(join(tmpdir(), `514cc-remote-projects-${name}-`));
      t.after(() => rm(dir, { recursive: true, force: true }));
      const ledgerPath = join(dir, "remote-projects.json");
      await writeFile(ledgerPath, original, "utf8");
      const service = createRemoteProjectsService({ dataRoot: dir, sshService: fakeSsh() });

      await assert.rejects(
        () => service.create({ name: "must-not-clobber", hostId: "h1", path: "/srv/must-not-clobber" }),
        { code: "REMOTE_PROJECT_LEDGER_INVALID", httpStatus: 500 },
      );
      assert.equal(await readFile(ledgerPath, "utf8"), original);
      assert.deepEqual(await readdir(dir), ["remote-projects.json"]);
    });
  }
});

test("remote-projects graph routes: 项目 id 服务端解析 host/path，ssh+sftp 双门闸", async (t) => {
  const calls = [];
  const granted = new Set();
  setRemoteProjectsServiceForTest({
    async get(id) {
      return id === "rp-one"
        ? { id, hostId: "h1", path: "/srv/new-api", hostMissing: false, host: { id: "h1", name: "server", enabled: true } }
        : null;
    },
  });
  setRemoteProjectGraphForTest({
    async graph(hostId, options) { calls.push(["graph", hostId, options]); return { project: { path: options.projectPath }, providers: [], capabilities: [], mcp: [], sources: [] }; },
    async readSource(hostId, fileId, options) { calls.push(["source", hostId, fileId, options]); return { id: fileId, exists: true, content: "ok" }; },
    async readBackup(hostId, fileId, name, options) { calls.push(["backup", hostId, fileId, name, options]); return { id: fileId, name, content: "old", restorable: true }; },
  });
  t.after(() => { setRemoteProjectsServiceForTest(null); setRemoteProjectGraphForTest(null); });

  const routes = [];
  const router = {
    get: (prefix, handler) => routes.push({ method: "GET", prefix, handler }),
    post: (prefix, handler) => routes.push({ method: "POST", prefix, handler }),
    delete: (prefix, handler) => routes.push({ method: "DELETE", prefix, handler }),
  };
  const ctx = {
    state: { dataRoot: "unused" },
    remoteGates: {
      assert(gate) {
        if (!granted.has(gate)) throw Object.assign(new Error(`blocked: ${gate}`), { code: "REMOTE_GATE_BLOCKED", httpStatus: 501 });
      },
    },
    json(response, status, payload) { response.status = status; response.payload = payload; },
    async body() { return {}; },
  };
  registerRemoteProjectRoutes(router, ctx);
  const dispatch = async (path) => {
    const url = new URL(path, "http://localhost");
    const response = {};
    await routes.find((route) => route.method === "GET")?.handler({}, response, url, ctx);
    return response;
  };

  let response = await dispatch("/api/remote-projects/rp-one/graph");
  assert.equal(response.status, 501);
  granted.add("ssh");
  response = await dispatch("/api/remote-projects/rp-one/graph");
  assert.equal(response.status, 501);
  granted.add("sftp");
  response = await dispatch("/api/remote-projects/rp-one/graph");
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), ["graph", "h1", { projectPath: "/srv/new-api" }]);
  response = await dispatch("/api/remote-projects/rp-one/graph/source?file=project-agents");
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), ["source", "h1", "project-agents", { projectPath: "/srv/new-api" }]);
  // 备份读取同样只收 project id + 备份名：host/path 由服务端台账解析，客户端给不出远端路径
  response = await dispatch("/api/remote-projects/rp-one/graph/backup?file=project-agents&name=AGENTS.md.514forge-backup-2f8c1d90");
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), ["backup", "h1", "project-agents", "AGENTS.md.514forge-backup-2f8c1d90", { projectPath: "/srv/new-api" }]);
  response = await dispatch("/api/remote-projects/missing/graph");
  assert.equal(response.status, 404);
  assert.equal(response.payload.code, "REMOTE_PROJECT_NOT_FOUND");
  response = await dispatch("/api/remote-projects/missing/graph/backup?file=project-agents&name=AGENTS.md.514forge-backup-2f8c1d90");
  assert.equal(response.status, 404);
  assert.equal(response.payload.code, "REMOTE_PROJECT_NOT_FOUND");
});

test("remote-projects routes: 状态码契约", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-projects-routes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  setSshServiceForTest(fakeSsh());
  setRemoteProjectsServiceForTest(null);
  t.after(() => { setSshServiceForTest(null); setRemoteProjectsServiceForTest(null); });

  const routes = [];
  const router = {
    get: (prefix, handler) => routes.push({ method: "GET", prefix, handler }),
    post: (prefix, handler) => routes.push({ method: "POST", prefix, handler }),
    delete: (prefix, handler) => routes.push({ method: "DELETE", prefix, handler }),
  };
  let nextBody = {};
  const ctx = {
    state: { dataRoot: dir, eventStore: null },
    json(response, status, payload) { response.status = status; response.payload = payload; },
    async body() { return nextBody; },
  };
  registerRemoteProjectRoutes(router, ctx);
  const dispatch = async (method, path) => {
    const url = new URL(path, "http://localhost");
    for (const route of routes) {
      if (route.method !== method || !url.pathname.startsWith(route.prefix)) continue;
      const response = {};
      if (await route.handler({}, response, url, ctx)) return response;
    }
    return null;
  };

  // GET 空台账
  let response = await dispatch("GET", "/api/remote-projects");
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload.projects, []);

  // POST 校验错：400/404/409
  nextBody = { name: "", hostId: "h1", path: "/srv/data" };
  response = await dispatch("POST", "/api/remote-projects");
  assert.equal(response.status, 400);
  assert.equal(response.payload.code, "INVALID_REMOTE_PROJECT");
  nextBody = { name: "x", hostId: "nope", path: "/srv/data" };
  response = await dispatch("POST", "/api/remote-projects");
  assert.equal(response.status, 404);
  assert.equal(response.payload.code, "REMOTE_HOST_NOT_FOUND");
  nextBody = { name: "x", hostId: "h2", path: "/srv/data" };
  response = await dispatch("POST", "/api/remote-projects");
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, "REMOTE_HOST_DISABLED");

  // POST 正常 → 201 + join 主机公开信息（无凭据字段）
  nextBody = { name: "new-api", hostId: "h1", path: "/home/lanniny/new-api" };
  response = await dispatch("POST", "/api/remote-projects");
  assert.equal(response.status, 201);
  const project = response.payload.project;
  assert.equal(project.host.name, "lanniny-45");
  assert.ok(!("auth" in project.host) && !("authRef" in project.host));
  assert.ok(!JSON.stringify(project).includes("password"));

  // GET 列表回读
  response = await dispatch("GET", "/api/remote-projects");
  assert.equal(response.payload.projects.length, 1);

  // DELETE：200 → 404
  response = await dispatch("DELETE", `/api/remote-projects/${project.id}`);
  assert.equal(response.status, 200);
  response = await dispatch("DELETE", `/api/remote-projects/${project.id}`);
  assert.equal(response.status, 404);
  assert.equal(response.payload.code, "REMOTE_PROJECT_NOT_FOUND");
});
