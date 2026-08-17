import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FRAMEWORK_IDS, SCAFFOLD_FILES, expandRemoteDir, scaffoldProject, scaffoldRemoteProject } from "../src/bootstrap.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

async function seedHome(t) {
  const home = await mkdtemp(resolve(appRoot, ".test-bootstrap-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

const baseInput = { framework: "vanilla", style: "minimal", theme: "dark", iconLibrary: "lucide", font: "system", name: "示例项目" };

test("scaffold dryRun plans files without writing anything", async (t) => {
  const home = await seedHome(t);
  const dir = join(home, "planned-app");
  const result = await scaffoldProject({ ...baseInput, dir, dryRun: true }, { homeDir: home, allowedRoots: [home] });
  assert.equal(result.ok, true);
  assert.equal(result.kind, "static-starter");
  assert.equal(result.targetDir, resolve(dir));
  assert.equal(result.fileCount, 5);
  assert.deepEqual(result.files.slice().sort(), [...SCAFFOLD_FILES].sort());
  assert.deepEqual(
    result.filesPlanned.map((path) => path.split(sep).pop()).sort(),
    [...SCAFFOLD_FILES].sort(),
  );
  assert.equal(result.filesWritten, undefined);
  assert.ok(result.log.length > 0);
  await assert.rejects(readdir(dir), { code: "ENOENT" }, "dryRun must not create the target dir");
});

test("scaffold real run writes the static starter reflecting the choices", async (t) => {
  const home = await seedHome(t);
  const dir = join(home, "real-app");
  const result = await scaffoldProject({
    ...baseInput,
    framework: "dashboard",
    style: "paper",
    font: "mono",
    description: "侧栏骨架给运营看",
    dir,
    dryRun: false,
  }, { homeDir: home, allowedRoots: [home] });
  assert.equal(result.ok, true);
  assert.equal(result.fileCount, 5);
  assert.equal(result.filesWritten.length, 5);
  const manifest = JSON.parse(await readFile(join(dir, "514.json"), "utf8"));
  assert.equal(manifest.name, "示例项目");
  assert.equal(manifest.framework, "dashboard");
  assert.equal(manifest.theme, "dark");
  assert.equal(manifest.style, "paper");
  assert.equal(manifest.description, "侧栏骨架给运营看");
  assert.match(manifest.fontStack, /monospace/i);
  const index = await readFile(join(dir, "index.html"), "utf8");
  assert.ok(index.includes('data-theme="dark"'));
  assert.ok(index.includes("./app.js"));
  assert.ok(index.includes("侧栏骨架给运营看"));
  const styles = await readFile(join(dir, "styles.css"), "utf8");
  assert.ok(styles.includes("oklch("));
  assert.ok(styles.includes("prefers-color-scheme"));
  assert.ok(styles.includes("oklch(0.97 0.012 75)"), "paper light token must land");
  assert.match(styles, /ui-monospace/);
  const readme = await readFile(join(dir, "README.md"), "utf8");
  assert.ok(readme.includes("静态 starter"));
  assert.ok(!readme.includes("npm install"));
  assert.ok(readme.includes("python -m http.server"));
  assert.equal(result.targetDir, resolve(dir));
});

test("scaffold rejects path escapes and outside-root dirs", async (t) => {
  const home = await seedHome(t);
  await assert.rejects(
    scaffoldProject({ ...baseInput, dir: join(home, "..", "..", "escape-app"), dryRun: true }, { homeDir: home, allowedRoots: [home] }),
    (error) => error.code === "PATH_BOUNDARY",
  );
  await assert.rejects(
    scaffoldProject({ ...baseInput, dir: resolve(appRoot, "..", "..", "outside-app"), dryRun: true }, { homeDir: home, allowedRoots: [home] }),
    (error) => error.code === "PATH_BOUNDARY",
  );
});

test("scaffold refuses a non-empty dir unless force, and validates name", async (t) => {
  const home = await seedHome(t);
  const dir = join(home, "occupied");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "keep.txt"), "existing\n", "utf8");
  await assert.rejects(
    scaffoldProject({ ...baseInput, dir, dryRun: false }, { homeDir: home, allowedRoots: [home] }),
    (error) => error.code === "VALIDATION_FAILED" && /not empty/.test(error.message),
  );
  const forced = await scaffoldProject({ ...baseInput, dir, dryRun: false, force: true }, { homeDir: home, allowedRoots: [home] });
  assert.equal(forced.ok, true);
  assert.equal((await readFile(join(dir, "keep.txt"), "utf8")), "existing\n");
  await assert.rejects(
    scaffoldProject({ dir, dryRun: true }, { homeDir: home, allowedRoots: [home] }),
    (error) => error.code === "VALIDATION_FAILED",
  );
});

test("scaffold falls back to vanilla on unknown framework and logs the decision", async (t) => {
  const home = await seedHome(t);
  const dir = join(home, "fallback-app");
  const result = await scaffoldProject({ ...baseInput, framework: "svelte", dir, dryRun: true }, { homeDir: home, allowedRoots: [home] });
  assert.ok(result.log.some((line) => line.includes("回退 vanilla")));
  assert.equal(result.framework, "vanilla");
});

test("unknown style and font fall back honestly", async (t) => {
  const home = await seedHome(t);
  const dir = join(home, "style-fallback");
  const result = await scaffoldProject({
    ...baseInput,
    style: "tailwind",
    font: "comic-sans",
    dir,
    dryRun: false,
  }, { homeDir: home, allowedRoots: [home] });
  assert.ok(result.log.some((line) => line.includes("回退 minimal")));
  assert.ok(result.log.some((line) => line.includes("回退 system")));
  const manifest = JSON.parse(await readFile(join(dir, "514.json"), "utf8"));
  assert.equal(manifest.style, "minimal");
  assert.equal(manifest.font, "system");
});

test("react flavor writes createCard and no JSX", async (t) => {
  const home = await seedHome(t);
  const dir = join(home, "react-app");
  await scaffoldProject({ ...baseInput, framework: "react", dir, dryRun: false }, { homeDir: home, allowedRoots: [home] });
  const app = await readFile(join(dir, "app.js"), "utf8");
  assert.ok(app.includes("function createCard"));
  assert.ok(!app.includes("ReactDOM"));
  assert.ok(!app.includes("from \"react\""));
});

test("custom font stacks are sanitized before landing in CSS", async (t) => {
  const home = await seedHome(t);
  const dir = join(home, "font-sanitize");
  await scaffoldProject({
    ...baseInput,
    font: "Foo, } body { background: url(https://evil.example)",
    dir,
    dryRun: false,
  }, { homeDir: home, allowedRoots: [home] });
  const styles = await readFile(join(dir, "styles.css"), "utf8");
  assert.ok(!styles.includes("url("));
  assert.ok(!styles.includes("} body"));
  assert.match(styles, /font-family: Foo/);
});

test("empty dir and ~ expand to home 514-projects, never a literal tilde folder", async (t) => {
  const home = await seedHome(t);
  const empty = await scaffoldProject({ ...baseInput, dir: "", dryRun: true }, { homeDir: home, allowedRoots: [home] });
  assert.equal(empty.targetDir, resolve(home, "514-projects", "示例项目"));
  const tilde = await scaffoldProject({ ...baseInput, name: "tilde-app", dir: "~/514-projects/tilde-app", dryRun: true }, { homeDir: home, allowedRoots: [home] });
  assert.equal(tilde.targetDir, resolve(home, "514-projects", "tilde-app"));
  assert.ok(!tilde.targetDir.includes(`${sep}~${sep}`));
});

test("exported framework ids stay the only real flavors", () => {
  assert.deepEqual([...FRAMEWORK_IDS], ["vanilla", "react", "dashboard"]);
});

function mockSsh({
  hosts = [{ id: "h1", name: "盒", host: "10.0.0.8", user: "lo", port: 22, enabled: true }],
  listing = [],
  listError = null,
} = {}) {
  const writes = [];
  const mkdirs = [];
  return {
    writes,
    mkdirs,
    list: () => hosts,
    assertSftpPathPublic(id, path) {
      if (id !== "h1") throw Object.assign(new Error(`host not found: ${id}`), { code: "SSH_NOT_FOUND", httpStatus: 404 });
      if (String(path).includes("..") || String(path).startsWith("/etc")) {
        throw Object.assign(new Error(`path escapes allowlist: ${path}`), { code: "SFTP_PATH_BOUNDARY", httpStatus: 403 });
      }
    },
    async sftpList(id, path) {
      if (listError) throw listError;
      return listing.map((name) => ({ name, isDirectory: false }));
    },
    async sftpEnsureDir(id, path) {
      mkdirs.push({ id, path });
      return { ok: true, path };
    },
    async sftpWrite(id, path, content) {
      writes.push({ id, path, content });
      return { ok: true, bytes: Buffer.byteLength(String(content)) };
    },
  };
}

test("expandRemoteDir maps ~ to the host home and keeps absolute POSIX paths", () => {
  const host = { user: "lo", host: "10.0.0.8" };
  assert.equal(expandRemoteDir("", host, "示例项目"), "/home/lo/514-projects/示例项目");
  assert.equal(expandRemoteDir("~", host, "x"), "/home/lo");
  assert.equal(expandRemoteDir("~/apps/demo", host, "x"), "/home/lo/apps/demo");
  assert.equal(expandRemoteDir("/srv/data/app", host, "x"), "/srv/data/app");
});

test("remote scaffold dryRun plans files without writing", async () => {
  const ssh = mockSsh();
  const result = await scaffoldRemoteProject({
    ...baseInput,
    hostId: "h1",
    dir: "/home/lo/514-projects/demo",
    dryRun: true,
  }, { ssh });
  assert.equal(result.ok, true);
  assert.equal(result.placement, "remote");
  assert.equal(result.hostId, "h1");
  assert.equal(result.targetDir, "/home/lo/514-projects/demo");
  assert.deepEqual(result.files.slice().sort(), [...SCAFFOLD_FILES].sort());
  assert.equal(result.filesWritten, undefined);
  assert.equal(ssh.writes.length, 0);
  assert.equal(ssh.mkdirs.length, 0);
});

test("remote scaffold write uses mkdir then five sftp writes", async () => {
  const ssh = mockSsh();
  const result = await scaffoldRemoteProject({
    ...baseInput,
    hostId: "h1",
    dir: "/home/lo/514-projects/demo",
    dryRun: false,
  }, { ssh });
  assert.equal(result.ok, true);
  assert.equal(result.placement, "remote");
  assert.equal(result.filesWritten.length, 5);
  assert.deepEqual(ssh.mkdirs, [{ id: "h1", path: "/home/lo/514-projects/demo" }]);
  assert.equal(ssh.writes.length, 5);
  assert.deepEqual(ssh.writes.map((entry) => entry.path.split("/").pop()).sort(), [...SCAFFOLD_FILES].sort());
  assert.ok(ssh.writes.every((entry) => entry.id === "h1"));
});

test("remote scaffold refuses missing host, escaped path, and occupied dir", async () => {
  const missing = mockSsh();
  await assert.rejects(
    scaffoldRemoteProject({ ...baseInput, hostId: "nope", dir: "/home/lo/x", dryRun: true }, { ssh: missing }),
    (error) => error.code === "SSH_NOT_FOUND",
  );
  const escaped = mockSsh();
  await assert.rejects(
    scaffoldRemoteProject({ ...baseInput, hostId: "h1", dir: "/etc/passwd", dryRun: true }, { ssh: escaped }),
    (error) => error.code === "SFTP_PATH_BOUNDARY",
  );
  const occupied = mockSsh({ listing: ["keep.txt"] });
  await assert.rejects(
    scaffoldRemoteProject({ ...baseInput, hostId: "h1", dir: "/home/lo/busy", dryRun: false }, { ssh: occupied }),
    (error) => error.code === "VALIDATION_FAILED" && /not empty/.test(error.message),
  );
  assert.equal(occupied.writes.length, 0);
  const forced = await scaffoldRemoteProject({
    ...baseInput,
    hostId: "h1",
    dir: "/home/lo/busy",
    dryRun: false,
    force: true,
  }, { ssh: occupied });
  assert.equal(forced.ok, true);
  assert.equal(occupied.writes.length, 5);
});

test("remote scaffold requires ssh and hostId", async () => {
  await assert.rejects(
    scaffoldRemoteProject({ ...baseInput, hostId: "h1", dryRun: true }, {}),
    (error) => error.code === "SSH_UNAVAILABLE",
  );
  const ssh = mockSsh();
  await assert.rejects(
    scaffoldRemoteProject({ ...baseInput, dryRun: true }, { ssh }),
    (error) => error.code === "VALIDATION_FAILED",
  );
});
