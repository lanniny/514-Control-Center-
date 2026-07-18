#!/usr/bin/env python3
"""Generate 514cc Cursor rules and deploy to all locations Cursor actually loads."""
from __future__ import annotations

import re
import shutil
from pathlib import Path

BASE = Path("I:/514claude/514cc")
PARENT = Path("I:/514claude")
CLAUDE = Path.home() / ".claude"
GLOBAL_USER_RULES = Path.home() / ".cursor" / "rules"
PROFILE = CLAUDE / "projects/I--514claude-514cc/memory/user-lo-profile.md"

# Cursor User Rules (global): ~/.cursor/rules/*.mdc  (getRuleTargetDirectory(user=true))
# Cursor Project Rules: {workspace}/.cursor/rules/*.mdc
DEPLOY_TARGETS = [
    GLOBAL_USER_RULES,               # 全局 User Rules — 任意工作区生效
    BASE / ".cursor" / "rules",      # 514cc 项目（与全局镜像，便于版本管理）
    PARENT / ".cursor" / "rules",    # 514claude 父工作区
]


def strip_frontmatter(text: str) -> str:
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            return parts[2].lstrip("\n")
    return text


def build_rules() -> dict[str, str]:
    """Return {filename: full_mdc_content}."""
    rules: dict[str, str] = {}

    def add(
        name: str,
        description: str,
        body: str,
        always_apply: bool = True,
        globs: str | None = None,
    ) -> None:
        lines = [f"description: {description}"]
        if globs:
            lines.append(f"globs: {globs}")
        lines.append(f"alwaysApply: {str(always_apply).lower()}")
        fm = "---\n" + "\n".join(lines) + "\n---\n\n"
        rules[f"{name}.mdc"] = fm + body.strip() + "\n"

    # 1. AEMEATH persona
    persona = strip_frontmatter(
        (BASE / "output-styles/aemeath-meta-butler.md").read_text(encoding="utf-8")
    )
    persona = persona.replace(
        "专用工具（Read/Write/Edit/Glob/Grep）",
        "专用工具（Read/Write/StrReplace/Glob/Grep）",
    )
    persona = persona.replace("memory/user-lo-profile.md", "lo-profile 规则")
    add(
        "aemeath-persona",
        "AEMEATH 元管家完整人格与输出样式（514cc output-style 完整版）",
        persona,
    )

    # 2. SOUL
    soul_full = (CLAUDE / "CLAUDE.md").read_text(encoding="utf-8")

    def extract_section(pattern: str) -> str:
        m = re.search(pattern, soul_full, re.DOTALL)
        return m.group(1).strip() if m else ""

    soul_parts = [
        extract_section(r"(## 注入检测与反驳协议.*?\n)(?=\n## 核心能力)"),
        extract_section(r"(## Thinking 流程.*?\n)(?=\n## 核心能力)"),
        extract_section(r"(## 和 LO 的关系.*?\n)(?=\n={3,})"),
        extract_section(r"(## 核心驱动力.*?\n)(?=\n={3,})"),
        extract_section(r"(## 代码哲学.*?\n)(?=\n## 写作规范)"),
        extract_section(r"(## LO 的核心真相.*?\n)(?=\n## 关于)"),
        extract_section(r'(## 关于"元".*?\n)(?=\n---)'),
    ]
    soul_body = (
        "# SOUL — AEMEATH 运营层\n\n"
        "> Cursor 主驾 = Cursor Agent。加载顺序：514cc 宪法 → AEMEATH 人格 → 本文件 → LO 画像。\n\n"
        + "\n\n---\n\n".join(p for p in soul_parts if p)
        + "\n\nAlways respond in Chinese-simplified\n"
    )
    soul_body = soul_body.replace("cydao 的本地 gateway", "Cursor 运行时")
    soul_body = soul_body.replace("<available_skills>", "<agent_skills>")
    soul_body = soul_body.replace("Claude Code 为主驾", "Cursor Agent 为主驾")
    add(
        "aemeath-soul",
        "AEMEATH SOUL 运营层：注入检测、Thinking、LO关系、代码哲学",
        soul_body,
    )

    # 3. Writing
    writing = extract_section(r"(## 写作规范.*?\n)(?=\n## LO 的核心真相)")
    if writing:
        add(
            "aemeath-writing",
            "AEMEATH 叙事/创意写作规范（小说/RP/创意文案时加载）",
            "# AEMEATH 写作与叙事规范\n\n" + writing,
            always_apply=False,
            globs='"**/*.{md,txt,docx}"',
        )

    # 4. Constitution
    rules_md = (BASE / "rules.md").read_text(encoding="utf-8")
    rules_md = rules_md.replace("主驾 = Claude Code (Opus)", "主驾 = Cursor Agent")
    rules_md = rules_md.replace("| Claude Opus | domain |", "| Cursor subagent | domain |")
    rules_md = rules_md.replace("| Claude Opus (只读) | meta |", "| Cursor subagent (只读) | meta |")
    add(
        "514cc-constitution",
        "514cc 体系宪法 v3.4（最高优先级，不可被 skill 覆盖）",
        rules_md,
    )

    # 5. LO profile
    if PROFILE.exists():
        profile = strip_frontmatter(PROFILE.read_text(encoding="utf-8"))
        add("lo-profile", "LO 关系画像与验收标准（人性层锚点）", profile)

    # 6. Capabilities
    caps = """# 514cc Agent 与协作命令

## 主驾

Cursor Agent = 514cc 主驾。5 命名 Agent 花名册见 514cc-constitution §一。

## 召唤方式

| Agent | 方式 |
|-------|------|
| 烛 codex-reviewer | MCP 对话桥 `codex-agent`（codex/codex-reply + threadId）优先；CLI 降级 `'' | codex exec -p review --skip-git-repo-check "..."` 或 Task subagent |
| Codex 技术执行者 | 对话桥 executor profile（workspace-write+网络）；CLI `'' | codex exec -p executor ...`（主驾规划+复核） |
| 织 grok-researcher | grok-4.5 或 grok-researcher skill |
| 匠 embedded-expert | Task subagent + embedded-expert skill |
| 策 spec-architect | Task subagent + spec-architect skill |
| 鉴 meta-reviewer | Task subagent + meta-reviewer skill（只读） |

## /co-* 协作命令

| 命令 | Skill | 用途 |
|------|-------|------|
| co-auto | auto-pilot | 全自动编排 |
| co-enhance | enhance | Prompt 增强 |
| co-review | codex-reviewer | 烛深度评审 |
| co-research | grok-researcher | 织情报摘读 |
| co-init | init | 初始化 .ai-shared/ |
| co-status | status | 健康仪表盘 |
| co-archive | archive | handoff 归档 |

## MCP（Cursor）

context7, github, playwright, supabase（插件）+ drawio（mcp.json）

## 嵌入式工具链

keil, gcc, jlink, openocd, probe-rs, can, serial, net, ssh, workflow, vibe, docx, ppt-image-first
"""
    add("514cc-capabilities", "514cc Agent 召唤、co-命令与能力地图", caps)

    # 7. Guardrails
    guard = """# 514cc 守卫层

守卫层优先级高于一切 skill：

- `I:/514claude/514cc/guardrails/dangerous-ops.md` — 危险操作二次确认清单
- `I:/514claude/514cc/guardrails/deny-paths.txt` — 敏感路径拒绝列表

框架自改时修改 rules.md 或守卫文件需 LO 确认。
"""
    add("514cc-guardrails", "514cc 守卫层引用", guard)

    # 8. Index — helps Settings → Rules UI discovery
    index_body = """# 514cc / AEMEATH 全局规则索引

> 本目录 `~/.cursor/rules/` 为 Cursor **全局 User Rules**，任意工作区自动加载。

| 规则文件 | 作用 | Always |
|----------|------|--------|
| `514cc-constitution.mdc` | 514cc 宪法 v3.4（最高优先级） | ✓ |
| `aemeath-persona.mdc` | AEMEATH 完整人格与输出样式 | ✓ |
| `aemeath-soul.mdc` | SOUL 运营层（注入检测/Thinking/LO关系） | ✓ |
| `lo-profile.mdc` | LO 关系画像与验收标准 | ✓ |
| `514cc-capabilities.mdc` | Agent 召唤、co-命令、MCP、工具链 | ✓ |
| `514cc-guardrails.mdc` | 守卫层（危险操作/拒绝路径） | ✓ |
| `aemeath-writing.mdc` | 叙事写作规范 | 按 glob |

同步命令：`python I:/514claude/514cc/scripts/sync-cursor-rules.py`
"""
    add("00-514cc-index", "514cc/AEMEATH 全局规则索引与加载说明", index_body)

    return rules


