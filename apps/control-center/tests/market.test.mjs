import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMarketService } from "../src/market.mjs";

async function fixture(t, fetchImpl = async () => { throw new Error("no fetch"); }) {
  const dir = await mkdtemp(join(tmpdir(), "514cc-market-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // 测试域名 local.fixture 走本地文件分支，注入进 allowlist
  const service = createMarketService({
    dataRoot: dir,
    fetchImpl,
    skillHostAllowlist: ["local.fixture", "github.com", "codeload.github.com"],
  });
  return { dir, service };
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function storedZip(filename, content) {
  const name = Buffer.from(filename, "utf8");
  const data = Buffer.from(content, "utf8");
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const centralOffset = local.length + name.length + data.length;
  const centralSize = central.length + name.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

/** 在 temp 造一个含 SKILL.md 的无压缩 ZIP，零系统命令依赖。 */
async function makeSkillZip(t, rootDir, skillName = "demo-skill", withFrontmatter = true) {
  const stage = join(rootDir, "zip-src");
  await rm(stage, { recursive: true, force: true }).catch(() => {});
  await mkdir(stage, { recursive: true });
  const content = withFrontmatter
    ? `---\nname: ${skillName}\ndescription: 演示技能\n---\n\n# demo\n`
    : "# no frontmatter\n";
  await writeFile(join(stage, "SKILL.md"), content, "utf8");
  const zipPath = join(rootDir, `${skillName}.zip`);
  await writeFile(zipPath, storedZip("zip-src/SKILL.md", content));
  return zipPath;
}

test("market: mcp search normalizes entries; unreachable registry is an explicit 502", async (t) => {
  const fetchImpl = async (url) => {
    if (url.includes("registry.modelcontextprotocol.io")) {
      return { ok: true, json: async () => ({ servers: [{ server: { name: "io.x/fs", title: "Filesystem", description: "fs server" } }] }) };
    }
    throw new Error("boom");
  };
  const { service } = await fixture(t, fetchImpl);
  const items = await service.mcpSearch("fs", "official");
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "io.x/fs");
  assert.equal(items[0].source, "official");
  await assert.rejects(() => service.mcpSearch("x", "smithery"), { code: "MARKET_REGISTRY_UNREACHABLE" });
});

test("market: mcp stage → review report → install requires confirmation and records hash", async (t) => {
  const detail = { server: { name: "io.x/fs", title: "Filesystem", description: "d", command: "npx", args: ["-y", "@x/fs"], env: { API_KEY: "" } } };
  const fetchImpl = async () => ({ ok: true, json: async () => detail });
  const { service } = await fixture(t, fetchImpl);
  const staged = await service.mcpStage({ source: "official", id: "io.x/fs" });
  assert.equal(staged.review.command, "npx");
  assert.deepEqual(staged.review.envKeys, ["API_KEY"]);
  assert.ok(staged.review.hash.length === 64);

  await assert.rejects(() => service.mcpInstall({ stageId: staged.stageId }), { code: "MARKET_NOT_CONFIRMED" });
  const installed = await service.mcpInstall({ stageId: staged.stageId, confirmed: true });
  assert.equal(installed.ok, true);
  const ledger = await service.installedList();
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].hash, staged.review.hash);
  // staging 已清
  await assert.rejects(() => service.mcpInstall({ stageId: staged.stageId, confirmed: true }), { code: "MARKET_STAGE_NOT_FOUND" });
});

test("market: skill url allowlist refuses non-allowlisted hosts and non-https", async (t) => {
  const { service } = await fixture(t);
  assert.throws(() => service.assertSkillUrl("http://github.com/x.zip"), { code: "MARKET_URL_FORBIDDEN" });
  assert.throws(() => service.assertSkillUrl("https://evil.example.com/x.zip"), { code: "MARKET_URL_FORBIDDEN" });
  assert.equal(service.assertSkillUrl("https://github.com/a/b/archive/main.zip").hostname, "github.com");
});

test("market: skill stage validates SKILL.md and rejects bad archives", async (t) => {
  const { dir, service } = await fixture(t);
  const goodZip = await makeSkillZip(t, dir, "good-skill", true);
  const staged = await service.skillsStage({ url: `https://local.fixture/${goodZip}` });
  assert.equal(staged.review.name, "good-skill");
  assert.equal(staged.review.description, "演示技能");
  assert.ok(staged.review.sha256.length === 64);
  assert.ok(staged.review.files.some((file) => String(file).endsWith("SKILL.md")));

  const badZip = await makeSkillZip(t, dir, "bad-skill", false);
  await assert.rejects(() => service.skillsStage({ url: `https://local.fixture/${badZip}` }), { code: "MARKET_SKILL_INVALID" });

  const traversalZip = join(dir, "traversal.zip");
  await writeFile(traversalZip, storedZip("../escaped/SKILL.md", "---\nname: escaped\ndescription: no\n---\n"));
  await assert.rejects(() => service.skillsStage({ url: `https://local.fixture/${traversalZip}` }), { code: "MARKET_ARCHIVE_PATH" });
  await assert.rejects(() => stat(join(dir, "market", "escaped", "SKILL.md")), { code: "ENOENT" });
});

test("market: skill install is atomic stage-then-swap and serialized under the write lock", async (t) => {
  const { dir, service } = await fixture(t);
  const zipA = await makeSkillZip(t, dir, "lock-skill", true);
  const stagedA = await service.skillsStage({ url: `https://local.fixture/${zipA}` });
  const zipB = await makeSkillZip(t, dir, "lock-skill2", true);
  // 同名第二份：改名复用
  const stagedB = await service.skillsStage({ url: `https://local.fixture/${zipB}` });

  const [first, second] = await Promise.all([
    service.skillsInstall({ stageId: stagedA.stageId, confirmed: true }),
    service.skillsInstall({ stageId: stagedB.stageId, confirmed: true }),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const skills = await service.skillsList();
  assert.deepEqual(skills.map((skill) => skill.name).sort(), ["lock-skill", "lock-skill2"]);
  // 目标目录完整可读（swap 后无半残）
  const content = await readFile(join(dir, "market", "skills", "lock-skill", "SKILL.md"), "utf8");
  assert.ok(content.includes("name: lock-skill"));
  const ledger = await service.installedList();
  assert.equal(ledger.filter((entry) => entry.kind === "skill").length, 2);
});

test("market: skill remove deletes directory and refuses unsafe names", async (t) => {
  const { dir, service } = await fixture(t);
  const zip = await makeSkillZip(t, dir, "rm-skill", true);
  const staged = await service.skillsStage({ url: `https://local.fixture/${zip}` });
  await service.skillsInstall({ stageId: staged.stageId, confirmed: true });
  assert.ok((await stat(join(dir, "market", "skills", "rm-skill"))).isDirectory());
  assert.equal(await service.skillsRemove("rm-skill"), true);
  assert.equal(await service.skillsRemove("rm-skill"), false);
  await assert.rejects(() => service.skillsRemove("../x"), { code: "MARKET_BAD_ID" });
});
