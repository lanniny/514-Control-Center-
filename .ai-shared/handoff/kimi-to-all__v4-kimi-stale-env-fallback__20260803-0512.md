# kimi 环境块陈旧回退修复（Kimi → all）

> 时间：2026-08-03 · 主驾：Kimi · 范围：apps/control-center（src/process-runner.mjs / tests/redaction-jsonl.test.mjs）
> 触发：LO「为什么 kimi code 明明安装了显示未安装」（环境面板卡片误报）

## 一、根因（实证链，非猜测）

1. Kimi Code 是**原生包**：`C:\Users\16643\.kimi-code\bin\kimi.exe`（133MB，08-02 18:55 自更新，同目录有 kimi.exe.bak），不是 npm shim。
2. 持久化 PATH（User/Machine）**确实**有 `C:\Users\16643\.kimi-code\bin`——但它是昨天 18:55 安装/自更新时写入的。
3. 资源管理器（explorer）等**长驻父进程持有登录时的环境块**，不会热加载新 PATH 项；桌面端服务进程（pid 31696，08-03 05:05 启动，LISTEN 127.0.0.1:51400）沿父进程环境块 → PATH 查无 `.kimi-code\bin`。
4. `resolveCommand` 只枚举进程 env 的 PATH → 找不到 kimi → spawn ENOENT → 服务层如实标 not-installed。面板没撒谎，是进程真的看不见 kimi。
5. 而我这边的探针/隔离实例都是从**新开 shell** 派生，拥有合并后 PATH——同一台机器、同一个二进制，两个 PATH 世界，所以之前验证一直全绿。

## 二、修复

`src/process-runner.mjs resolveCommand` 加 kimi 已知安装路径回退 `~/.kimi-code/bin/kimi.exe`——与既有 codex（vendor 路径）/grok（`~/.grok/bin`）完全同款：PATH 查找优先，找不到才回退；内核解析 kimi 不再依赖启动 shell 的 PATH 状态。环境面板、运行席位、会话恢复等所有 kimi spawn 链全部受益。

## 三、验证证据

- 新单测「kimi resolves to ~/.kimi-code/bin when PATH omits it」（仿 grok 用例：临时 home 桩 + 裸 System32 PATH），`tests/redaction-jsonl.test.mjs` 19 例全绿。
- 实机复现脚本：剥离 `.kimi-code\bin` 的 PATH（模拟桌面进程环境块）→ 修复后 `resolveCommand("kimi")` 命中真实 `C:\Users\16643\.kimi-code\bin\kimi.exe`，`runProcess --version` exit 0 输出 `0.31.1`。修复前此场景即 LO 看到的 ENOENT → 未安装。
- 全量 `npm test` 回归（见本波 CHANGELOG）。

## 四、边界与注意

- **运行中的桌面端需重启服务进程才能吃到本修复**（server.mjs 是内存态，Ctrl+R 只刷前端）；重启后环境面板点「刷新」，Kimi Code 应显示 已就绪 0.31.1。
- 同类风险提示：任何「安装器新写 PATH 后、从长驻父进程派生」的 CLI 都会中这招；后续新 CLI 接入时把「安装路径是否标准」列入验证清单（proposals/multi-cli-adapter-eval.md 第四步）。
- 回退 = 还原 process-runner.mjs kimi 回退块 + 该单测。

__DELTA__: Kimi | 1 | 证据：resolveCommand kimi 回退块 + 实机剥离 PATH 复现（回退命中 kimi.exe、--version exit 0 输出 0.31.1）+ 仿 grok 单测全绿，桌面误报「未安装」根因（陈旧环境块）实证定位
