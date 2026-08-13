import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function source(path) {
  return readFile(`${root}/${path}`, "utf8");
}

// LO 2026-08-10 严格归属制：团队树下只挂显式归属本团队的项目——此前"未归属在所有团队
// 可见"会让任何团队的树都被几十个历史项目灌满（LO：团队下面只应该显示其对应项目）。
// 08-08 的底线保留：未归属/失效归属的项目进「未归属」虚拟组兜底，不整片消失。
test("team tree is strict about ownership with an unassigned fallback group", async () => {
  const [app, css] = await Promise.all([source("public/app.js"), source("public/styles.css")]);
  assert.match(app, /function explicitProjectTeamId\(project\)/);
  assert.match(app, /return pref\.teamId && teamById\(pref\.teamId\) \? pref\.teamId : null;/);
  // 树过滤严格归属：只有显式归属本团队的项目进团队节点
  assert.match(app, /if \(explicitTeamId === selected\.id\) \{/);
  // 未归属与归属已失效团队（旧数据）的都进「未归属」虚拟组兜底——不消失
  assert.match(app, /explicitTeamId === null \|\| !knownTeamIds\.has\(explicitTeamId\)\) \{\s*\n\s*unassignedProjects\.push\(project\);/);
  assert.match(app, /const UNASSIGNED_TEAM_NODE_ID = "__unassigned__";/);
  assert.match(app, /function unassignedNodeMarkup\(projects\)/);
  assert.match(app, /if \(!projects\.length\) return "";/, "未归属组为空时不渲染");
  // 创建任务选了目录：未归属项目自动归属创建团队（已归属他团队的不抢）
  assert.match(app, /function assignCwdProjectToTeam\(cwd, teamId\)/);
  assert.match(app, /if \(!project \|\| explicitProjectTeamId\(project\) !== null\) return;/);
  assert.match(app, /if \(submission\.cwd\) assignCwdProjectToTeam\(submission\.cwd, composerTarget\.teamId \|\| state\.selectedTeamId\);/);
  // 分组视觉压暗；旧的行级"未归属"徽标已随混显语义一起退役
  assert.match(css, /\.is-unassigned-team > \.project-row \.team-toggle \{/);
  assert.ok(!app.includes("unassigned-badge"), "行级未归属徽标还在渲染路径上");
  assert.ok(!app.includes('class="project-empty">无从属项目'), "旧的「无从属项目」兜底文案仍在渲染路径上");
});

// LO 2026-08-10：项目树内按逻辑会话聚合——Console run 的 sessions 映射（成员→原生会话 id）
// 是跨 CLI 唯一硬关联；被引用的原生会话按 run 分组挂在 CLI 分组之前。裸 CLI 会话不猜不并。
test("project tree aggregates native sessions by collaboration run", async () => {
  const [app, css] = await Promise.all([source("public/app.js"), source("public/styles.css")]);
  // 关联索引：run.sessions 数组/对象两形态都归一；过短 id 不收（防误匹配）
  assert.match(app, /function runSessionsMap\(run\)/);
  assert.match(app, /function runSessionLinkIndex\(\)/);
  assert.match(app, /if \(id\.length >= 8 && !index\.has\(id\)\) index\.set\(id, \{ run, memberId \}\);/);
  // 匹配：精确（kimi ses_*）+ 后缀（codex rollout 文件名尾巴是 thread uuid）
  assert.match(app, /if \(id\.endsWith\(rid\)\) return link;/);
  // 分组：run 组按最近活跃排序、挂在 CLI 组前；未关联会话仍走 CLI 分组（块化合成，供截断整块收编）
  assert.match(app, /sort\(\(a, b\) => runGroupLatestMs\(b\) - runGroupLatestMs\(a\)\)/);
  assert.match(app, /blocks\.push\(\.\.\.cliSessionGroupBlocks\(project, unlinked\)\);/);
  // Codex 式截断（LO 2026-08-11）：超 TREE_SESSIONS_CAP 的块折叠为「展开显示」行，点击进 showAllSessions 集合
  assert.match(app, /const TREE_SESSIONS_CAP = 6;/);
  assert.match(app, /state\.showAllSessions\.has\(project\.id\)/);
  assert.match(app, /data-sessions-showmore="\$\{escapeHtml\(project\.id\)\}"/);
  assert.match(app, /event\.target\.closest\("\[data-sessions-showmore\]"\)/);
  // 一致化（LO 2026-08-10）：组头与成员行点击都直接进 run 完整视图（与会话列表一致），
  // 不再落原生只读预览；仅独立 chevron 按钮折叠/展开成员列表（收起态内存记账）
  assert.match(app, /data-run-group-toggle="\$\{escapeHtml\(run\.id\)\}"/);
  assert.match(app, /state\.collapsedRunGroups\.has\(run\.id\)/);
  assert.match(app, /aria-expanded="\$\{!collapsed\}" aria-controls="\$\{escapeHtml\(membersId\)\}"/);
  assert.match(app, /class="run-group-toggle" type="button" data-run-group-toggle/);
  assert.match(app, /class="run-group-head\$\{selected \? " is-selected" : ""\}" type="button" data-run-select="\$\{escapeHtml\(run\.id\)\}"/);
  assert.match(app, /class="session-link run-member-link" type="button"\s*\n\s*data-run-select="\$\{escapeHtml\(run\.id\)\}"/);
  assert.match(app, /runMemberLabel\(run, memberId\)/);
  assert.match(app, /run\.teamRoster\?\.find\(\(member\) => member\?\.id === memberId\)\?\.label/);
  // 折叠委托：hidden 切换 + aria 同步，不做全量重渲染（保焦点纪律）
  assert.match(app, /event\.target\.closest\("\[data-run-group-toggle\]"\)/);
  assert.match(app, /if \(members\) members\.hidden = !wasCollapsed;/);
  // run 列表更新必须带动树内聚合翻页（commitMarkup 幂等，不抢焦点）
  assert.match(app, /renderRailMetaSections\(\);\s*\n\s*renderProjects\(\); \/\/ run\.sessions 变了/);
  // 样式
  for (const rule of [".run-group-toggle {", ".run-group-head {", ".run-group-head.is-selected {", ".run-member-chip {", ".run-session-row .session-link {", ".run-group-members {", '.run-group-toggle[aria-expanded="true"] .chevron {']) {
    assert.ok(css.includes(rule), `缺少样式 ${rule}`);
  }
});

// LO 2026-08-08 参考图波：右栏是工具标签栏（任务上下文/审阅/浏览器/文件），
// 终端回到底部抽屉由右上角图标开合，标签全关时露出工具选择列表。
test("the rail is a closable tool tab strip with a picker empty state", async () => {
  const [html, railTools, app] = await Promise.all([
    source("public/index.html"),
    source("public/rail-tools.js"),
    source("public/app.js"),
  ]);
  for (const id of ["rail-tabs", "rail-tab-add", "rail-tool-menu", "rail-tool-panels", "rail-tool-picker", "rail-empty-state"]) {
    assert.match(html, new RegExp(`id="${id}"`), `右栏缺少 ${id}`);
  }
  for (const panel of ["mission", "review", "browser", "files"]) {
    assert.match(html, new RegExp(`data-tool-panel="${panel}"`), `缺少工具页 ${panel}`);
  }
  // 任务上下文页必须真的包住环境舱与五页，否则 514cc 的任务上下文会随改版丢失
  const missionPanel = html.slice(html.indexOf('data-tool-panel="mission"'), html.indexOf('data-tool-panel="review"'));
  assert.match(missionPanel, /id="mission-environment-panel"/);
  assert.match(missionPanel, /data-registry-tab="tasks"/);
  assert.match(missionPanel, /data-registry-tab="connections"/);
  // ➕ 菜单与空态选择器同源，避免"菜单有、空态没有"的漂移
  assert.match(railTools, /picker\.innerHTML = RAIL_TOOLS/);
  assert.match(railTools, /menu\.innerHTML = RAIL_TOOLS/);
  assert.match(app, /createRailTools\(\{/);
  assert.match(app, /createRailPanels\(\{/);
  // 换 run 不触发标签激活：每个 selectRun 出口都必须让当前工具页重新对账，否则审阅/文件会停在旧任务
  assert.match(app, /function syncRailToActiveRun\(\)/);
  const selectRunCalls = app.match(/missionControlDock\?\.selectRun\([^\n]*\);\n\s*syncRailToActiveRun\(\);/g) ?? [];
  const allSelectRun = app.match(/missionControlDock\?\.selectRun\(/g) ?? [];
  assert.equal(selectRunCalls.length, allSelectRun.length, "有 selectRun 出口没有同步右栏工具页");
});

// 抽屉会在启动时恢复上次的打开态并立刻挂载，比 token 自举更早，
// 不等 apiReady 就发 /api/pty 会拿 401 并被渲染成「终端服务异常」。
test("terminal mount waits for token bootstrap and offers a retry", async () => {
  const [terminal, server] = await Promise.all([
    source("public/terminal-panel.js"),
    source("server.mjs"),
  ]);
  // 实际挂载体是 mountOnce（mount 只做串行化），token 自举必须在它的第一条语句上
  assert.match(terminal, /async function mountOnce\(\) \{\n(?:\s*\/\/[^\n]*\n)*\s*await apiReady;/);
  assert.match(terminal, /data-terminal-retry/);
  assert.match(terminal, /addEventListener\("click", \(\) => void mount\(\), \{ once: true \}\)/);
  // 错误文案来自后端，进 innerHTML 前必须转义
  assert.match(terminal, /escapeHtml\(String\(error\?\.message/);
  assert.match(terminal, /import \{ escapeHtml \} from "\.\/utils\.js"/);
  assert.match(server, /"\/utils\.js": "utils\.js"/);
});

// LO 2026-08-08：打开终端后打不出字。输入失败被 `.catch(() => {})` 静默吞掉，
// 表象就是"终端坏了"；xterm 在隐藏容器里的焦点也会丢，重新展开后必须重新聚焦。
test("terminal input failures surface and focus is restored on reopen", async () => {
  const [terminal, chrome] = await Promise.all([
    source("public/terminal-panel.js"),
    source("public/workbench-chrome.js"),
  ]);
  // 只约束 input 一条路径：resize 失败不阻断可用性且高频，刻意不提示（见该处注释）
  const inputCall = terminal.slice(terminal.indexOf("term.onData("), terminal.indexOf("const observer = new ResizeObserver"));
  assert.ok(!inputCall.includes("catch(() => {})"), "输入失败仍被静默吞掉");
  assert.match(terminal, /\[输入未送达：/);
  assert.match(terminal, /tab\.inputBroken/);
  assert.match(terminal, /paneEl\.addEventListener\("mousedown", \(\) => term\.focus\(\)\)/);
  assert.match(terminal, /function focusActive\(\)/);
  assert.match(terminal, /return \{ mount, root, focusActive \}/);
  assert.match(chrome, /panel\.focusActive\?\.\(\)/);
  // Nerd Font 候选：oh-my-posh 字形没有它会显示成方块
  assert.match(terminal, /Nerd Font/);
});

// LO 2026-08-08：打开终端看到同一份首屏重复很多条。每条 SSE 连接都会重放整个环形缓冲，
// 重复挂载/重复 attach 留下的残留订阅会把同一段输出一遍遍写进终端。
test("terminal mounting is idempotent so replayed buffers cannot stack", async () => {
  const terminal = await source("public/terminal-panel.js");
  // mount 串行化：抽屉展开、重试按钮、宿主自举都可能触发，不加锁会各自 spawn 一个 shell
  assert.match(terminal, /if \(mounting\) return mounting;/);
  assert.match(terminal, /mounting = mountOnce\(\)\.finally\(/);
  // 重挂载前释放旧订阅；同 id 重复 attach 先拆旧的
  assert.match(terminal, /for \(const tab of tabs\.values\(\)\) disposeTab\(tab\);\n\s*tabs\.clear\(\);/);
  assert.match(terminal, /const existing = tabs\.get\(session\.id\);\n\s*if \(existing\) \{\n\s*disposeTab\(existing\);/);
  // 关闭与重复挂载共用同一条释放路径，避免两处各漏一半
  assert.match(terminal, /function disposeTab\(tab\)/);
  assert.match(terminal, /disposeTab\(tab\); \/\/ 与重复挂载走同一条释放路径/);
  // 孤儿面板（已出 tabs Map 但 DOM 还在）必须按 DOM 全量清 is-active，否则会与当前面板同时可见
  assert.match(terminal, /for \(const pane of root\.querySelectorAll\("\.terminal-pane"\)\) pane\.classList\.remove\("is-active"\);/);
});

// LO 2026-08-08：反复拉伸/收缩终端外框会出现重复显示。
// ConPTY 每收到一次 resize 就让 shell 重绘整屏，拖动时逐帧上报会把几十份重绘追加进缓冲。
test("terminal resize is debounced and skipped when the size did not change", async () => {
  const terminal = await source("public/terminal-panel.js");
  // fit 立即执行保证视觉跟手，上报去抖
  assert.match(terminal, /window\.clearTimeout\(tab\.resizeTimer\);\n\s*tab\.resizeTimer = window\.setTimeout\(/);
  // 尺寸没变就完全不打扰 ConPTY
  assert.match(terminal, /const size = `\$\{term\.cols\}x\$\{term\.rows\}`;\n\s*if \(size === tab\.lastSize\) return;/);
  assert.match(terminal, /tab\.lastSize = size;/);
  // 初值与服务端已知尺寸对齐，首帧不做无谓上报
  assert.match(terminal, /lastSize: `\$\{session\.cols \?\? 0\}x\$\{session\.rows \?\? 0\}`/);
  // 去抖中的 resize 不能打到已释放的会话上
  assert.match(terminal, /window\.clearTimeout\(tab\.resizeTimer\); \/\/ 去抖中的 resize/);
  // body 传对象，不再自己 stringify（否则 cols/rows 会被整个丢掉）
  assert.match(terminal, /body: \{ cols: term\.cols, rows: term\.rows \}/);
});

// 流一断就永久失联 = 输入发得出去但收不到回显（"终端打不出字"）；
// 重连时若仍重放缓冲 = 每断一次多一整份首屏（"打开终端有很多条"）。
test("terminal stream reconnects without replaying the buffer again", async () => {
  const [terminal, routes] = await Promise.all([
    source("public/terminal-panel.js"),
    source("src/pty/routes.mjs"),
  ]);
  assert.match(terminal, /const query = attempt === 0 \? "" : "\?replay=0";/);
  assert.match(terminal, /async function reconnectStream\(sessionId, tab, attempt, reason\)/);
  assert.match(terminal, /if \(attempt >= 5\)/);
  assert.match(terminal, /Math\.min\(8000, 400 \* 2 \*\* attempt\)/);
  // 正常收尾（进程退出）不该触发重连
  assert.match(terminal, /if \(!tab\.exited && !tab\.streamCtl\.signal\.aborted\) \{/);
  // 重试用尽才如实写进终端，不静默假死
  assert.match(terminal, /请关闭该标签后重开/);
  // 服务端必须认这个开关，否则重连仍会重放
  assert.match(routes, /replay: url\.searchParams\.get\("replay"\) !== "0"/);
});

// 根因（探针实证）：终端视图容器原本页面一加载就无条件 mount，白起一个 pwsh；
// 随后底部抽屉 attach 同一会话，同一个 PTY 上挂两条 SSE、各重放一次缓冲。
// 改为可见才挂载后，探针实测 SSE 连接数 2 → 1、首屏出现次数 1。
test("terminal view mounts only when visible so it cannot double-subscribe", async () => {
  const terminal = await source("public/terminal-panel.js");
  assert.match(terminal, /new IntersectionObserver\(\(entries\) => \{/);
  assert.match(terminal, /if \(!entries\.some\(\(entry\) => entry\.isIntersecting\)\) return;/);
  assert.match(terminal, /observer\.disconnect\(\);\n\s*void apiReady\.then\(\(\) => createTerminalPanel\(root\)\.mount\(\)\);/);
  assert.match(terminal, /observer\.observe\(root\);/);
  // 自举不得再无条件挂载
  assert.ok(
    !/const start = \(\) => void apiReady\.then\(\(\) => \{[\s\S]*?createTerminalPanel\(root\)\.mount\(\)/.test(terminal),
    "终端视图又回到了页面加载即挂载",
  );
});

test("rail tool panels stay honest about worktree-less runs and keep escape scoped", async () => {
  const [panels, railTools] = await Promise.all([
    source("public/modules/rail-panels.js"),
    source("public/rail-tools.js"),
  ]);
  // 没有隔离工作树时直接报边界，不发注定 422 的 diff 请求
  assert.match(panels, /没有隔离工作树/);
  // Escape 必须在 capture 阶段消费并 preventDefault，否则关菜单会连带折叠整条右栏
  assert.match(railTools, /document\.addEventListener\("keydown", handleKeydown, true\)/);
  assert.match(railTools, /event\.preventDefault\(\);\n\s*setMenuOpen\(false\);/);
  // 浏览器页不内嵌网页视图，打开一律交给宿主的系统浏览器出口
  assert.match(panels, /openSystemBrowser\?\.\(url\)/);
  assert.ok(!panels.includes("<iframe"), "浏览器页不得内嵌 iframe 网页视图");
});

test("rail tool shortcut labels are wired and do not hijack browser-reserved keys", async () => {
  const [railTools, app] = await Promise.all([
    source("public/rail-tools.js"),
    source("public/app.js"),
  ]);
  assert.doesNotMatch(railTools, /shortcut: "Ctrl\+(?:T|P)"/);
  assert.match(railTools, /shortcut: "Ctrl\+Alt\+B"/);
  assert.match(railTools, /shortcut: "Ctrl\+Alt\+F"/);
  assert.match(app, /event\.altKey && !event\.shiftKey && event\.key\.toLowerCase\(\) === "b"/);
  assert.match(app, /handleWorkbenchEnvironmentAction\("browser"\)/);
  assert.match(app, /event\.altKey && !event\.shiftKey && event\.key\.toLowerCase\(\) === "f"/);
  assert.match(app, /handleWorkbenchEnvironmentAction\("files"\)/);
});

test("terminal is a bottom drawer again with no persistent bar", async () => {
  const [html, chrome, app] = await Promise.all([
    source("public/index.html"),
    source("public/workbench-chrome.js"),
    source("public/app.js"),
  ]);
  assert.match(html, /id="terminal-drawer"/);
  assert.match(html, /id="terminal-drawer-close"/);
  assert.match(html, /id="workbench-terminal-container"/);
  assert.match(chrome, /function bootTerminalDrawer\(\)/);
  assert.match(chrome, /bootTerminalDrawer\(\);/);
  // 撤掉的是常驻折叠条与底部启动条，不是终端本身
  assert.ok(!html.includes("terminal-dock-bar"), "终端常驻折叠条又回来了");
  assert.ok(!html.includes("terminal-dock-hint"), "终端常驻提示条又回来了");
  assert.ok(!html.includes("mission-tool-launcher"), "底部工具启动条仍在 index.html 中");
  assert.ok(!chrome.includes("bootDockTerminalTab"), "右栏终端标签控制器仍在");
  // 折叠钮必须挂常驻的标签条动作区，挂进任务上下文页会随标签切换消失
  assert.match(chrome, /rail-tabbar-actions"\)\?\.appendChild\(collapseButton\)/);
  // LO 2026-08-08：终端要在操作台下方。conversation-pane 的孩子都钉了显式 grid-row，
  // 抽屉丢掉行号就会被 auto-placement 塞进 recovery-bar 隐藏后的空位、跑到输入框上方。
  const railCss = await source("public/forge/rail-tools.css");
  assert.match(railCss, /\.terminal-drawer \{[^}]*grid-row: -2 \/ -1;/s);
  assert.match(app, /byId\("global-terminal-toggle"\)\?\.click\(\); \/\/ 终端是底部抽屉/);
});

test("removed docks leave no orphan selectors behind", async () => {
  const files = ["public/styles.css", "public/forge/workbench.css", "public/forge/codex-desktop.css"];
  for (const file of files) {
    const css = await source(file);
    assert.ok(!css.includes("terminal-dock"), `${file} 仍引用已删除的底部终端 dock`);
    assert.ok(!css.includes("mission-tool-launcher"), `${file} 仍引用已删除的底部工具启动条`);
    let depth = 0;
    for (const char of css) {
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      assert.ok(depth >= 0, `${file} 花括号失衡`);
    }
    assert.equal(depth, 0, `${file} 花括号未闭合`);
  }
  const styles = await source("public/styles.css");
  assert.match(styles, /\.registry-terminal-body \.terminal-shell \{/);
  assert.match(styles, /\.registry-tab-menu \{/);
  assert.match(styles, /\.registry-tab\.is-tool \{/);
});


// LO 2026-08-09 报障：点「确认恢复并继续」后恢复条挂了整整一轮不消失。
// 根因：直接续聊的 HTTP 要等整轮 turn 跑完才返回（orchestrator continue 返回 tracked），期间
// state.runs 停在 recovery_required 旧快照，SSE 每次重渲染 renderSelectedRun 都把恢复条画回去。
// 修复：run 列表重载闸覆盖状态敏感事件，让真实状态尽快翻页，恢复条只跟随 live 状态。
test("recovery bar follows live run status, not the stale post-ack snapshot", async () => {
  const app = await source("public/app.js");
  // 重载闸必须包含：状态翻页（recovery 进出）、轮次退还、用户消息落盘、轮开始
  const reloadGate = app.match(/if \(\/(.*?)\/i\.test\(event\.type\)\) scheduleRunsReload\(\);/s);
  assert.ok(reloadGate, "找不到 scheduleRunsReload 的事件闸");
  const gated = reloadGate[1];
  for (const type of ["recovery_required", "round_refunded", "turn_started", "turn_completed", "user\\.message", "assistant\\.message"]) {
    assert.ok(gated.includes(type), `runs 重载闸缺少 ${type}——恢复条/轮次 meta 会停在旧快照`);
  }
  // 显隐契约：非 recovery_required 一律隐藏并消费确认标记；acked 文案只在确认后、发送前出现
  assert.match(app, /if \(!run \|\| run\.status !== "recovery_required"\) \{/);
  assert.match(app, /state\.recoveryAckRunId = null; \/\/ 状态已翻页，确认标记失效/);
  assert.match(app, /const acked = state\.recoveryAckRunId === run\.id;/);
  assert.ok(app.includes("已确认——下次发送将自动继续"), "acked 文案缺失");
});


// LO 2026-08-09 需求：composer 发送框要有 Codex 桌面式权限模式选择器（pill + 上弹菜单）。
// 契约：`<select id="task-permission">` 仍是唯一状态源（提交/自动化/statusline 链路全部不动），
// pill/menu 只做镜像；菜单文案如实对应 permissions.json 的 modes，不虚构后端没有的能力档。
test("permission pill mirrors the task-permission select as single source of truth", async () => {
  const [html, app, css] = await Promise.all([
    source("public/index.html"),
    source("public/app.js"),
    source("public/styles.css"),
  ]);
  // 结构：原 select 隐藏保留在 task-permission-pick 内，pill 与 menu 同容器
  const pick = html.match(/<div class="model-pick permission-pick" id="task-permission-pick"[^>]*>([\s\S]*?)<\/div>\s*<span class="composer-session-controls"/);
  assert.ok(pick, "找不到 task-permission-pick 容器");
  assert.match(pick[1], /<select id="task-permission"[^>]*hidden>/);
  assert.match(pick[1], /class="permission-pill" id="permission-pill"/);
  assert.match(pick[1], /class="permission-menu" id="permission-menu" role="menu"/);
  // 状态源契约：pill 只读 select，点选回写 select 并走既有 change 链路
  assert.match(app, /const PERMISSION_MODE_META = \{/);
  for (const mode of ["plan", "review", "build", "ask", "auto", '"full-access"', "config"]) {
    assert.ok(PERMISSION_MODE_META_BLOCK(app).includes(`${mode}:`), `PERMISSION_MODE_META 缺少 ${mode}`);
  }
  // Codex 官方档文案与桌面批准菜单逐字对齐
  for (const label of ["请求批准", "帮我批准", "完全访问权限", "自定义 (config.toml)"]) {
    assert.ok(app.includes(label), `官方档文案缺失：${label}`);
  }
  // 官方档开关：adapter 声明 danger-full-access（预设族标记位）时 composer 才出官方四档
  assert.match(app, /if \(permissionModes\.includes\("danger-full-access"\)\) \{/);
  assert.match(app, /"workspace-write:on-failure": "auto"/);
  assert.match(app, /"danger-full-access": "full-access"/);
  assert.match(app, /"config-default": "config"/);
  assert.match(app, /function syncPermissionPill\(\)/);
  assert.match(app, /function setPermissionMenuOpen\(open\)/);
  assert.match(app, /data-permission-option/);
  assert.match(app, /select\.value = option\.dataset\.permissionOption;/);
  assert.match(app, /select\.dispatchEvent\(new Event\("change"\)\)/);
  // select 重渲染后必须回同步 pill，两处（静态/discovery）都要
  const syncCalls = app.match(/syncPermissionPill\(\);/g) || [];
  assert.ok(syncCalls.length >= 3, `syncPermissionPill 调用点不足（${syncCalls.length}），静态/discovery 渲染后 pill 会失同步`);
  // 样式：pill 是圆角 ghost 按钮，菜单上弹
  assert.match(css, /\.permission-pill \{/);
  assert.match(css, /\.permission-menu \{[^}]*bottom: calc\(100% \+ 6px\);/s);
  assert.match(css, /\.permission-menu-row\.is-active \{/);
});

// LO 2026-08-10：会话配置不应一刀切固化。模型（per-turn 覆盖）、Effort（codex turn/start 与
// spawn argv 都是每轮参数）与权限白名单迁移（降档 / Codex ask↔auto 同 sandbox）可会话中热改、
// 下一轮生效；Codex 沙箱轴绑原生 thread 真固化，不开口子。热改必须过服务端校验并落审计事件。
// recovery_required 时确认恢复可随热改一次性携带（acknowledgeRecovery），与 continue() 同语义。
test("hot control updates are wired end-to-end with a strict transition whitelist", async () => {
  const [app, orchestrator, server] = await Promise.all([
    source("public/app.js"),
    source("src/orchestrator.mjs"),
    source("server.mjs"),
  ]);
  // 后端：白名单表 + 更新入口 + 审计事件 + 闸与 continue 准入对齐
  assert.match(orchestrator, /const PERMISSION_HOT_TRANSITIONS = Object\.freeze\(\{/);
  for (const pair of ['review: ["plan"]', 'build: ["review", "plan"]', 'ask: ["auto"]', 'auto: ["ask"]']) {
    assert.ok(orchestrator.includes(pair), `PERMISSION_HOT_TRANSITIONS 缺少 ${pair}`);
  }
  assert.match(orchestrator, /async updateRunControls\(id, patch = \{\}, \{ actor = "operator", acknowledgeRecovery = false \} = \{\}\)/);
  assert.match(orchestrator, /run\.control_changed/);
  // 恢复确认通道：原子放弃 claim + 改档，审计事件不静默
  assert.match(orchestrator, /run\.recovery_acknowledged/);
  assert.match(orchestrator, /run\.status === "waiting_approval"/);
  assert.match(orchestrator, /run\.status === "recovery_required"/);
  // HTTP：PATCH /api/runs/:id/controls（body.acknowledgeRecovery 随热改携带一次性恢复确认）
  assert.match(server, /\/api\\\/runs\\\/\(\[\^\/\]\+\)\\\/controls\$/);
  assert.match(server, /updateRunControls\(/);
  assert.match(server, /acknowledgeRecovery: acknowledgeRecovery === true/);
  // 前端：续聊只隐藏模型，Effort/权限放开；选项随当前档收窄；改动走 PATCH 并回滚于失败
  assert.match(app, /const PERMISSION_HOT_TRANSITIONS = Object\.freeze\(\{/);
  assert.match(app, /function continuingPermissionOptions\(currentMode\)/);
  assert.match(app, /async function applyRunControlChange\(controlId, value\)/);
  assert.match(app, /`\/api\/runs\/\$\{encodeURIComponent\(run\.id\)\}\/controls`/);
  // 恢复条确认后热改携带一次性 acknowledgeRecovery，成功后消费确认标记
  assert.match(app, /patch\.acknowledgeRecovery = true/);
  assert.match(app, /state\.recoveryAckRunId = null; \/\/ 确认标记一次性消费/);
  assert.match(app, /elements\["task-effort-pick"\]\.hidden = effortUnsupported;/);
  assert.match(app, /elements\["task-permission-pick"\]\.hidden = false;/);
  // 模型同样热改：Codex turn/start 实测接受 per-turn model，picker 续聊不再隐藏
  assert.match(app, /elements\["task-model-pick"\]\.hidden = modelUnsupported;/);
  assert.match(app, /controlId === "task-model"\s*\n\s*\? \{ model: value \}/);
  // Adapter 必须把 model 带进 turn/start；无 override 不下发
  const codexAdapter = await source("src/adapters/codex-app-server.mjs");
  assert.match(codexAdapter, /\.\.\.\(model \? \{ model \} : \{\}\),/);
  // SSE 重载闸必须覆盖 run.control_changed，否则 pill/meta 停在旧档
  assert.match(app, /control_changed\)\|task/);
  // 文案如实：不再笼统宣称"会话配置已固化"
  assert.ok(!app.includes("会话配置已固化"), "一刀切的固化文案还在");
  assert.ok(app.includes("Codex 沙箱轴随原生会话固化；模型、Effort、权限降档与 ask↔auto 可热调"), "分层文案缺失");
});

function PERMISSION_MODE_META_BLOCK(app) {
  return app.match(/const PERMISSION_MODE_META = \{([\s\S]*?)\};/)?.[1] || "";
}

// LO 2026-08-10：审批后长期不输出（刷新才恢复）的根因——分批挂载任何一步抛异常都会让
// aria-busy 永久 true，SSE 的 selectedRun 更新被 busy 闸无限空转。两层防线：
// 挂载异常清闸放行（根治）+ busy 闸等待帧数上限、超时强制复位重渲（防御）。
test("a failed conversation mount cannot deadlock the live stream", async () => {
  const app = await source("public/app.js");
  // 根治：batched 挂载主体包 try/catch——异常时 release ownership、清 aria-busy、落诊断
  const mount = app.slice(app.indexOf("async function replaceConversationStreamBatched"), app.indexOf("const CONVERSATION_WINDOW_SIZE"));
  assert.ok(mount.includes("} catch (error) {"), "batched 挂载缺异常兜底");
  assert.ok(mount.includes('stream.removeAttribute("aria-busy");'), "异常路径未清挂载闸");
  assert.ok(mount.includes("会话流分批挂载失败（已放开渲染闸）"), "异常未落诊断");
  // 防御：busy 闸等待有帧数上限；超时作废旧挂载代际（stillOwned 令其自殁）、清闸、完整重渲
  assert.ok(app.includes("const STREAM_BUSY_WAIT_MAX_FRAMES = 600;"), "busy 闸缺超时上限");
  assert.ok(app.includes("streamBusyWaitFrames < STREAM_BUSY_WAIT_MAX_FRAMES"), "busy 等待未计数");
  assert.ok(app.includes("会话流挂载闸超时，已强制复位并重渲"), "超时复位未落诊断");
  assert.ok(app.includes("conversationRenderGeneration += 1;"), "超时未作废旧挂载代际");
});

// LO 2026-08-10：多轮审批后流尾堆一列「动作审批已批准」——已决议行按结果聚合成一行，
// 审计语义保留（次数 + 最近时间），拒绝单独成行（fail-closed 信号不折叠进批准里）。
test("resolved inline approvals aggregate into one line per decision", async () => {
  const app = await source("public/app.js");
  // 决议记录带时间戳（聚合一行的「最近时间」来源）
  assert.match(app, /inlineApprovalOutcomes\.set\(id, \{\s*\n\s*runId: item\.runId,\s*\n\s*decision,\s*\n\s*resolvedAt: new Date\(\)\.toISOString\(\),/);
  // 按 approve/deny 分组各出一行；次数 >1 带 ×N；同一 run 的 data-stream-key 稳定（重渲染幂等）
  assert.match(app, /\["approve", "deny"\]\.map\(\(decision\) => \{/);
  assert.match(app, /group\.length > 1 \? ` ×\$\{group\.length\}` : ""/);
  assert.match(app, /data-stream-key="approval-result:\$\{decision\}:\$\{escapeHtml\(run\.id\)\}"/);
  // 不再逐条展开 outcomes（旧的 .entries().map 堆叠路径已退役）
  const fn = app.slice(app.indexOf("function inlineApprovalsMarkup"), app.indexOf("// 内联审批决议"));
  assert.ok(!fn.includes("inlineApprovalOutcomes.entries()"), "已决议仍在逐条堆叠");
});
