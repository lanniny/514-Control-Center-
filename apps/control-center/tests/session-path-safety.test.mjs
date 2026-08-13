import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionAggregator, normalizeCwdKey } from "../src/sessions.mjs";
import { normalizePathKey } from "../public/path-key.js";

async function writeRollouts(dir, entries) {
  await mkdir(dir, { recursive: true });
  for (let offset = 0; offset < entries.length; offset += 64) {
    await Promise.all(entries.slice(offset, offset + 64).map(({ id, cwd }) =>
      writeFile(
        join(dir, `${id}.jsonl`),
        `${JSON.stringify({ type: "session_meta", payload: { id, cwd, originator: "codex_cli_rs" } })}\n`,
        "utf8",
      )));
  }
}

test("cwd keys normalize Windows drive/UNC paths without folding POSIX case or backslashes", async () => {
  assert.equal(normalizeCwdKey, normalizePathKey, "backend and browser must share one path identity function");
  assert.equal(normalizeCwdKey("C:/Work/Project/"), "c:\\work\\project");
  assert.equal(normalizeCwdKey("c:\\work\\project"), "c:\\work\\project");
  assert.equal(normalizeCwdKey("//Server/Share/Project/"), "\\\\server\\share\\project");
  assert.equal(normalizeCwdKey("\\\\server\\share\\project"), "\\\\server\\share\\project");
  assert.notEqual(normalizeCwdKey("/tmp/Project"), normalizeCwdKey("/tmp/project"));
  assert.notEqual(normalizeCwdKey(String.raw`/tmp/name\literal`), normalizeCwdKey("/tmp/name/literal"));

  const root = await mkdtemp(join(tmpdir(), "514cc-cwd-key-"));
  const home = join(root, "home");
  const codexDir = join(home, ".codex", "sessions", "2026", "07", "23");
  try {
    await writeRollouts(codexDir, [
      { id: "drive-upper", cwd: "C:\\Work\\Project" },
      { id: "drive-lower", cwd: "c:/work/project/" },
      { id: "unc-upper", cwd: "\\\\Server\\Share\\Project" },
      { id: "unc-lower", cwd: "//server/share/project/" },
      { id: "posix-upper", cwd: "/tmp/Project" },
      { id: "posix-lower", cwd: "/tmp/project" },
      { id: "posix-backslash", cwd: String.raw`/tmp/name\literal` },
      { id: "posix-slash", cwd: "/tmp/name/literal" },
    ]);
    const result = await new SessionAggregator({ home, aiSharedRoot: join(root, ".ai-shared"), projectSnapshotTtlMs: 0 })
      .projects({ perProjectLimit: 20 });
    const projectFor = (id) => result.projects.find((project) => project.sessions.some((session) => session.id === id));

    assert.equal(projectFor("drive-upper")?.id, projectFor("drive-lower")?.id, "Windows drive variants merge");
    assert.equal(projectFor("unc-upper")?.id, projectFor("unc-lower")?.id, "UNC variants merge");
    assert.notEqual(projectFor("posix-upper")?.id, projectFor("posix-lower")?.id, "POSIX case remains significant");
    assert.notEqual(projectFor("posix-backslash")?.id, projectFor("posix-slash")?.id, "POSIX backslash remains literal");
    assert.equal(result.projects.length, 6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deleteProjectSessions scans beyond 1000 and reports unsupported project sources explicitly", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "514cc-delete-boundary-"));
  const home = join(root, "home");
  const trashRoot = join(root, "trash");
  const codexDir = join(home, ".codex", "sessions", "2026", "07", "23");
  const targetCount = 1001;
  try {
    await writeRollouts(codexDir, [
      ...Array.from({ length: targetCount }, (_, index) => ({
        id: `target-${String(index).padStart(4, "0")}`,
        cwd: "/tmp/Project",
      })),
      { id: "keep-posix-case", cwd: "/tmp/project" },
      { id: "keep-posix-backslash", cwd: String.raw`/tmp/Project\child` },
    ]);

    const result = await new SessionAggregator({ home, aiSharedRoot: join(root, ".ai-shared") })
      .deleteProjectSessions({ project: "codex-only", path: "/tmp/Project", trashRoot });
    const sources = Object.fromEntries(result.sources.map((source) => [source.source, source]));

    assert.equal(result.codexRemoved, targetCount);
    assert.deepEqual(sources.codex, {
      source: "codex",
      supported: true,
      removed: targetCount,
      remaining: 0,
      limited: false,
      limitations: [],
    });
    assert.deepEqual(sources.claude, {
      source: "claude",
      supported: true,
      removed: 0,
      remaining: 0,
      limited: false,
      limitations: [],
    });
    for (const source of ["cursor", "kimi", "pi"]) {
      const status = sources[source];
      assert.equal(status.supported, false, `${source} must not inherit Claude/Codex deletion support`);
      assert.equal(status.removed, 0);
      assert.equal(status.remaining, null, "unsupported storage must not claim zero remaining sessions");
      assert.equal(status.limited, true);
      assert.ok(status.limitations.length > 0);
    }

    assert.deepEqual((await readdir(codexDir)).sort(), ["keep-posix-backslash.jsonl", "keep-posix-case.jsonl"]);
    assert.equal((await readdir(join(result.trash, "codex", "2026", "07", "23"))).length, targetCount);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deleteProjectSessions marks unreadable Codex ownership as limited instead of claiming zero remaining", async () => {
  const root = await mkdtemp(join(tmpdir(), "514cc-delete-unknown-"));
  const home = join(root, "home");
  const codexDir = join(home, ".codex", "sessions", "2026", "07", "23");
  try {
    await mkdir(codexDir, { recursive: true });
    await writeFile(join(codexDir, "missing-meta.jsonl"), "{}\n", "utf8");
    const result = await new SessionAggregator({ home, aiSharedRoot: join(root, ".ai-shared") })
      .deleteProjectSessions({ project: "codex-only", path: "/tmp/Project", trashRoot: join(root, "trash") });
    const codex = result.sources.find((source) => source.source === "codex");

    assert.equal(codex.supported, true);
    assert.equal(codex.removed, 0);
    assert.equal(codex.remaining, null);
    assert.equal(codex.limited, true);
    assert.match(codex.limitations.join("\n"), /could not be inspected.*remaining is unknown/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
