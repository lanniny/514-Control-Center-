<!-- 514cc-session-id: 8493be03-89d4-479c-a5c2-b19214bdcfdf -->
# 终端输入失效根因：request() 双重序列化（全项目 16 处调用受影响）

LO 连续三轮报「终端打不出任何东西」「同一份首屏出现很多条」。前两轮我按代码推理修了三批"可能的机制"，全部没打中。第三轮改用探针实测数数，一次定位。

## 根因

`public/api.js:102` 的 `request()` 内部会 `JSON.stringify(options.body)`，而 `terminal-panel.js` 等 **16 处调用方自己又 stringify 了一次**：

```js
request(`/api/pty/${id}/input`, { method: "POST", body: JSON.stringify({ data }) })
```

发出的 body 是字符串字面量 `"{\"data\":\"e\"}"`，服务端 `JSON.parse` 得到**字符串而非对象**，`payload?.data` 为 `undefined`，`String(undefined ?? "")` → **写入空串**。请求返回 200，PTY 什么都没收到——用户看到的就是「打不出字」。

受影响调用点：`terminal-panel`(input/resize/spawn)、`channels-panel`(3)、`hosts-panel`(3)、`market-panel`(3)、`office-panel`(3)。其中 PTY `resize` 与 `spawn` 的自定义 shell 参数同样一直被丢弃。

## 修复

`request()` 改为：body 已是字符串则原样透传，否则序列化。一行覆盖全部 16 处，且不改变任何既有正确调用的行为。

## 定位过程（三层剥离，每层都有实测）

| 层 | 手段 | 结论 |
|---|---|---|
| PTY 服务 | 直接调 `createPtyService` + `subscribe` | 写入生效、有回显 → **正常** |
| HTTP + SSE | 起真实路由，Node 侧建 SSE 后逐字符 POST | 新增 1817 字节、回显含标记 → **正常** |
| 浏览器 fetch | 在页面内用与前端同款代码另建 SSE + POST | `gotEcho: true` → **正常** |
| 前端调用 | 读服务端环形缓冲 | **完全没有输入字符的痕迹** → 定位到 body 序列化 |

修复后同一探针：`渲染出回显 = true`、`服务端缓冲含 RENDER_OK = true`、首屏出现次数 `1`、SSE 连接数 `1`。

## 同轮修掉的其他真实缺陷

1. **终端视图无条件自举**（`terminal-panel.js`）：页面一加载就对 `#terminal-container` 挂载，用户从未打开终端视图也会白起一个 pwsh；抽屉随后 attach 同一会话 → 同一 PTY 两条 SSE 各重放一次缓冲。改为 `IntersectionObserver` 可见才挂载，探针实测 SSE 2 → 1。
2. **SSE 断线永不重连**：流一断只写一行「连接中断」就永久停止（输入发得出去、输出回不来）；重建流时服务端默认重放整份缓冲又会多一份首屏。改为指数退避重连（5 次 / 8 秒上限）且重连一律 `replay=0`。
3. **xterm 在隐藏容器 open**：`.terminal-pane` 默认 `display:none`，xterm 要求 `open()` 时元素可见，否则渲染器按 0 尺寸初始化。改为先置 `is-active` 再 open，并在 `activateTab` 补 `refresh()`。
4. **孤儿面板**：`activateTab` 只遍历 tabs Map，已出 Map 但 DOM 还在的面板会永久保留 `is-active`。改为按 DOM 全量清理。
5. **mount 不幂等**：加串行化锁 + 重挂载前释放旧订阅 + 同 id 重复 attach 先拆旧的。
6. **输入失败静默**：`.catch(() => {})` 吞掉全部错误。改为在终端内红字报出真实原因（由通到断只提示一次）。
7. **默认 shell 走 pwsh**：`COMSPEC || cmd.exe` → Windows 依次探测 `pwsh.exe` → `powershell.exe` → COMSPEC，只认 PATH 中真实存在的可执行文件。附 Nerd Font 字体回落。
8. **401 竞态**：`mount()` 首行补 `await apiReady`，并给错误卡片加重试入口。

## 证据

- `npm test`：818 tests / 817 pass / 0 fail / 1 explicit skip。
- `npm run validate`：13/13 valid。
- `npm run qa:environment`：`ok=true`、`diagnostics=[]`、四视口零横向溢出。
- 新增 `tests/api-request-body.test.mjs`：用 fetch 桩做**行为**验证（对象 body 只序列化一次、字符串 body 原样透传、两种形状都带 JSON content-type），不是源码文本断言。
- 新增契约：终端视图可见才挂载、重连不重放、mount 幂等、输入失败可见、默认 shell 探测四分支。

## 边界与教训

- 未 commit、push、runtime sync 或重启 LO 的实例。临时探针全部删除。
- 2026-08-08 治理补全：context.md 已更新至 2026-08-08，decisions.md 补录 4 条 08-08 决策，proposals 跟踪表已创建于 `.ai-shared/proposals-tracking.md`，版本一致性审计已创建于 `.ai-shared/version-audit.md`。
- **教训**：同一现象连续两轮"按代码推理 → 修可能的机制"都落空，第三轮改成"架探针数数、逐层排除"一次命中。代码推理能列出可能性，但不能证伪；当修复连续两次没效果时，应立刻切到实测，而不是继续加固更多"可能的机制"。
- 本轮未召唤外部 CLI（harness 层限制本会话不主动调用 Agent 工具），故无 DELTA 账本行。改动触及全局 `request()`，**建议 LO 补一次烛评审**。
- 本轮非刷 DELTA 但需记录：request() 双重序列化修复（16 处调用）+ 8 个真实终端缺陷（视图自举/SSE 重连/xterm 隐藏容器/孤儿面板/mount 幂等/静默失败/默认 shell/401 竞态）。
