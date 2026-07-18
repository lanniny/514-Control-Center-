# 三层定制化系统

## 优先级（从低到高）

```
Layer 1: skills/{name}/customize.toml    — 默认值（skill 作者定义）
Layer 2: customize/team/{name}.toml      — 团队 override（提交到 git）
Layer 3: customize/personal/{name}.user.toml — 个人 override（.gitignore）
```

## 合并规则

| 值的形状 | 规则 |
|---------|------|
| 标量（string/int/bool） | 高优先级覆盖低优先级 |
| 表（table） | 深度合并（递归） |
| 有 `code`/`id` 键的表数组 | 按键匹配替换，新键追加 |
| 其他数组 | 追加（base 在前，team 在中，personal 在后） |

## 关键约束

- **无删除机制**：override 只能追加/替换，不能删除 base 条目
- **agent.name 和 agent.title 只读**：写入 override 无效
- **稀疏 override**：只包含要改的字段，否则会锁住旧默认值

## 可定制内容

- `agent.identity` — Agent 人格描述
- `agent.communication_style` — 沟通风格
- `agent.principles` — 工作原则（数组追加）
- `agent.persistent_facts` — 常驻上下文（数组追加，支持 `file:` glob）
- `agent.menu` — 能力菜单（按 code 匹配替换）
- `agent.activation_steps_prepend/append` — 激活钩子
- `codex.*` / `gemini.*` — 外部 CLI 配置
- `review_defaults.*` / `output_defaults.*` — 输出配置

## 示例

团队统一评审标准：

```toml
# customize/team/codex-reviewer.toml
[review_defaults]
strictness = "paranoid"

[agent]
persistent_facts = [
    "file:{project-root}/docs/coding-standards.md",
    "所有 API 端点必须有认证",
]
```

个人偏好：

```toml
# customize/personal/codex-reviewer.user.toml
[agent]
communication_style = "更简洁，不需要解释为什么"
```
