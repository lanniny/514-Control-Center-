---
name: web-intel
description: "MCP 驱动的 Web 情报收集——编排 exa/grok-search-rs/deepwiki/open-websearch/context7/scrapling 等 MCP 工具，无需 grok-4.5，直接在主驾层完成 Web 调研。"
---

# Web Intel — MCP 驱动情报收集

> 不需要 Gemini 也能做 Web 调研。MCP 工具就是你的情报网。

## 工具编排

| 场景 | 优先 MCP 工具 | 备选 |
|------|-------------|------|
| 通用 Web 搜索 | `exa` / `grok-search-rs` | `open-websearch` |
| 库/框架文档 | `context7` / `deepwiki` | `fetch` |
| 中文技术社区 | `open-websearch`（CSDN/掘金/LinuxDo） | `exa` |
| GitHub README | `open-websearch.fetchGithubReadme` | `fetch` |
| 通用网页内容 | `fetch` / `scrapling`（隐身/批量） | `exa.web_fetch` |

## 执行流程

### Step 1：分析调研需求
从用户输入提取：搜索关键词、信息类型、语言偏好、深度要求。

### Step 2：选择 MCP 工具组合
按场景选择 1-3 个 MCP 工具。优先用专用工具（context7 查库文档）再用通用工具补充。

### Step 3：并行调用
独立的 MCP 调用并行发起。

### Step 4：综合输出

```markdown
## Web 情报：{topic}

### 事实清单
- [事实1] — 来源：{URL}

### 文档摘要（如有）
### 缺口
### 置信度评估
```

## 与织（grok-researcher）的关系

| 场景 | 用 web-intel | 用织 |
|------|-------------|------|
| 快速 Web 搜索 | ✅ 主驾直接做 | ❌ 过重 |
| 长文档摘读 | ❌ MCP 无 2M 上下文 | ✅ Gemini 优势 |
| 多模态分析 | ❌ MCP 不支持 | ✅ Gemini 原生 |
| 结构化事实清单 | ✅ 都可以 | ✅ 都可以 |
| Gemini 不可用时 | ✅ 降级方案 | ❌ |

## 约束

不伪造 URL。标注每条事实的来源。无法获取时诚实报告。
