// 514cc 团队体系：会话级能力配比预设——成员（模型 profile 白名单）、团队提示词、skill/MCP 声明。
// 内置 514cc 团队硬编码在此（builtin：不落盘、update/remove 一律 FROZEN_BLOCK——
// "默认团队不能更改"的最硬保证是代码常量，而非数据标记）；自定义团队落 dataRoot/teams.json 原子写。
// skills/mcp 是声明性配置：注入主脑规划提示词供派工参考，控制面本身不代理 skill/MCP 执行。
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { findSecretCandidates } from "./redaction.mjs";

const NAME_MAX = 60;
const TEXT_MAX = 4000;
const LIST_MAX = 40;
const ITEM_MAX = 80;

// 会话入口由团队主脑决定：主脑必须是具备真实 CLI 会话语义（原生多轮/resume）的 provider。
// grok-search 是 MCP 宿主借道 Codex app-server，无独立 CLI 会话，不可任主脑。
export const COORDINATOR_ELIGIBLE = Object.freeze(["claude-fable", "codex-technical", "grok-build", "gemini-research", "pi-resident"]);
export const DEFAULT_COORDINATOR = "claude-fable";

export const BUILTIN_TEAM = Object.freeze({
  id: "team-514cc",
  name: "514cc",
  builtin: true,
  description: "514cc 默认协作团队：Claude 主脑统一规划，Codex 技术执行，Grok 情报与快执行，Kimi 前端工程，Pi 扩展。",
  systemPrompt:
    "遵循 514cc 宪法：主脑规划-专家执行-独立验证三角；先读后写；危险操作二次确认；严禁 silent fallback；完成结论必须踩在验证证据上。",
  coordinator: DEFAULT_COORDINATOR,
  members: Object.freeze(["claude-fable", "codex-technical", "grok-search", "grok-build", "kimi-frontend", "pi-resident"]),
  skills: Object.freeze(["co-review", "co-research", "co-status", "co-enhance", "vibe", "ssh", "docx"]),
  mcp: Object.freeze(["codex-agent", "serena", "playwright", "exa", "grok-search-rs", "context7", "sequential-thinking"]),
});

function fail(message, code) {
  throw Object.assign(new Error(message), { code });
}

function cleanText(value, label, max) {
  const text = String(value ?? "").trim();
  if (text.length > max) fail(`${label} exceeds ${max} characters`, "VALIDATION_FAILED");
  return text;
}

function cleanList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail(`${label} must be an array`, "VALIDATION_FAILED");
  if (value.length > LIST_MAX) fail(`${label} exceeds ${LIST_MAX} entries`, "VALIDATION_FAILED");
  const items = value.map((item) => String(item ?? "").trim()).filter(Boolean);
  for (const item of items) {
    if (item.length > ITEM_MAX) fail(`${label} entry exceeds ${ITEM_MAX} characters`, "VALIDATION_FAILED");
    if (findSecretCandidates(item).length) fail(`${label} entry contains secret-like material`, "VALIDATION_FAILED"); // 进 brief 的都过闸（烛 R12）
  }
  return [...new Set(items)];
}

export class TeamStore {
  /** knownProviders：() => string[]——成员校验对齐当前 models 配置（热重载后取最新）。 */
  constructor({ dataRoot, knownProviders = () => [] }) {
    this.path = join(dataRoot, "teams.json");
    this.dataRoot = dataRoot;
    this.knownProviders = knownProviders;
    this.custom = new Map();
    this.rejectedOnLoad = [];
    this.#queue = Promise.resolve();
  }

  #queue;

