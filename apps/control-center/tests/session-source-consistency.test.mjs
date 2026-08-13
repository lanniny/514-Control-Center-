import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SessionAggregator } from "../src/sessions.mjs";

function cursorStorageDir(home) {
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "Cursor", "User", "globalStorage");
  if (process.platform === "win32") return join(home, "AppData", "Roaming", "Cursor", "User", "globalStorage");
  return join(home, ".config", "Cursor", "User", "globalStorage");
}

async function createNonClaudeSources(home) {
  const cwd = "I:\\demo\\non-claude-only";

  const codexDir = join(home, ".codex", "sessions", "2026", "07", "23");
  await mkdir(codexDir, { recursive: true });
  await writeFile(
    join(codexDir, "rollout-2026-07-23T12-00-00-codex-only.jsonl"),
    `${JSON.stringify({ type: "session_meta", payload: { id: "codex-only", cwd } })}\n${JSON.stringify({ payload: { role: "user", content: "Codex 独立项目" } })}\n`,
    "utf8",
  );

  const kimiId = "session_kimi_only";
  const kimiDir = join(home, ".kimi-code", "sessions", "wd_demo", kimiId);
  const kimiWire = join(kimiDir, "agents", "main", "wire.jsonl");
  await mkdir(join(kimiDir, "agents", "main"), { recursive: true });
  await writeFile(join(kimiDir, "state.json"), JSON.stringify({ updatedAt: "2026-07-23T12:01:00.000Z", isCustomTitle: true, title: "Kimi 独立会话" }), "utf8");
  await writeFile(kimiWire, `${JSON.stringify({ type: "turn.prompt", origin: { kind: "user" }, input: [{ text: "Kimi 独立项目" }] })}\n`, "utf8");
  await writeFile(
    join(home, ".kimi-code", "session_index.jsonl"),
    `${JSON.stringify({ sessionId: kimiId, sessionDir: kimiDir, workDir: cwd })}\n`,
    "utf8",
  );

  const piId = "2026-07-23T12-02-00-000Z_pi-only";
  const piDir = join(home, ".pi", "agent", "sessions", "--I-demo-non-claude-only--");
  await mkdir(piDir, { recursive: true });
  await writeFile(
    join(piDir, `${piId}.jsonl`),
    `${JSON.stringify({ type: "session", id: piId, cwd })}\n${JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "Pi 独立项目" }] } })}\n`,
    "utf8",
  );

  const cursorId = "aaaa1111-2222-4333-8444-555566667777";
  const bubbleId = "bbbb1111-2222-4333-8444-555566667777";
  const storageDir = cursorStorageDir(home);
  await mkdir(storageDir, { recursive: true });
  const db = new DatabaseSync(join(storageDir, "state.vscdb"));
  try {
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)");
    db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run("composer.composerHeaders", JSON.stringify({
      allComposers: [{
        composerId: cursorId,
        name: "Cursor 独立会话",
        createdAt: 1784808000000,
        lastUpdatedAt: 1784808180000,
        isArchived: false,
        isDraft: false,
        workspaceIdentifier: { uri: { fsPath: cwd } },
      }],
    }));
    db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `composerData:${cursorId}`,
      JSON.stringify({ fullConversationHeadersOnly: [{ bubbleId, type: 1, createdAt: "2026-07-23T12:03:00.000Z" }] }),
    );
    db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `bubbleId:${cursorId}:${bubbleId}`,
      JSON.stringify({ type: 1, text: "Cursor 独立项目", createdAt: "2026-07-23T12:03:00.000Z" }),
    );
  } finally {
    db.close();
  }

  return { cwd };
}

test("project scan keeps non-Claude sources when ~/.claude/projects is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "cc-session-sources-"));
  const home = join(root, "home");
  try {
    const { cwd } = await createNonClaudeSources(home);
    const result = await new SessionAggregator({ aiSharedRoot: join(root, ".ai-shared"), home }).projects({ includeSummaries: true });

    assert.equal(result.available, true, "任一真实 CLI 源可用时整棵项目树应可用");
    const sourceStatus = Object.fromEntries(result.sources.map((source) => [source.source, source]));
    assert.equal(sourceStatus.claude.available, false, "Claude 根确实缺失，不得伪装 available");
    for (const source of ["codex", "kimi", "pi", "cursor"]) {
      assert.equal(sourceStatus[source].available, true, `${source} 应独立完成扫描`);
      assert.equal(sourceStatus[source].sessionCount, 1, `${source} 应报告真实会话数`);
    }

    const project = result.projects.find((item) => item.path?.toLowerCase() === cwd.toLowerCase());
    assert.ok(project, "无 Claude 根时仍应合成非 Claude 项目");
    assert.deepEqual(project.sessions.map((session) => session.cli).sort(), ["codex", "cursor", "kimi", "pi"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("flat session API model exposes every promised CLI with truthful status and count", async () => {
  const root = await mkdtemp(join(tmpdir(), "cc-session-list-sources-"));
  const home = join(root, "home");
  try {
    await createNonClaudeSources(home);
    const result = await new SessionAggregator({ aiSharedRoot: join(root, ".ai-shared"), home }).list({
      limitPerSource: 10,
      includeSummaries: true,
    });
    assert.deepEqual(result.sources.map((source) => source.source), [
      "claude", "codex", "cursor", "kimi", "pi", "bridge", "grok",
      "opencode", "cline", "openclaw", "hermes", "codebuddy",
    ]);

    const bySource = Object.fromEntries(result.sources.map((source) => [source.source, source]));
    for (const source of ["codex", "cursor", "kimi", "pi"]) {
      assert.equal(bySource[source].available, true, `${source} 状态应来自真实存储探测`);
      assert.equal(bySource[source].sessionCount, 1, `${source} 计数应独立报告`);
      assert.equal(bySource[source].sessions.length, 1);
      assert.ok(bySource[source].sessions[0].summary, `${source} opt-in 摘要应走现有脱敏管线`);
    }
    for (const source of ["claude", "bridge", "grok", "opencode", "cline", "openclaw", "hermes", "codebuddy"]) {
      assert.equal(bySource[source].available, false, `${source} 存储不存在时不得伪装已接入`);
      assert.equal(bySource[source].sessionCount, 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
