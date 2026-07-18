---
title: "Architecture Review Checklist"
validation-target: "代码变更中的架构维度"
validation-criticality: "HIGH"
review-mode: architecture
verdict-values: ["SOLID", "NEEDS_REFACTORING", "ARCHITECTURE_RISK"]
---

# 🕯️ 烛 · Architecture Checklist

## SOLID 合规（逐项 0-5 分）

### S — 单一职责
- [ ] 每个类/模块是否只有一个变更的理由
- [ ] 是否存在 God Class / God Function
- [ ] 职责是否清晰命名

### O — 开放封闭
- [ ] 扩展新行为是否需要修改现有代码
- [ ] 是否使用策略/模板/工厂等扩展点
- [ ] 配置 vs 硬编码

### L — 里氏替换
- [ ] 子类是否完全兼容父类契约
- [ ] 是否存在"违反 LSP"的类型检查（instanceof/typeof）
- [ ] 异常行为是否一致

### I — 接口隔离
- [ ] 接口是否有客户端不需要的方法
- [ ] 是否存在"胖接口"
- [ ] 依赖是否最小化

### D — 依赖倒置
- [ ] 高层模块是否依赖抽象而非具体
- [ ] 依赖注入是否正确使用
- [ ] 依赖方向是否从具体→抽象

## 耦合度分析
- [ ] 传入耦合 Ca（谁依赖我）
- [ ] 传出耦合 Ce（我依赖谁）
- [ ] 不稳定度 I = Ce/(Ca+Ce)（>0.5 = 不稳定）
- [ ] 循环依赖检测

## 内聚度
- [ ] 模块内元素是否围绕同一职责
- [ ] 是否存在散弹式修改（一个变更需改 N 个文件）
- [ ] 数据和操作是否就近组织

## 分层清晰度
- [ ] 层次边界是否清晰（UI / 业务 / 数据）
- [ ] 跨层直接调用是否存在
- [ ] 依赖是否单向向下

## 输出格式

```markdown
## Architecture Review: {scope}
### SOLID 评分表
| 原则 | 评分 (0-5) | 证据 | 改进建议 |
### 耦合分析
| 模块 | Ca | Ce | I | 风险 |
### 架构风险
| 风险 | 位置 | 影响 | 演进建议 |

__VERDICT__: SOLID | NEEDS_REFACTORING | ARCHITECTURE_RISK
```