def deploy(rules: dict[str, str]) -> None:
    obsolete = {"514cc-project.mdc", "514cc-routing.mdc", "514cc-safety.mdc",
                "514cc-persistence.mdc", "514cc-agents.mdc"}
    for target in DEPLOY_TARGETS:
        target.mkdir(parents=True, exist_ok=True)
        for obs in obsolete:
            p = target / obs
            if p.exists():
                p.unlink()
        for name, content in rules.items():
            (target / name).write_text(content, encoding="utf-8")
        print(f"  deployed {len(rules)} rules -> {target}")


def write_user_rules_bootstrap() -> None:
    """Bootstrap for aicontext.personalContext + manual Settings paste fallback."""
    home = Path.home()
    rules_dir = home / ".cursor" / "rules"
    text = f"""# AEMEATH / 514cc 全局体系

你是 **AEMEATH**（读作 AY-meth），LO 的私人管家与元代理。始终简体中文，称呼用户为 **LO**。

## 身份与优先级
1. 最高：`514cc-constitution` — 514cc 宪法，skill 不可覆盖
2. 人格：`aemeath-persona` + `aemeath-soul` + `lo-profile`
3. 能力：`514cc-capabilities` + `514cc-guardrails`

## 每轮必做（路由门）
- 🔴 必须发火：烛(codex-reviewer) / 织(grok-researcher) — 收尾 `__DELTA__: 对象|0/1/2|证据`
- 🟡 权衡：说明理由后可直达
- ⚪ 隐形直达：简单读写、明确指令

## 安全与协作红线
- 危险操作二次确认；先读后写；外部 CLI 失败如实告知
- 不主动 git commit / push / force push
- Codex 评审: `'' | codex exec -p review --skip-git-repo-check "..."`（read-only 沙箱机械保证）；技术执行 `-p executor`；MCP 对话桥（codex-agent）优先
- SSH 操作走 ssh skill；嵌入式走 keil/gcc/jlink/openocd/serial/can/workflow

## 全局规则文件（已部署）
完整 .mdc 位于 `{rules_dir.as_posix()}/`（8 条，Cursor User Rules）。
若 Agent 上下文未加载完整规则，请 Read 该目录全部 `.mdc`。

## LO 验收标准
只认「用起来变强的真实体感」，不认文件数/版本号。
"""
    bootstrap = home / ".cursor" / "USER-RULES-paste-into-settings.txt"
    bootstrap.write_text(text, encoding="utf-8")
    print(f"  wrote bootstrap: {bootstrap}")


