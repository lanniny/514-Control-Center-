# 本地 CLI 环境面板波（Kimi → all）

> 时间：2026-08-03 · 主驾：Kimi · 范围：apps/control-center（src/cli-env.mjs / src/cli-env/routes.mjs / server.mjs / public/modules/ccswitch-panel.js / public/app.js / public/styles.css / tests/cli-env.test.mjs / scripts/qa-cli-env-probe.mjs）
> 触发：LO 发 CC Switch 3.19.1 关于页截图（CLI 卡片墙：品牌图标+Win 徽章+当前/最新版本+就绪/可升级/未安装状态+升级/安装+全部升级+手动安装命令清单）「我需要类似于这个界面的功能」

## 一、需求拆解

参照界面语义 1:1 对齐，但全部接 514cc 自有后端与安全纪律：9 项固定 CLI 清单（席位 6 + Provider 体系 3），registry 只读查最新版，安装/升级走前端 confirmAction → 服务端 confirmed:true 硬闸（仿 market 两段式），失败如实降级不装死。

## 二、落地内容

- **服务 `src/cli-env.mjs`**：`CLI_TOOLS` 冻结清单——claude/codex/gemini/grok/kimi/pi（npm）+ opencode/openclaw（npm）+ hermes（PyPI `hermes-agent`，安装 `python -m pip install --upgrade`，版本源 `pypi.org/pypi/hermes-agent/json`）。探测 `runProcess(cmd, ["--version"], 12s)`（probe 参数不注入凭据）；状态五态：not-installed（ENOENT）/ broken（非零退出或 spawn 错，带输出尾部）/ up-to-date / upgrade-available（compareVersions 只比 x.y.z 数字核）/ installed（registry 不可达降级 latestVersion:null+latestError）。快照 10 分钟缓存 + inflight 去重，`?refresh=1` 绕过。
- **路由 `src/cli-env/routes.mjs`**：GET `/api/cli-environment` + POST `/api/cli-environment/install`；未确认 409 `CLI_ENV_NOT_CONFIRMED`、未知 id 404 `CLI_ENV_UNKNOWN_TOOL`、失败 502 `CLI_ENV_INSTALL_FAILED` 附 outputTail；同工具安装串行锁；成功后单工具重探测原位更新缓存。surface 面接线（server.mjs 仅 import + register 两行），不叠 remote-gate（本地运维操作）。
- **面板「环境」tab**（ccswitch-panel.js，首个 tab，数据懒加载只在激活时拉取——主 load() 8 请求契约不动）：头部（刷新 + 全部升级(N) 仅可升级时可用）+ 3 列卡片墙（品牌徽标/Win 徽章/当前·最新版本/状态 chip 四色/安装·升级·重装修复按钮/包名注）+ `<details>` 手动安装命令 9 行逐行复制。`mountCcSwitchPanel` 新注入 `confirmAction`（弹窗列命令+来源+全局环境警告，danger）与 `cliIconMarkup`（6 官方 sprite；opencode/openclaw/hermes 无官方徽标**不臆造**，统一 lucide terminal），缺省降级不破单测。既有 `env-check`/`.ccs-env-row`（环境变量区块）全部避让，新命名空间 `ccs-cli-*`/`clienv-*`。

## 三、验证证据

- `tests/cli-env.test.mjs` 12 例全绿：ENOENT→not-installed / 非零退出→broken 带尾部 / spawn 非 ENOENT→broken、版本解析（含 1.4.0-rc.1）、升级判定、registry 断网降级、hermes PyPI+pip 命令、未确认 409+未知 404（未过闸零子进程）、npm install 参数与缓存原位更新、失败 502 附 outputTail、TTL/refresh 语义、compareVersions、清单契约。
- 全量 `npm test` 669 pass / 0 fail / 1 skipped；`npm run validate` 通过。
- 探针 `scripts/qa-cli-env-probe.mjs`（隔离实例+真机 PATH）：9 卡渲染；Claude 2.1.220/Codex 0.146.0/Kimi 0.31.1 已就绪，Gemini 0.50.0→0.53.1、Grok 0.2.112→0.2.118、Pi 0.79.6→0.83.0 可升级（全部升级 (3) 可用），OpenCode 1.18.11/OpenClaw 2026.7.1-2/Hermes 0.19.0 未安装但最新版照常解析；升级弹窗「Gemini CLI → 0.53.1 / 命令 / 来源」取消后 install POST=0；手动命令 9 行含 pip；控制台 0 错误。截图亲查：`.qa-v4/cli-env-light.png` / `cli-env-dark.png` / `cli-env-dialog-light.png`。

## 四、边界与回退

- 安装/升级只认 9 项固定清单，不接受任意包名；hermes 走 pip 是 PyPI 分发的如实取舍（无 npm 包）。
- npm 子进程代理变量被 childProcessEnv 剥除——npm 自己读 ~/.npmrc 代理配置，失败如实回显 outputTail，不为代理特判。
- 桌面端 Ctrl+R 生效（实例在跑，pid 37892）；预览 :5520 已停。
- 回退 = 还原 src/cli-env.mjs、src/cli-env/routes.mjs、server.mjs 两行接线、ccswitch-panel.js 环境波段（tab/state/markup/动作）、app.js 注入参数、styles.css ccs-cli 段，删 tests/cli-env.test.mjs 与 scripts/qa-cli-env-probe.mjs。

__DELTA__: Kimi | 1 | 证据：src/cli-env.mjs 9 项清单五态如实探测+registry 降级不装死 + install confirmed 硬闸 409/404 + ccswitch-panel.js 环境 tab 懒加载不破 8 请求契约 + 探针实证 9 卡渲染、升级弹窗取消零外泄、控制台 0 错误