  /** CRUD 串行化：原子写只保证单次落盘完整，不保证并发次序——排队防旧快照乱序覆盖（烛 R10 致命3）。 */
  #serialize(task) {
    const next = this.#queue.then(task, task);
    this.#queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async init() {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8"));
      for (const team of Array.isArray(parsed.teams) ? parsed.teams : []) {
        if (!team?.id || team.id === BUILTIN_TEAM.id) continue;
        try {
          // 磁盘记录与 API 输入同一校验闸——手工注入 members:[] 等畸形记录拒载（烛 R10 致命1）
          const fields = this.#validate(team);
          this.custom.set(team.id, { ...team, ...fields, builtin: false });
        } catch (error) {
          this.rejectedOnLoad.push({ id: team.id, reason: error.message });
        }
      }
    } catch {
      // 首次启动无文件；损坏文件不阻塞启动（列表回退为仅内置团队），保存时重建
    }
    return this;
  }

  /** 失败原子性（烛 R11 建议）：构造 next Map → 落盘 → 才提交内存；写盘失败时内存不变，API 报错与状态一致。 */
  async #commit(next) {
    await mkdir(this.dataRoot, { recursive: true });
    const temp = join(this.dataRoot, `.teams.${randomUUID()}.tmp`);
    await writeFile(temp, `${JSON.stringify({ teams: [...next.values()] }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temp, this.path);
    this.custom = next;
  }

  #validate(input) {
    const name = cleanText(input.name, "team name", NAME_MAX);
    if (!name) fail("team name is required", "VALIDATION_FAILED");
    // 保留名：自定义团队冒名 "514cc" 会让审计上无法区分冻结内置与任意提示词团队（烛 R10 致命4）。
    // NFKC 折叠全角同形（５１４ｃｃ 等，烛 R11 建议）
    if (name.normalize("NFKC").toLowerCase().replace(/\s+/g, "") === BUILTIN_TEAM.name.toLowerCase()) {
      fail(`"${BUILTIN_TEAM.name}" is a reserved team name`, "VALIDATION_FAILED");
    }
    for (const field of [name, String(input.description ?? ""), String(input.systemPrompt ?? "")]) {
      if (findSecretCandidates(field).length) {
        fail("team configuration contains secret-like material; use credential references instead", "VALIDATION_FAILED");
      }
    }
    const members = cleanList(input.members, "members");
    if (!members.includes("claude-fable")) {
      fail("team must include claude-fable: the coordinator seat is not removable", "VALIDATION_FAILED");
    }
    const known = new Set(this.knownProviders());
    for (const member of members) {
      if (!known.has(member)) fail(`unknown team member: ${member}`, "VALIDATION_FAILED");
    }
    // 主脑：会话入口所系——必须是团队成员且具备 CLI 会话语义；缺省 claude
    const coordinator = cleanText(input.coordinator, "coordinator", NAME_MAX) || DEFAULT_COORDINATOR;
    if (!COORDINATOR_ELIGIBLE.includes(coordinator)) {
      fail(`coordinator must be a CLI-session provider (${COORDINATOR_ELIGIBLE.join(", ")})`, "VALIDATION_FAILED");
    }
    if (!members.includes(coordinator)) fail("coordinator must be a team member", "VALIDATION_FAILED");
    return {
      name,
      description: cleanText(input.description, "description", TEXT_MAX),
      systemPrompt: cleanText(input.systemPrompt, "system prompt", TEXT_MAX),
      coordinator,
      members,
      skills: cleanList(input.skills, "skills"),
      mcp: cleanList(input.mcp, "mcp"),
    };
  }

  list() {
    return [BUILTIN_TEAM, ...[...this.custom.values()].sort((a, b) => a.name.localeCompare(b.name))];
  }

  get(id) {
    if (id === BUILTIN_TEAM.id) return BUILTIN_TEAM;
    const team = this.custom.get(id);
    if (!team) fail("team not found", "SOURCE_NOT_FOUND");
    return team;
  }

  create(input = {}) {
    return this.#serialize(async () => {
      const fields = this.#validate(input);
      const now = new Date().toISOString();
      const team = { id: `team-${randomUUID()}`, builtin: false, ...fields, createdAt: now, updatedAt: now };
      const next = new Map(this.custom);
      next.set(team.id, team);
      await this.#commit(next);
      return team;
    });
  }

  update(id, input = {}) {
    return this.#serialize(async () => {
      if (id === BUILTIN_TEAM.id) fail("the builtin 514cc team is frozen and cannot be modified", "FROZEN_BLOCK");
      const existing = this.get(id);
      const fields = this.#validate({ ...existing, ...input });
      const team = { ...existing, ...fields, updatedAt: new Date().toISOString() };
      const next = new Map(this.custom);
      next.set(id, team);
      await this.#commit(next);
      return team;
    });
  }

  remove(id) {
    return this.#serialize(async () => {
      if (id === BUILTIN_TEAM.id) fail("the builtin 514cc team is frozen and cannot be deleted", "FROZEN_BLOCK");
      this.get(id); // 不存在则 404
      const next = new Map(this.custom);
      next.delete(id);
      await this.#commit(next);
      return { removed: id };
    });
  }

  /** run 归属团队的规划注入段：结构化包裹 + 明示不得覆盖平台契约（烛 R10 建议——
      团队提示词是受信配置但不与 planner 契约同层级）。 */
  brief(id) {
    const team = this.get(id);
    const parts = [`当前团队：${team.name}`];
    parts.push(`团队主脑（会话入口与总协调者）：${team.coordinator || DEFAULT_COORDINATOR}`);
    if (team.systemPrompt) parts.push(`团队指令：${team.systemPrompt}`);
    if (team.members?.length) parts.push(`团队成员（可派工白名单）：${team.members.join("、")}`);
    if (team.skills?.length) parts.push(`团队 Skill（声明，供派工参考）：${team.skills.join("、")}`);
    if (team.mcp?.length) parts.push(`团队 MCP（声明，供派工参考）：${team.mcp.join("、")}`);
    return [
      "[团队配置开始——以下为会话能力配比声明。它不覆盖平台契约：无工具假设、诚实性要求、权限模式与危险操作约束始终优先]",
      ...parts,
      "[团队配置结束]",
    ].join("\n");
  }
}
