/**
 * market.mjs — Wave G 供应链核心（MCP 双 registry + Skills stage-then-swap）。
 *
 * 契约（v40 设计 §3.5）：
 *   - MCP：官方 registry + smithery 搜索/详情；两段式 stage→审查报告→confirmed 安装；哈希台账
 *   - Skills：下载（来源 allowlist）→ 解压 → SKILL.md 校验 → stage-then-swap 原子安装 + 写锁
 *   - registry 不可达明确 502，不 silent fallback
 *   - fetch 注入式（测试 mock）
 */

import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

const MCP_SOURCES = Object.freeze({
  official: {
    search: (query) => `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(query)}`,
    detail: (id) => `https://registry.modelcontextprotocol.io/v0/servers/${encodeURIComponent(id)}`,
  },
  smithery: {
    search: (query) => `https://registry.smithery.ai/servers?q=${encodeURIComponent(query)}`,
    detail: (id) => `https://registry.smithery.ai/servers/${encodeURIComponent(id)}`,
  },
});

const DEFAULT_SKILL_HOST_ALLOWLIST = Object.freeze([
  "github.com",
  "codeload.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
]);

function marketError(code, message, httpStatus = 400) {
  return Object.assign(new Error(message), { code, httpStatus });
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** 极简 YAML frontmatter 行解析（name:/description: 顶层键）。 */
function parseSkillFrontmatter(text) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (pair && !fields[pair[1]]) fields[pair[1]] = pair[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

async function extractZip(zipPath, targetDir) {
  const root = resolve(targetDir);
  await mkdir(root, { recursive: true });
  try {
    await new Promise((resolveExtract, rejectExtract) => {
      yauzl.open(zipPath, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (openError, zip) => {
        if (openError || !zip) {
          rejectExtract(marketError("MARKET_EXTRACT_FAILED", `invalid zip: ${openError?.message || "open failed"}`, 400));
          return;
        }
        let settled = false;
        let entryCount = 0;
        let totalBytes = 0;
        const failExtract = (error) => {
          if (settled) return;
          settled = true;
          zip.close();
          const message = String(error?.message || error).slice(0, 300);
          rejectExtract(error?.code?.startsWith?.("MARKET_")
            ? error
            : /invalid relative path|absolute path|backslash/i.test(message)
              ? marketError("MARKET_ARCHIVE_PATH", message, 400)
              : marketError("MARKET_EXTRACT_FAILED", message, 400));
        };
        zip.once("error", failExtract);
        zip.once("end", () => {
          if (settled) return;
          settled = true;
          resolveExtract();
        });
        zip.on("entry", (entry) => {
          void (async () => {
            entryCount += 1;
            if (entryCount > 2_000) throw marketError("MARKET_ARCHIVE_LIMIT", "skill archive exceeds 2000 entries", 413);
            const name = String(entry.fileName).replace(/\\/g, "/");
            if (!name || name.includes("\0") || name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split("/").some((part) => part === "..")) {
              throw marketError("MARKET_ARCHIVE_PATH", `unsafe archive path: ${name}`, 400);
            }
            const target = resolve(root, ...name.split("/").filter(Boolean));
            const rel = relative(root, target);
            if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw marketError("MARKET_ARCHIVE_PATH", `archive path escapes staging root: ${name}`, 400);
            const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
            if ((unixMode & 0o170000) === 0o120000) throw marketError("MARKET_ARCHIVE_PATH", `archive symlink is forbidden: ${name}`, 400);
            if (name.endsWith("/")) {
              await mkdir(target, { recursive: true });
              zip.readEntry();
              return;
            }
            totalBytes += Number(entry.uncompressedSize) || 0;
            if (entry.uncompressedSize > 16 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024) {
              throw marketError("MARKET_ARCHIVE_LIMIT", "skill archive expands beyond the allowed size", 413);
            }
            await mkdir(dirname(target), { recursive: true });
            const stream = await new Promise((resolveStream, rejectStream) => zip.openReadStream(entry, (error, value) => error ? rejectStream(error) : resolveStream(value)));
            await pipeline(stream, createWriteStream(target, { flags: "wx", mode: 0o600 }));
            zip.readEntry();
          })().catch(failExtract);
        });
        zip.readEntry();
      });
    });
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/** 找到解压产物中含 SKILL.md 的根（zip 常带一层包裹目录）。 */
async function findSkillRoot(dir) {
  const direct = await stat(join(dir, "SKILL.md")).catch(() => null);
  if (direct?.isFile()) return dir;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = await stat(join(dir, entry.name, "SKILL.md")).catch(() => null);
    if (nested?.isFile()) return join(dir, entry.name);
  }
  return null;
}

export function createMarketService({
  dataRoot,
  eventStore = null,
  fetchImpl = globalThis.fetch,
  skillHostAllowlist = DEFAULT_SKILL_HOST_ALLOWLIST,
  mcpSources = MCP_SOURCES,
} = {}) {
  const root = String(dataRoot);
  const stagingDir = join(root, "market", "staging");
  const skillsDir = join(root, "market", "skills");
  const installedPath = join(root, "market", "installed.json");
  const state = {
    writeChain: Promise.resolve(),
    installLocks: new Map(), // skillName → Promise（写锁串行化）
  };

  function audit(type, detail) {
    void eventStore?.emit?.(type, detail, { sensitivity: "internal", agentId: "control-plane" })?.catch?.(() => {});
  }

  async function readInstalled() {
    try {
      const parsed = JSON.parse(await readFile(installedPath, "utf8"));
      return parsed?.items ?? [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return [];
    }
  }

  /** 台账读-改-写全程挂在写链内：并发安装不丢更新（烛式竞态修法）。 */
  function appendInstalled(item) {
    const op = state.writeChain.then(async () => {
      const items = await readInstalled();
      items.push(item);
      await mkdir(join(root, "market"), { recursive: true });
      const tmp = `${installedPath}.tmp`;
      await writeFile(tmp, JSON.stringify({ schema: "514cc.market-installed/v1", items }, null, 2), "utf8");
      await rename(tmp, installedPath);
    });
    state.writeChain = op.catch(() => {});
    return op;
  }

  async function fetchJson(url) {
    let response;
    try {
      response = await fetchImpl(url, { headers: { accept: "application/json" } });
    } catch (error) {
      throw marketError("MARKET_REGISTRY_UNREACHABLE", `registry unreachable: ${error.message}`, 502);
    }
    if (!response?.ok) throw marketError("MARKET_REGISTRY_UNREACHABLE", `registry returned ${response?.status}`, 502);
    return response.json();
  }

  function normalizeMcpEntry(source, raw) {
    const entry = raw ?? {};
    return {
      id: String(entry.name ?? entry.id ?? entry.qualifiedName ?? ""),
      name: String(entry.title ?? entry.displayName ?? entry.name ?? ""),
      description: String(entry.description ?? "").slice(0, 500),
      source,
      packageHint: entry.packages?.[0]?.name ?? entry.package ?? entry.qualifiedName ?? null,
    };
  }

  async function mcpSearch(query, source = "official") {
    const adapter = mcpSources[source];
    if (!adapter) throw marketError("MARKET_BAD_SOURCE", `unknown mcp source: ${source}`);
    const payload = await fetchJson(adapter.search(String(query || "")));
    const list = payload?.servers ?? payload?.items ?? payload?.data ?? [];
    return list.slice(0, 30).map((entry) => normalizeMcpEntry(source, entry?.server ?? entry));
  }

  async function mcpStage({ source = "official", id } = {}) {
    const adapter = mcpSources[source];
    if (!adapter) throw marketError("MARKET_BAD_SOURCE", `unknown mcp source: ${source}`);
    if (!id) throw marketError("MARKET_BAD_ID", "id is required");
    const detail = await fetchJson(adapter.detail(id));
    const raw = detail?.server ?? detail ?? {};
    const normalized = normalizeMcpEntry(source, raw);
    const review = {
      id: normalized.id,
      name: normalized.name,
      description: normalized.description,
      source,
      command: raw.command ?? raw.packages?.[0]?.command ?? null,
      args: raw.args ?? raw.packages?.[0]?.args ?? [],
      envKeys: Object.keys(raw.env ?? raw.environmentVariables ?? raw.packages?.[0]?.env ?? {}),
      hash: sha256(Buffer.from(JSON.stringify(raw))),
    };
    const stageId = randomUUID().slice(0, 12);
    await mkdir(stagingDir, { recursive: true });
    await writeFile(join(stagingDir, `mcp-${stageId}.json`), JSON.stringify({ kind: "mcp", stageId, review, stagedAt: new Date().toISOString() }, null, 2), "utf8");
    audit("market.stage", { kind: "mcp", id: normalized.id, source });
    return { ok: true, stageId, review };
  }

  async function mcpInstall({ stageId, confirmed } = {}) {
    if (confirmed !== true) throw marketError("MARKET_NOT_CONFIRMED", "install requires confirmed: true", 409);
    const stagePath = join(stagingDir, `mcp-${String(stageId)}.json`);
    let staged = null;
    try {
      staged = JSON.parse(await readFile(stagePath, "utf8"));
    } catch {
      throw marketError("MARKET_STAGE_NOT_FOUND", `staging entry not found: ${stageId}`, 404);
    }
    await appendInstalled({ kind: "mcp", id: staged.review.id, source: staged.review.source, hash: staged.review.hash, review: staged.review, installedAt: new Date().toISOString() });
    await rm(stagePath, { force: true });
    audit("market.install", { kind: "mcp", id: staged.review.id });
    return { ok: true, installed: staged.review };
  }

  function assertSkillUrl(url) {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch {
      throw marketError("MARKET_BAD_URL", "invalid url");
    }
    if (parsed.protocol !== "https:") throw marketError("MARKET_URL_FORBIDDEN", "only https: sources are allowed", 403);
    if (!skillHostAllowlist.includes(parsed.hostname.toLowerCase())) {
      throw marketError("MARKET_URL_FORBIDDEN", `host not in allowlist: ${parsed.hostname}`, 403);
    }
    return parsed;
  }

  async function skillsStage({ url } = {}) {
    const parsed = assertSkillUrl(url);
    let buffer;
    if (parsed.protocol === "file:" || parsed.hostname === "local.fixture") {
      buffer = await readFile(decodeURIComponent(parsed.pathname.replace(/^\/([A-Za-z]:)/, "$1")));
    } else {
      let response;
      try {
        response = await fetchImpl(parsed.href);
      } catch (error) {
        throw marketError("MARKET_DOWNLOAD_FAILED", `download failed: ${error.message}`, 502);
      }
      if (!response?.ok) throw marketError("MARKET_DOWNLOAD_FAILED", `download returned ${response?.status}`, 502);
      buffer = Buffer.from(await response.arrayBuffer());
    }
    if (buffer.length > 32 * 1024 * 1024) throw marketError("MARKET_TOO_LARGE", "skill archive exceeds 32MB", 413);
    const hash = sha256(buffer);
    const stageId = randomUUID().slice(0, 12);
    const stageRoot = join(stagingDir, `skill-${stageId}`);
    const zipPath = `${stageRoot}.zip`;
    await mkdir(stagingDir, { recursive: true });
    await writeFile(zipPath, buffer);
    try {
      await extractZip(zipPath, stageRoot);
    } finally {
      await rm(zipPath, { force: true });
    }
    const skillRoot = await findSkillRoot(stageRoot);
    if (!skillRoot) {
      await rm(stageRoot, { recursive: true, force: true });
      throw marketError("MARKET_SKILL_INVALID", "archive contains no SKILL.md");
    }
    const frontmatter = parseSkillFrontmatter(await readFile(join(skillRoot, "SKILL.md"), "utf8"));
    if (!frontmatter.name || !frontmatter.description) {
      await rm(stageRoot, { recursive: true, force: true });
      throw marketError("MARKET_SKILL_INVALID", "SKILL.md frontmatter requires name and description");
    }
    if (!/^[\w][\w.-]{0,63}$/.test(frontmatter.name)) {
      await rm(stageRoot, { recursive: true, force: true });
      throw marketError("MARKET_SKILL_INVALID", `unsafe skill name: ${frontmatter.name}`);
    }
    const files = (await readdir(skillRoot, { recursive: true })).map(String).slice(0, 200);
    const review = { name: frontmatter.name, description: frontmatter.description, files, sha256: hash, sourceUrl: parsed.href };
    await writeFile(join(stageRoot, ".stage.json"), JSON.stringify({ kind: "skill", stageId, review, skillRoot }, null, 2), "utf8");
    audit("market.stage", { kind: "skill", name: frontmatter.name });
    return { ok: true, stageId, review };
  }

  async function skillsInstall({ stageId, confirmed } = {}) {
    if (confirmed !== true) throw marketError("MARKET_NOT_CONFIRMED", "install requires confirmed: true", 409);
    const stageRoot = join(stagingDir, `skill-${String(stageId)}`);
    let staged = null;
    try {
      staged = JSON.parse(await readFile(join(stageRoot, ".stage.json"), "utf8"));
    } catch {
      throw marketError("MARKET_STAGE_NOT_FOUND", `staging entry not found: ${stageId}`, 404);
    }
    const name = staged.review.name;
    // 写锁：同名 skill 安装串行（stage-then-swap 原子性只在串行下成立）
    const previous = state.installLocks.get(name) ?? Promise.resolve();
    const install = previous.then(async () => {
      const target = join(skillsDir, name);
      const swapTmp = join(skillsDir, `.${name}.swap`);
      await rm(swapTmp, { recursive: true, force: true });
      await mkdir(skillsDir, { recursive: true });
      await cp(staged.skillRoot, swapTmp, { recursive: true });
      const backup = join(skillsDir, `.${name}.old`);
      await rm(backup, { recursive: true, force: true });
      const hadOld = (await stat(target).catch(() => null)) != null;
      if (hadOld) await rename(target, backup);
      try {
        await rename(swapTmp, target);
      } catch (error) {
        if (hadOld) await rename(backup, target).catch(() => {});
        throw marketError("MARKET_SWAP_FAILED", `atomic swap failed: ${error.message}`, 500);
      }
      await rm(backup, { recursive: true, force: true });
      await rm(stageRoot, { recursive: true, force: true });
      await appendInstalled({ kind: "skill", id: name, hash: staged.review.sha256, review: staged.review, installedAt: new Date().toISOString() });
      audit("market.install", { kind: "skill", name });
      return { ok: true, installed: { kind: "skill", name, path: target } };
    });
    state.installLocks.set(name, install.catch(() => {}));
    return install;
  }

  async function installedList() {
    return readInstalled();
  }

  async function skillsList() {
    const entries = await readdir(skillsDir, { withFileTypes: true }).catch(() => []);
    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const frontmatter = parseSkillFrontmatter(await readFile(join(skillsDir, entry.name, "SKILL.md"), "utf8").catch(() => ""));
      skills.push({ name: entry.name, description: frontmatter.description ?? "" });
    }
    return skills;
  }

  async function skillsRemove(name) {
    const safe = String(name || "");
    if (!/^[\w][\w.-]{0,63}$/.test(safe)) throw marketError("MARKET_BAD_ID", `unsafe skill name: ${safe}`);
    const target = join(skillsDir, safe);
    const existed = (await stat(target).catch(() => null)) != null;
    if (!existed) return false;
    await rm(target, { recursive: true, force: true });
    audit("market.remove", { kind: "skill", name: safe });
    return true;
  }

  return { mcpSearch, mcpStage, mcpInstall, skillsStage, skillsInstall, installedList, skillsList, skillsRemove, assertSkillUrl, parseSkillFrontmatter };
}
