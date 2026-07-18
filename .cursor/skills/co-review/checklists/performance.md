---
title: "Performance Analysis Checklist"
validation-target: "代码变更中的性能维度"
validation-criticality: "HIGH"
review-mode: performance
verdict-values: ["OPTIMAL", "NEEDS_OPTIMIZATION", "PERFORMANCE_RISK"]
---

# 🕯️ 烛 · Performance Checklist

## 算法复杂度
- [ ] 关键路径 Big-O 标注（时间 + 空间）
- [ ] 是否存在 O(n²) 或更高复杂度的隐藏循环
- [ ] 排序/搜索是否使用最优算法
- [ ] 递归是否有栈溢出风险

## 资源泄漏
- [ ] 内存泄漏（malloc/new 无对应 free/delete / GC root 持有）
- [ ] 句柄泄漏（文件 / socket / DB 连接未关闭）
- [ ] 线程泄漏（创建后未 join / 未放入池）
- [ ] 事件监听泄漏（addEventListener 无对应 remove）

## 并发瓶颈
- [ ] 锁竞争（热点锁 / 锁粒度是否合理）
- [ ] 死锁风险（多锁获取顺序是否一致）
- [ ] 饥饿（低优先级任务是否有机会执行）
- [ ] 线程安全（共享可变状态是否正确同步）

## I/O 效率
- [ ] N+1 查询（循环内数据库调用）
- [ ] 冗余 API 调用（重复请求可缓存的数据）
- [ ] 缓存策略（是否有缓存 / 缓存失效机制）
- [ ] 批量操作（是否可合并多次小 I/O 为一次批量）

## 内存模式
- [ ] 大对象分配（是否可复用 / 池化）
- [ ] GC 压力（短生命周期对象是否过多）
- [ ] 缓冲区大小（是否合理 / 是否有上限）
- [ ] 字符串拼接（循环内是否使用 StringBuilder 等）

## 输出格式

```markdown
## Performance Analysis: {scope}
### 复杂度标注表
| 函数/路径 | 时间 | 空间 | 备注 |
### 性能发现
| ID | 类型 | 位置 | 影响 | 优化建议 | ROI |
### 瓶颈地图
{关键路径示意}

__VERDICT__: OPTIMAL | NEEDS_OPTIMIZATION | PERFORMANCE_RISK
```
