import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { scaffoldProject } from "../src/bootstrap.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

async function seedHome(t) {
  const home = await mkdtemp(resolve(appRoot, ".test-bootstrap-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

const baseInput = { framework: "vanilla", style: "minimal", theme: "dark", iconLibrary: "lucide", font: "system-ui", name: "示例项目" };

test("scaffold dryRun plans files without writing anything", async (t) => {
  const home = await seedHome(t);
  const dir = join(home, "planned-app");
  const result = await scaffoldProject({ ...baseInput, dir, dryRun: true }, { homeDir: home, allowedRoots: [home] });
  assert.equal(result.ok, true);
  assert.equal(result.targetDir, resolve(dir));
  assert.deepEqual(
    result.filesPlanned.map((path) => path.split(sep).pop()).sort(),
    ["514.json", "README.md", "app.js", "index.html", "styles.css"],
  );
  assert.ok(result.log.length > 0);
  await assert.rejects(readdir(dir), { code: "ENOENT" }, "dryRun must not create the target dir");
});

test("scaffold real run writes the static starter reflecting the choices", async (t) => {
  const home = await seedHome(t);
  const dir = join(home, "real-app");
  const result = await scaffoldProject({ ...baseInput, framework: "dashboard", dir, dryRun: false }, { homeDir: home, allowedRoots: [home] });
  assert.equal(result.ok, true);
  assert.equal(result.filesWritten, 5);
  const manifest = JSON.parse(await readFile(join(dir, "514.json"), "utf8"));
  assert.equal(manifest.name, "示例项目");
  assert.equal(manifest.framework, "dashboard");
  assert.equal(manifest.theme, "dark");
  const index = await readFile(join(dir, "index.html"), "utf8");
  assert.ok(index.includes('data-theme="dark"'));
  assert.ok(index.includes("./app.js"));
  const styles = await readFile(join(dir, "styles.css"), "utf8");
  assert.ok(styles.includes("oklch("));
  // 写盘是幂等可重现计划：dryRun 与实写同一 targetDir
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
});
