import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObservabilityService } from "../src/observability.mjs";
import { SessionAggregator } from "../src/sessions.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cc-obs-"));
  const aiShared = join(root, ".ai-shared");
  await mkdir(join(aiShared, "handoff"), { recursive: true });
  return { root, aiShared };
}

test("routeGate parses TSV rows and drops the truncated first line on tail reads", async () => {
  const { root, aiShared } = await fixture();
  try {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const lines = [
      "GARBAGE-TRUNCATED-HALF-ROW-no-tabs",
      `${now}\tRED\treview,security\t?\t评审安全改动`,
      `${now}\tgray\t-\t?\t普通问答`,
    ];
    await writeFile(join(aiShared, "route-gate.log"), lines.join("\n") + "\n", "utf8");
    const svc = new ObservabilityService({ aiSharedRoot: aiShared, repoRoot: root });
    const result = await svc.routeGate();
    assert.equal(result.available, true);
    assert.equal(result.red, 1);
    assert.equal(result.gray, 1);
    assert.equal(result.byReason.review, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deltaLedger double-scans decisions.md and handoff with score buckets", async () => {
  const { root, aiShared } = await fixture();
  try {
    await writeFile(join(aiShared, "decisions.md"), "prose\n__DELTA__: 烛 | 2 | 推翻主驾\nmore\n", "utf8");
    await writeFile(join(aiShared, "handoff", "codex-to-claude__x__1.md"), "body\n__DELTA__: 织 | 0 | 白发\n", "utf8");
    const svc = new ObservabilityService({ aiSharedRoot: aiShared, repoRoot: root });
    const ledger = await svc.deltaLedger();
    assert.equal(ledger.total, 2);
    assert.equal(ledger.byScore[2], 1);
    assert.equal(ledger.byScore[0], 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("handoffContent rejects traversal and non-md names", async () => {
  const { root, aiShared } = await fixture();
  try {
    await writeFile(join(aiShared, "handoff", "ok.md"), "hello", "utf8");
    const svc = new ObservabilityService({ aiSharedRoot: aiShared, repoRoot: root });
    assert.equal((await svc.handoffContent("ok.md")).content, "hello");
    await assert.rejects(() => svc.handoffContent("../secret.md"), { code: "VALIDATION_FAILED" });
    await assert.rejects(() => svc.handoffContent("ok.txt"), { code: "VALIDATION_FAILED" });
    await assert.rejects(() => svc.handoffContent("missing.md"), { code: "SOURCE_NOT_FOUND" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("summaries are omitted by default and only appear with opt-in", async () => {
  const { root, aiShared } = await fixture();
  const home = join(root, "home");
  try {
    const projectDir = join(home, ".claude", "projects", "demo");
    await mkdir(projectDir, { recursive: true });
    const event = { message: { role: "user", content: "普通任务描述" } };
    await writeFile(join(projectDir, "s.jsonl"), JSON.stringify(event) + "\n", "utf8");
    const agg = new SessionAggregator({ aiSharedRoot: aiShared, home });
    const off = (await agg.list()).sources.find((item) => item.source === "claude");
    assert.equal(off.sessions[0].summary, null, "summary must be null without opt-in");
    const on = (await agg.list({ includeSummaries: true })).sources.find((item) => item.source === "claude");
    assert.equal(on.sessions[0].summary, "普通任务描述");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("opt-in summaries redact both high-entropy and assignment-style secrets", async () => {
  const { root, aiShared } = await fixture();
  const home = join(root, "home");
  try {
    const projectDir = join(home, ".claude", "projects", "demo");
    await mkdir(projectDir, { recursive: true });
    const highEntropy = "sk-proj-ABCDEFGHIJKLMNOP1234567890";
    const assignment = "MyCompanySecret1234";
    const event = { message: { role: "user", content: `key ${highEntropy} 且 password=${assignment} 还有 token: abcdefghijklmnop` } };
    await writeFile(join(projectDir, "s.jsonl"), JSON.stringify(event) + "\n", "utf8");
    const agg = new SessionAggregator({ aiSharedRoot: aiShared, home });
    const claude = (await agg.list({ includeSummaries: true })).sources.find((item) => item.source === "claude");
    const summary = claude.sessions[0]?.summary ?? "";
    assert.ok(!summary.includes(highEntropy), "high-entropy secret must be redacted");
    assert.ok(!summary.includes(assignment), "assignment-style secret must be redacted");
    assert.ok(!summary.includes("abcdefghijklmnop"), "assignment token value must be redacted");
    assert.ok(summary.includes("[REDACTED]"), "redaction marker present");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("handoffContent rejects a symlink that escapes the handoff root", async (t) => {
  const { root, aiShared } = await fixture();
  try {
    const outside = join(root, "outside-secret.md");
    await writeFile(outside, "SENSITIVE OUTSIDE CONTENT", "utf8");
    let symlinkWorks = true;
    try {
      await symlink(outside, join(aiShared, "handoff", "escape.md"));
    } catch {
      symlinkWorks = false;
    }
    if (!symlinkWorks) return t.skip("symlink 无权限（Windows 非 Developer Mode）——显式跳过而非假通过"); // 烛 R7
    const svc = new ObservabilityService({ aiSharedRoot: aiShared, repoRoot: root });
    await assert.rejects(() => svc.handoffContent("escape.md"), { code: "VALIDATION_FAILED" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tailText drops the truncated first line on large files (start>0 branch)", async () => {
  const { root, aiShared } = await fixture();
  try {
    // 首行超过 256KB 尾读窗口 → start>0，首行必被截断，routeGate 应只见完整的 RED 行
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const hugeFirst = "X".repeat(300 * 1024);
    const content = `${hugeFirst}\n${now}\tRED\treview\t?\t真实评审\n`;
    await writeFile(join(aiShared, "route-gate.log"), content, "utf8");
    const svc = new ObservabilityService({ aiSharedRoot: aiShared, repoRoot: root });
    const result = await svc.routeGate();
    assert.equal(result.red, 1, "the complete RED row survives");
    assert.equal(result.total, 1, "the truncated huge first line is discarded, not miscounted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function projectFixture(home, dirName, files) {
  const projectDir = join(home, ".claude", "projects", dirName);
  await mkdir(projectDir, { recursive: true });
  for (const [name, lines] of Object.entries(files)) {
    await writeFile(join(projectDir, name), lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
  }
  return projectDir;
}

test("projects groups sessions per project, restores cwd label and sorts by recency", async () => {
  const { root, aiShared } = await fixture();
  const home = join(root, "home");
  try {
    await projectFixture(home, "I--demo-alpha", {
      "s1.jsonl": [{ type: "user", cwd: "I:\\demo\\alpha", message: { role: "user", content: "旧项目任务" } }],
    });
    await projectFixture(home, "I--demo-beta", {
      "s2.jsonl": [{ type: "user", cwd: "I:\\demo\\beta", message: { role: "user", content: "新项目任务" } }],
    });
    // beta 更新（写入顺序已保证 beta 的 mtime >= alpha；再显式触碰确保排序确定）
    const { utimes } = await import("node:fs/promises");
    const now = Date.now();
    await utimes(join(home, ".claude", "projects", "I--demo-alpha", "s1.jsonl"), new Date(now - 60_000), new Date(now - 60_000));
    await utimes(join(home, ".claude", "projects", "I--demo-beta", "s2.jsonl"), new Date(now), new Date(now));
    const agg = new SessionAggregator({ aiSharedRoot: aiShared, home });
    const result = await agg.projects({ includeSummaries: true });
    assert.equal(result.available, true);
    assert.equal(result.projects.length, 2);
    assert.equal(result.projects[0].label, "beta", "newest project first, label from cwd basename");
    assert.equal(result.projects[0].path, "I:\\demo\\beta");
    assert.equal(result.projects[1].label, "alpha");
    assert.equal(result.projects[0].sessions[0].summary, "新项目任务");
    const noSummaries = await agg.projects();
    assert.equal(noSummaries.projects[0].sessions[0].summary, null, "summaries stay opt-in");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("projects falls back to directory name without cwd and honours perProjectLimit", async () => {
  const { root, aiShared } = await fixture();
  const home = join(root, "home");
  try {
    const files = {};
    for (let i = 0; i < 5; i += 1) files[`s${i}.jsonl`] = [{ message: { role: "user", content: `任务 ${i}` } }];
    await projectFixture(home, "no-cwd-project", files);
    const agg = new SessionAggregator({ aiSharedRoot: aiShared, home });
    const result = await agg.projects({ perProjectLimit: 3 });
    assert.equal(result.projects[0].label, "no-cwd-project");
    assert.equal(result.projects[0].path, null);
    assert.equal(result.projects[0].sessionCount, 5, "sessionCount reflects all files");
    assert.equal(result.projects[0].sessions.length, 3, "listed sessions capped by perProjectLimit");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview rejects traversal names, reserved device names and missing sessions", async () => {
  const { root, aiShared } = await fixture();
  const home = join(root, "home");
  try {
    await projectFixture(home, "demo", { "ok.jsonl": [{ message: { role: "user", content: "hi" } }] });
    const agg = new SessionAggregator({ aiSharedRoot: aiShared, home });
    await assert.rejects(() => agg.preview({ project: "..", id: "ok" }), { code: "VALIDATION_FAILED" });
    await assert.rejects(() => agg.preview({ project: "demo", id: "../../secret" }), { code: "VALIDATION_FAILED" });
    await assert.rejects(() => agg.preview({ project: "demo", id: "CON" }), { code: "VALIDATION_FAILED" });
    await assert.rejects(() => agg.preview({ project: "NUL", id: "ok" }), { code: "VALIDATION_FAILED" });
    await assert.rejects(() => agg.preview({ project: "demo", id: "trailing." }), { code: "VALIDATION_FAILED" });
    await assert.rejects(() => agg.preview({ project: "demo", id: "missing" }), { code: "SOURCE_NOT_FOUND" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("projects listing excludes symlinked sessions that escape the projects root", async (t) => {
  const { root, aiShared } = await fixture();
  const home = join(root, "home");
  try {
    await projectFixture(home, "demo", { "ok.jsonl": [{ message: { role: "user", content: "正常会话" } }] });
    const outside = join(root, "outside.jsonl");
    await writeFile(outside, JSON.stringify({ cwd: "X:\\secret", message: { role: "user", content: "根外内容" } }) + "\n", "utf8");
    let symlinkWorks = true;
    try {
      await symlink(outside, join(home, ".claude", "projects", "demo", "escape.jsonl"));
    } catch {
      symlinkWorks = false;
    }
    if (!symlinkWorks) return t.skip("symlink 无权限（Windows 非 Developer Mode）——显式跳过而非假通过"); // 烛 R7
    const agg = new SessionAggregator({ aiSharedRoot: aiShared, home });
    const grouped = await agg.projects({ includeSummaries: true });
    const ids = grouped.projects[0].sessions.map((session) => session.id);
    assert.ok(!ids.includes("escape"), "escaping symlink session is not listed");
    assert.ok(!JSON.stringify(grouped).includes("根外内容"), "escaping symlink content never read");
    const flat = (await agg.list({ includeSummaries: true })).sources.find((item) => item.source === "claude");
    assert.ok(!flat.sessions.some((session) => session.id === "escape"), "flat claude list applies the same containment");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview rejects a session symlink that escapes the projects root", async (t) => {
  const { root, aiShared } = await fixture();
  const home = join(root, "home");
  try {
    await projectFixture(home, "demo", { "ok.jsonl": [{ message: { role: "user", content: "hi" } }] });
    const outside = join(root, "outside.jsonl");
    await writeFile(outside, JSON.stringify({ message: { role: "user", content: "SENSITIVE" } }) + "\n", "utf8");
    let symlinkWorks = true;
    try {
      await symlink(outside, join(home, ".claude", "projects", "demo", "escape.jsonl"));
    } catch {
      symlinkWorks = false;
    }
    if (!symlinkWorks) return t.skip("symlink 无权限（Windows 非 Developer Mode）——显式跳过而非假通过"); // 烛 R7
    const agg = new SessionAggregator({ aiSharedRoot: aiShared, home });
    await assert.rejects(() => agg.preview({ project: "demo", id: "escape" }), { code: "VALIDATION_FAILED" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("summary scan skips an oversized first line and still finds the real user text", async () => {
  const { root, aiShared } = await fixture();
  const home = join(root, "home");
  try {
    const projectDir = join(home, ".claude", "projects", "demo");
    await mkdir(projectDir, { recursive: true });
    // 首行 >2MB 单行大事件（烛 R5 实测本机存在 522KB 单行）——固定窗口读法在这里必然扫空
    const hugeLine = JSON.stringify({ type: "big", blob: "X".repeat(2 * 1024 * 1024 + 100) });
    const realLine = JSON.stringify({ message: { role: "user", content: "真实任务描述" } });
    await writeFile(join(projectDir, "s.jsonl"), `${hugeLine}\n${realLine}\n`, "utf8");
    const agg = new SessionAggregator({ aiSharedRoot: aiShared, home });
    const grouped = await agg.projects({ includeSummaries: true });
    assert.equal(grouped.projects[0].sessions[0].summary, "真实任务描述");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview returns scrubbed user/assistant text and skips tool rows and sidechains", async () => {
  const { root, aiShared } = await fixture();
  const home = join(root, "home");
  try {
    await projectFixture(home, "demo", {
      "conv.jsonl": [
        { type: "mode", mode: "normal" },
        { message: { role: "user", content: "帮我修 bug，password=TopSecret99" }, timestamp: "2026-07-17T01:00:00Z" },
        { message: { role: "assistant", content: [{ type: "tool_use", name: "Bash" }] } },
        { message: { role: "user", content: [{ type: "tool_result", content: "sk-proj-SECRETSECRETSECRET123456" }] } },
        { isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: "侧链内容不应出现" }] } },
        { message: { role: "assistant", content: [{ type: "text", text: "已修复，token: abcdef123456789012" }] }, timestamp: "2026-07-17T01:01:00Z" },
      ],
    });
    const agg = new SessionAggregator({ aiSharedRoot: aiShared, home });
    const result = await agg.preview({ project: "demo", id: "conv" });
    assert.equal(result.messages.length, 2, "only textual user/assistant rows survive");
    assert.equal(result.messages[0].role, "user");
    assert.ok(!result.messages[0].text.includes("TopSecret99"), "assignment secret scrubbed");
    assert.ok(!result.messages[1].text.includes("abcdef123456789012"), "token value scrubbed");
    assert.ok(!JSON.stringify(result).includes("侧链内容不应出现"), "sidechain rows excluded");
    assert.ok(!JSON.stringify(result).includes("sk-proj-SECRETSECRETSECRET123456"), "tool_result content never leaves the server");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("summaries and preview skip local-command caveat wrappers and meta rows", async () => {
  const { root, aiShared } = await fixture();
  const home = join(root, "home");
  try {
    const caveat =
      "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>\n<command-name>/clear</command-name>";
    await projectFixture(home, "demo", {
      "conv.jsonl": [
        { message: { role: "user", content: caveat } },
        { isMeta: true, message: { role: "user", content: "命令回显不算" } },
        { message: { role: "user", content: `<system-reminder>背景提示</system-reminder>继续完善协作台` } },
      ],
    });
    const agg = new SessionAggregator({ aiSharedRoot: aiShared, home });
    const grouped = await agg.projects({ includeSummaries: true });
    assert.equal(grouped.projects[0].sessions[0].summary, "继续完善协作台", "wrapper-only rows skipped, wrappers stripped");
    const preview = await agg.preview({ project: "demo", id: "conv" });
    assert.equal(preview.messages.length, 1, "caveat-only and meta rows excluded from preview");
    assert.equal(preview.messages[0].text, "继续完善协作台");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview caps message count and marks truncation", async () => {
  const { root, aiShared } = await fixture();
  const home = join(root, "home");
  try {
    const lines = Array.from({ length: 80 }, (_, i) => ({ message: { role: "user", content: `消息 ${i}` } }));
    await projectFixture(home, "demo", { "long.jsonl": lines });
    const agg = new SessionAggregator({ aiSharedRoot: aiShared, home });
    const result = await agg.preview({ project: "demo", id: "long", maxMessages: 10 });
    assert.equal(result.messages.length, 10);
    assert.equal(result.messages.at(-1).text, "消息 79", "keeps the newest messages");
    assert.equal(result.truncated, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("codex rollout payload.role/content shape yields a summary", async () => {
  const { root, aiShared } = await fixture();
  const home = join(root, "home");
  try {
    const sessionsDir = join(home, ".codex", "sessions", "2026", "07");
    await mkdir(sessionsDir, { recursive: true });
    const event = { payload: { role: "user", content: "帮我评审这段代码" } };
    await writeFile(join(sessionsDir, "rollout-abc.jsonl"), JSON.stringify(event) + "\n", "utf8");
    const agg = new SessionAggregator({ aiSharedRoot: aiShared, home });
    const { sources } = await agg.list({ includeSummaries: true });
    const codex = sources.find((item) => item.source === "codex");
    assert.equal(codex.available, true);
    assert.equal(codex.sessions[0]?.summary, "帮我评审这段代码");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
