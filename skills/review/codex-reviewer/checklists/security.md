---
title: "Security Audit Checklist"
validation-target: "代码变更中的安全维度"
validation-criticality: "HIGHEST"
review-mode: security
verdict-values: ["SECURE", "NEEDS_HARDENING", "CRITICAL_VULNERABILITY"]
---

# 🕯️ 烛 · Security Checklist

## 注入攻击面
- [ ] SQL 注入（参数化查询 / ORM 是否正确使用）
- [ ] 命令注入（shell exec / child_process 输入是否转义）
- [ ] XSS（用户输入是否正确编码后输出）
- [ ] SSRF（URL 参数是否验证白名单）
- [ ] 路径遍历（文件路径是否规范化 + 白名单）
- [ ] LDAP / XML / Template 注入（如适用）

## 认证与授权
- [ ] 认证绕过（是否每个端点都有认证检查）
- [ ] 权限提升（水平/垂直越权是否防御）
- [ ] 会话管理（token 过期 / 刷新 / 撤销机制）
- [ ] 密码策略（哈希算法 / 盐值 / 最小复杂度）
- [ ] MFA（关键操作是否要求多因素）

## 密码学
- [ ] 算法选择（是否使用当前推荐算法，非 MD5/SHA1/DES）
- [ ] 密钥管理（硬编码密钥 / 环境变量泄露）
- [ ] 随机数（是否使用密码学安全随机源）
- [ ] TLS 配置（最低版本 / 证书验证）

## 敏感数据
- [ ] 日志泄露（密码 / token / PII 是否出现在日志中）
- [ ] 异常泄露（堆栈跟踪 / 内部路径是否暴露给客户端）
- [ ] API 响应泄露（是否返回了不必要的内部字段）
- [ ] 存储加密（敏感数据静态加密）

## 竞态与 TOCTOU
- [ ] 竞态条件（共享资源是否有原子操作 / 锁）
- [ ] TOCTOU（检查到使用之间是否有时间窗口）
- [ ] 幂等性（关键操作是否幂等）

## 输出格式

```markdown
## Security Audit: {scope}
| ID | 严重性 | CWE | 位置 | 描述 | 利用场景 | 修复方案 |
|---|---|---|---|---|---|---|
| SEC-001 | CRITICAL | CWE-89 | file:line | ... | ... | ... |

安全评分：{A~F}
__VERDICT__: SECURE | NEEDS_HARDENING | CRITICAL_VULNERABILITY
```
