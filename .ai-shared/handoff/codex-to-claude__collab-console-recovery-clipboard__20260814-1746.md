<!-- 514cc-session-id: 019ffea1-2d9f-7370-a6f8-1d793d737451 -->
# 协作台恢复与剪贴板图片收口

## 致命问题

当前无未闭环 P0/P1，独立 reviewer 最终结论为 `APPROVED`。

- Grok Build 写盘轮改为无人值守 `dontAsk`，只允许 cwd 内 `Edit/Write`，不授予 Bash、Web、MCP 或 subagent：`apps/control-center/src/adapters/grok-build.mjs:29`。
- `cancelled/max_tokens/max_turn_requests/error_max_turns` 与零输出不再伪报完成；Grok 异常 stop 的 partial text 也不会先流出普通 `assistant.message`：`apps/control-center/src/provider-turn-outcome.mjs:7`、`apps/control-center/src/adapters/grok-build.mjs:97`。
- reviewer 推翻了“source/cleanup 锁已经覆盖全部窗口”的判断：`save -> HTTP response -> browser attachment` 之间仍可被 cleanup 删除。现由同锁 pending lease + capability claim 关闭：`apps/control-center/src/clipboard-lifecycle.mjs:10`、`apps/control-center/src/clipboard-lifecycle.mjs:117`、`apps/control-center/src/clipboard-attachment.mjs:344`、`apps/control-center/src/clipboard-attachment.mjs:428`。
- reviewer 原始竞态复跑：首次 cleanup `deletedFiles=0` 且文件存在；错误 token 不释放；claim 后 cleanup 才删除。最终 verdict：`APPROVED`。

## 建议改进

- `partial`：没有运行真实付费 Grok provider 端到端轮。当前证据覆盖 adapter argv、真实本地 CLI health/version、编排异常语义与全量回归，但不把这些夸大成真实付费会话成功；需 LO 另行明确授权后再验。
- 本轮明确不改 `round/maxSteps` 记账模型。对话往返与自主步数拆账仍应独立立项，不能混入这次可用性修复。
- 已 claim、尚未提交的另一浏览器页面附件仍不在本页 cleanup 的保护范围；破坏性确认框已明确警告这一边界。未 claim 上传由 2 分钟 lease 保护，过期后可回收，不永久阻塞 quota。
- 工作区不是本轮独占：最终 `git status --short --untracked-files=all` 有 123 项；`styles.css` 另有 413 个其他协作者 CRLF whitespace findings。未格式化、回退或整理这些无关改动。

## 可保留

- Composer 与侧边聊天均可直接粘贴 PNG/JPEG/GIF/WebP；5 MiB 单图上限、每 context 8 附件、全局 3 并发上传。
- 图片结构校验、MIME 一致性、WebP 动画状态机、`open(wx) -> write -> close -> rename` 原子写和临时文件所有权清理均有回归。
- quota 为 256 文件 / 512 MiB；清理需要输入 `清理剪贴板`，清理后用原始 `File` 自动重试，二次 507 保留失败项和准确 usage/limits。
- pending lease 在 rename 后、生命周期锁释放前登记；浏览器先写 `context.attachments` 再 claim，claim 失败显式提示；durable source 注册成功也释放 lease：`apps/control-center/src/clipboard-lifecycle.mjs:180`、`apps/control-center/public/app.js:12003`。
- 移动附件名由子 flex item 正确省略，不再硬截断：`apps/control-center/public/styles.css:3119`。

## 总评

实现与回归已收口，生产源码处于可交付状态；真实付费 Grok E2E 仍明确标为 `partial`。

- 聚焦高风险集：`98/98 pass`。
- 最终串行全量：`1142 tests / 1141 pass / 0 fail / 1 skip`，退出码 0。
- 配置校验：`13/13 valid`，退出码 0。
- 最新浏览器：Composer/侧聊上传响应 `201,201`，claim 响应 `200,200`；2 saved、0 uploading、0 failed；1440x900 与 390x844 均零横向溢出；page errors 0，非预期 console errors 0。
- 截图：`apps/control-center/.tmp/clipboard-qa-v4/latest-smoke-desktop.png`、`apps/control-center/.tmp/clipboard-qa-v4/latest-smoke-mobile.png`。
- 最新隔离 QA：`http://127.0.0.1:4518/#token=clipboard-qa-v4-token`，PID 34316；这是测试实例，不是生产部署。
- 本轮任务路径 whitespace findings：0；全仓无关脏状态保持不动。

__DELTA__: 烛(Codex) | 2 | 证据：apps/control-center/src/clipboard-attachment.mjs:428 与 apps/control-center/src/clipboard-lifecycle.mjs:117；独立 reviewer 两次推翻“生命周期锁已完整”和“最终可批准”的先前判断，补出并关闭上传响应前 cleanup 删除窗口，最终原始竞态探针与 1142 项全量回归通过。