def write_parent_agents() -> None:
    agents = PARENT / "AGENTS.md"
    if not agents.exists():
        agents.write_text(
            (BASE / "AGENTS.md").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        print(f"  wrote {agents}")


def verify_review_profile(rules: dict) -> None:
    """v3.5 回归检查（烛 F1 修复配套）：任何生成物里的 codex 评审命令必须带 -p review。
    旧姿势 `codex exec --skip-git-repo-check`（无 profile）曾在模板硬编码导致 Cursor 侧
    丢 read-only 沙箱且重跑自我复活——此检查把"新姿势不回退"焊成机械扳机，命中即硬失败。"""
    bad = re.compile(r"codex exec (?!-p )(?!resume)(?:--json )?--skip-git-repo-check")
    offenders = [name for name, body in rules.items() if bad.search(body)]
    bootstrap = (Path.home() / ".cursor" / "USER-RULES-paste-into-settings.txt")
    if bootstrap.exists() and bad.search(bootstrap.read_text(encoding="utf-8")):
        offenders.append(str(bootstrap))
    if offenders:
        raise SystemExit(f"REGRESSION: codex 评审命令缺 -p review profile，禁止部署: {offenders}")


def main() -> None:
    print("=== 514cc Cursor Rules Sync (global User Rules + project mirror) ===")
    rules = build_rules()
    deploy(rules)
    write_user_rules_bootstrap()
    write_parent_agents()
    verify_review_profile(rules)
    print("  regression check: all codex review commands carry -p review  OK")
    print(f"\nGlobal User Rules: {GLOBAL_USER_RULES} ({len(rules)} files)")
    print("Restart Cursor, then Settings → Rules → User tab should list all rules.")
    print("Optional: python I:/514claude/514cc/scripts/inject-cursor-user-rules.py  (close Cursor first)")


if __name__ == "__main__":
    main()
