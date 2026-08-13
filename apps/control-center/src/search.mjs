// 514cc v4.0 Forge：统一本地搜索（GET /api/search）——handoff / .ai-shared 文档 / MEMORY /
// 会话 / skill 五源合一。纯本地只读扫描，子串评分（标题命中 > 正文命中，新鲜度 tiebreak），
// 文件语料做短 TTL 缓存压 warm 延迟；会话源走 SessionAggregator（外部目录扫描），给 2.5s
// 预算，超时/失败只丢 session 组，不拖垮其余四组。
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const CORPUS_TTL_MS = 5_000;
const MAX_FILE_BYTES = 512 * 1024; // 单文件超 512KB 不索引（防巨型日志拖慢搜索）
const MAX_HANDOFF_FILES = 500;
const MAX_MEMORY_DEPTH = 3;
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const SNIPPET_RADIUS = 60;
const SESSION_BUDGET_MS = 2_500;
const KIND_ORDER = ["session", "handoff", "memory", "doc", "skill"];
const HARD_CAP = 50;

function collapse(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function snippetAround(body, needle) {
  const text = collapse(body);
  if (!text) return "";
  const index = text.toLowerCase().indexOf(needle);
  if (index < 0) return text.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + needle.length + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function firstHeading(text, fallback) {
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = line.match(/^#{1,3}\s+(.+?)\s*#*\s*$/);
    if (match) return collapse(match[1]).slice(0, 120) || fallback;
  }
  return fallback;
}

// 无 YAML 依赖的 module.yaml skill 段简解析：`- code: X` 起一条，随后 path:/description: 归属该条
function parseSkills(yamlText) {
  const skills = [];
  let current = null;
  for (const line of String(yamlText ?? "").split(/\r?\n/)) {
    const code = line.match(/^\s+-\s+code:\s*(\S+)\s*$/);
    if (code) {
      current = { code: code[1], path: "", description: "" };
      skills.push(current);
      continue;
    }
    if (!current) continue;
    const path = line.match(/^\s+path:\s*(\S+)\s*$/);
    if (path) current.path = path[1];
    const description = line.match(/^\s+description:\s*["']?(.*?)["']?\s*$/);
    if (description && !current.description) current.description = description[1];
  }
  return skills;
}

function scoreDocument(doc, needle) {
  let score = 0;
  const title = doc.title.toLowerCase();
  if (title.includes(needle)) score += 100;
  const body = doc.body.toLowerCase();
  const index = body.indexOf(needle);
  if (index >= 0) {
    score += 40;
    let occurrences = 0;
    for (let at = index; at >= 0 && occurrences < 5; at = body.indexOf(needle, at + needle.length)) occurrences += 1;
    score += occurrences * 2;
  }
  if (score <= 0) return null;
  // 新鲜度 tiebreak：10 天内线性衰减到 0，无 mtime 的源（skill/section）不加分
  const ageDays = doc.mtimeMs ? (Date.now() - doc.mtimeMs) / 86_400_000 : 10;
  score += Math.max(0, Math.round((10 - ageDays) * 10) / 10);
  return score;
}

export async function listMarkdownFiles(dir, { cap = MAX_HANDOFF_FILES } = {}) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    try {
      const info = await stat(join(dir, name));
      if (info.isFile()) files.push({ name, path: join(dir, name), mtimeMs: info.mtimeMs, size: info.size });
    } catch {
      // 扫描期间被移动/删除的文件直接跳过
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(0, cap);
}

// MEMORY.md 发现：仓库根 + 逐层下钻（深度 ≤3），跳过 node_modules/.git；
// readdir withFileTypes 不跟随 symlink 目录，天然限根在仓库内
export async function findMemoryFiles(repoRoot, depth = 0) {
  const found = [];
  let entries;
  try {
    entries = await readdir(repoRoot, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === "MEMORY.md") found.push(join(repoRoot, entry.name));
  }
  if (depth >= MAX_MEMORY_DEPTH) return found;
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    found.push(...await findMemoryFiles(join(repoRoot, entry.name), depth + 1));
  }
  return found;
}

async function readIndexableFile(path, size) {
  if (size !== undefined && size > MAX_FILE_BYTES) return null;
  try {
    const text = await readFile(path, "utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) return null;
    return text;
  } catch {
    return null;
  }
}

export class SearchService {
  constructor({ repoRoot, aiSharedRoot, sessions = null }) {
    this.repoRoot = repoRoot;
    this.aiSharedRoot = aiSharedRoot;
    this.sessions = sessions;
    this.corpusCache = { builtAt: 0, documents: [] };
  }

  async search({ query = "", limit = HARD_CAP } = {}) {
    const needle = String(query ?? "").trim().toLowerCase();
    const cap = Math.max(1, Math.min(HARD_CAP, Math.floor(Number(limit) || HARD_CAP)));
    if (!needle) return { query: String(query ?? ""), groups: [] };
    const [corpus, sessionDocs] = await Promise.all([this.#corpus(), this.#sessionDocuments()]);
    const hits = [];
    for (const doc of [...corpus, ...sessionDocs]) {
      const score = scoreDocument(doc, needle);
      if (score === null) continue;
      hits.push({
        kind: doc.kind,
        item: {
          id: doc.id,
          title: doc.title,
          snippet: snippetAround(doc.body, needle),
          ref: doc.ref,
          score,
        },
      });
    }
    hits.sort((a, b) => b.item.score - a.item.score);
    const capped = hits.slice(0, cap);
    const groups = [];
    for (const kind of KIND_ORDER) {
      const items = capped.filter((hit) => hit.kind === kind).map((hit) => hit.item);
      if (items.length) groups.push({ kind, items });
    }
    return { query: String(query ?? ""), groups };
  }

  // 文件语料（handoff/doc/memory/skill）：TTL 缓存，warm 路径纯内存评分
  async #corpus() {
    const now = Date.now();
    if (this.corpusCache.builtAt > 0 && now - this.corpusCache.builtAt < CORPUS_TTL_MS) {
      return this.corpusCache.documents;
    }
    const documents = [
      ...await this.#handoffDocuments(),
      ...await this.#docSections(),
      ...await this.#memoryDocuments(),
      ...await this.#skillDocuments(),
    ];
    this.corpusCache = { builtAt: now, documents };
    return documents;
  }

  async #handoffDocuments() {
    const dir = join(this.aiSharedRoot, "handoff");
    const documents = [];
    for (const file of await listMarkdownFiles(dir)) {
      const text = await readIndexableFile(file.path, file.size);
      if (text === null) continue;
      documents.push({
        kind: "handoff",
        id: `handoff:${file.name}`,
        title: firstHeading(text, file.name),
        body: text,
        ref: `handoff/${file.name}`,
        mtimeMs: file.mtimeMs,
      });
    }
    return documents;
  }

  async #docSections() {
    const documents = [];
    for (const name of ["context.md", "decisions.md"]) {
      const path = join(this.aiSharedRoot, name);
      let info;
      try {
        info = await stat(path);
      } catch {
        continue;
      }
      const text = await readIndexableFile(path, info.size);
      if (text === null) continue;
      // 按 markdown 标题切节，每节独立成 doc——命中时 snippet 落在节内而非整文件
      const sections = [];
      let current = { heading: null, lines: [] };
      for (const line of text.split(/\r?\n/)) {
        const heading = line.match(/^#{1,3}\s+(.+?)\s*#*\s*$/);
        if (heading) {
          if (current.heading || current.lines.length) sections.push(current);
          current = { heading: collapse(heading[1]).slice(0, 120), lines: [] };
        } else {
          current.lines.push(line);
        }
      }
      if (current.heading || current.lines.length) sections.push(current);
      sections.forEach((section, index) => {
        const body = section.lines.join("\n");
        documents.push({
          kind: "doc",
          id: `doc:${name}#${index}`,
          title: section.heading ? `${name} · ${section.heading}` : name,
          body,
          ref: name,
          mtimeMs: info.mtimeMs,
        });
      });
    }
    return documents;
  }

  async #memoryDocuments() {
    const documents = [];
    for (const path of await findMemoryFiles(this.repoRoot)) {
      let info;
      try {
        info = await stat(path);
      } catch {
        continue;
      }
      const text = await readIndexableFile(path, info.size);
      if (text === null) continue;
      const rel = path.slice(this.repoRoot.length + 1).split("\\").join("/");
      documents.push({
        kind: "memory",
        id: `memory:${rel}`,
        title: firstHeading(text, rel),
        body: text,
        ref: rel,
        mtimeMs: info.mtimeMs,
      });
    }
    return documents;
  }

  async #skillDocuments() {
    let text;
    let info;
    try {
      const path = join(this.repoRoot, "module.yaml");
      [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    } catch {
      return [];
    }
    return parseSkills(text).map((skill) => ({
      kind: "skill",
      id: `skill:${skill.code}`,
      title: skill.code,
      body: skill.description,
      ref: skill.path || "module.yaml",
      mtimeMs: info.mtimeMs,
    }));
  }

  // 会话源：SessionAggregator 扫的是用户目录，给独立时间预算；超时/异常如实降级为空组
  async #sessionDocuments() {
    if (!this.sessions?.list) return [];
    let listing;
    let budget = null;
    try {
      listing = await Promise.race([
        this.sessions.list({ limitPerSource: 40 }),
        new Promise((_, reject) => {
          budget = setTimeout(() => reject(new Error("session scan budget exceeded")), SESSION_BUDGET_MS);
        }),
      ]);
    } catch {
      return [];
    } finally {
      clearTimeout(budget); // 竞速输掉也要清掉计时器，避免空挂 2.5s 拖住进程
    }
    const documents = [];
    const pushSession = (source, session) => {
      const title = collapse(session?.label ?? session?.title ?? "");
      const body = collapse(session?.summary ?? session?.preview ?? "");
      if (!title && !body) return;
      documents.push({
        kind: "session",
        id: `session:${source}:${session?.id ?? documents.length}`,
        title: title || String(session?.id ?? "session"),
        body,
        ref: `${source}:${session?.id ?? ""}`,
        mtimeMs: Date.parse(session?.modifiedAt ?? "") || 0,
      });
    };
    for (const source of listing?.sources ?? []) {
      const name = source?.source ?? "unknown";
      for (const session of source?.sessions ?? []) pushSession(name, session);
      for (const project of source?.projects ?? []) {
        for (const session of project?.sessions ?? []) pushSession(name, session);
      }
    }
    return documents;
  }
}
