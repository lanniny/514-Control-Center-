// 514cc v4.0 Forge：项目脚手架（POST /api/bootstrap/scaffold）——本地字符串模板生成
// 静态 starter（index.html + styles.css + app.js + README.md + 514.json），零网络、零安装、
// 零构建。安全纪律：目标目录解析后必须在允许根内（home 或仓库父目录），拒绝 ".." 逃逸；
// 非空目录需显式 force；dryRun 只出计划不落盘。每个关键决策都进 log，前端可回放。
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const FRAMEWORK_IDS = Object.freeze(["vanilla", "react", "dashboard"]);
export const STYLE_IDS = Object.freeze(["minimal", "paper", "ink"]);
export const THEME_IDS = Object.freeze(["light", "dark", "auto"]);
export const FONT_IDS = Object.freeze(["system", "inter", "mono"]);
export const SCAFFOLD_FILES = Object.freeze(["index.html", "styles.css", "app.js", "README.md", "514.json"]);
export const SCAFFOLD_KIND = "static-starter";

const FRAMEWORKS = new Set(FRAMEWORK_IDS);
const STYLES = new Set(STYLE_IDS);
const THEMES = new Set(THEME_IDS);
const MAX_NAME = 60;
const MAX_DESCRIPTION = 200;

const FONT_STACKS = Object.freeze({
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  inter: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, monospace",
});

const STYLE_TOKENS = Object.freeze({
  minimal: {
    light: {
      background: "oklch(0.99 0 0)",
      foreground: "oklch(0.145 0 0)",
      card: "oklch(1 0 0)",
      muted: "oklch(0.45 0 0)",
      border: "oklch(0.9 0 0)",
      primary: "oklch(0.52 0.19 15)",
    },
    dark: {
      background: "oklch(0.145 0 0)",
      foreground: "oklch(0.96 0 0)",
      card: "oklch(0.19 0 0)",
      muted: "oklch(0.65 0 0)",
      border: "oklch(0.28 0 0)",
      primary: "oklch(0.62 0.2 15)",
    },
  },
  paper: {
    light: {
      background: "oklch(0.97 0.012 75)",
      foreground: "oklch(0.24 0.02 50)",
      card: "oklch(0.99 0.006 80)",
      muted: "oklch(0.48 0.02 55)",
      border: "oklch(0.88 0.02 70)",
      primary: "oklch(0.62 0.12 45)",
    },
    dark: {
      background: "oklch(0.20 0.02 50)",
      foreground: "oklch(0.95 0.01 75)",
      card: "oklch(0.24 0.018 50)",
      muted: "oklch(0.72 0.02 70)",
      border: "oklch(0.32 0.02 50)",
      primary: "oklch(0.70 0.12 50)",
    },
  },
  ink: {
    light: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.08 0 0)",
      card: "oklch(1 0 0)",
      muted: "oklch(0.32 0 0)",
      border: "oklch(0.16 0 0)",
      primary: "oklch(0.14 0 0)",
    },
    dark: {
      background: "oklch(0.08 0 0)",
      foreground: "oklch(0.98 0 0)",
      card: "oklch(0.12 0 0)",
      muted: "oklch(0.72 0 0)",
      border: "oklch(0.82 0 0)",
      primary: "oklch(0.94 0 0)",
    },
  },
});

function validation(message) {
  return Object.assign(new Error(message), { code: "VALIDATION_FAILED" });
}

function expandUserDir(raw, homeDir) {
  if (!raw) return "";
  if (raw === "~") return homeDir;
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return join(homeDir, raw.slice(2));
  return raw;
}

function slugify(name) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "forge-app";
}

function isWithinRoot(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

function sanitizeFontStack(stack) {
  const cleaned = String(stack).replace(/[^a-zA-Z0-9\s,'"_-]/g, "").trim();
  return cleaned.slice(0, 200) || FONT_STACKS.system;
}

function resolveFont(raw) {
  const id = String(raw || "system").trim();
  if (FONT_STACKS[id]) return { id, stack: FONT_STACKS[id] };
  if (id.includes(",") || id.includes(" ")) {
    return { id: "custom", stack: sanitizeFontStack(id) };
  }
  return { id: "system", stack: FONT_STACKS.system, fallback: true, raw: id };
}

function tokenBlock(tokens) {
  return `  --background: ${tokens.background};
  --foreground: ${tokens.foreground};
  --card: ${tokens.card};
  --muted-foreground: ${tokens.muted};
  --border: ${tokens.border};
  --primary: ${tokens.primary};
  --radius: 0.625rem;`;
}

function buildStyles({ style, fontStack, framework }) {
  const palette = STYLE_TOKENS[style] || STYLE_TOKENS.minimal;
  return `:root {
${tokenBlock(palette.light)}
  color-scheme: light;
}
[data-theme="dark"] {
${tokenBlock(palette.dark)}
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${tokenBlock(palette.dark)}
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ${fontStack};
  background: var(--background);
  color: var(--foreground);
  line-height: 1.6;
}
.app-shell { max-width: 72rem; margin: 0 auto; padding: 2rem 1.25rem; }
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem;
}
.btn {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--primary);
  color: oklch(0.99 0 0);
  border-radius: var(--radius);
  padding: 0.5rem 1rem;
  font: inherit;
  cursor: pointer;
  transition: translate 150ms cubic-bezier(0.4, 0, 0.2, 1);
}
.btn:active { translate: 0 1px; }
.muted { color: var(--muted-foreground); }
${framework === "dashboard" ? `.dash-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
.dash-layout { display: grid; gap: 1.5rem; grid-template-columns: 14rem 1fr; align-items: start; }
.dash-nav { display: grid; gap: 0.25rem; }
.dash-nav button { text-align: left; background: none; border: 0; font: inherit; color: inherit; padding: 0.5rem 0.75rem; border-radius: var(--radius); cursor: pointer; }
.dash-nav button[aria-current="page"] { background: var(--card); border: 1px solid var(--border); }
@media (max-width: 48rem) { .dash-layout { grid-template-columns: 1fr; } }
` : ""}@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
`;
}

function buildApp({ framework, name }) {
  if (framework === "dashboard") {
    return `// ${name} — dashboard 骨架（514cc 脚手架，静态 ES module，无构建）
const sections = [
  { id: "overview", label: "概览" },
  { id: "metrics", label: "指标" },
  { id: "settings", label: "设置" },
];

const nav = document.getElementById("nav");
const view = document.getElementById("view");
if (nav && view) {
  const render = (active) => {
    nav.replaceChildren(...sections.map((section) => {
      const button = document.createElement("button");
      button.textContent = section.label;
      if (section.id === active) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => render(section.id));
      return button;
    }));
    const card = document.createElement("section");
    card.className = "card";
    card.innerHTML = \`<h2>\${sections.find((s) => s.id === active)?.label ?? ""}</h2>
      <p class="muted">在这里填充 \${active} 视图的内容。</p>\`;
    view.replaceChildren(card);
  };
  render("overview");
}
`;
  }
  if (framework === "react") {
    return `// ${name} — 组件化骨架（React 风格静态版：纯 ES module + 函数组件，无 JSX、无构建；
// 后续迁 Vite 时把 createCard 换成 JSX 组件即可，状态/数据流结构保持一致）
function createCard({ title, body }) {
  const card = document.createElement("section");
  card.className = "card";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const text = document.createElement("p");
  text.className = "muted";
  text.textContent = body;
  card.append(heading, text);
  return card;
}

const root = document.getElementById("app");
if (root) {
  root.replaceChildren(createCard({
    title: "就绪",
    body: "编辑 app.js 开始搭建你的界面。主题与令牌见 styles.css。",
  }));
}
`;
  }
  return `// ${name} — vanilla 骨架（514cc 脚手架，静态 ES module，无构建）
const root = document.getElementById("app");
if (root) {
  const card = document.createElement("section");
  card.className = "card";
  const heading = document.createElement("h2");
  heading.textContent = "就绪";
  const text = document.createElement("p");
  text.className = "muted";
  text.textContent = "编辑 app.js 开始搭建你的界面。主题与令牌见 styles.css。";
  const button = document.createElement("button");
  button.className = "btn";
  button.textContent = "点我";
  button.addEventListener("click", () => {
    text.textContent = \`已点击 \${(Number(text.dataset.count || 0) + 1)} 次\`;
    text.dataset.count = String(Number(text.dataset.count || 0) + 1);
  });
  card.append(heading, text, button);
  root.replaceChildren(card);
}
`;
}

// 模板全部为诚实静态产物：不引 CDN、不需要构建步骤；react 风味 = 组件化 ES module 结构
// （无 JSX，免构建），dashboard 风味 = 侧栏 + 卡片网格布局骨架
function buildTemplates({ framework, style, theme, iconLibrary, fontId, fontStack, name, description }) {
  const title = escapeHtml(name);
  const blurb = escapeHtml(description || `由 514cc 脚手架生成 · ${framework} · ${style}`);
  const themeAttr = theme === "auto" ? "" : ` data-theme="${theme}"`;
  const manifest = {
    name,
    description: description || "",
    kind: SCAFFOLD_KIND,
    framework,
    style,
    theme,
    iconLibrary,
    font: fontId,
    fontStack,
    generatedBy: "514cc control-center /api/bootstrap/scaffold",
    generatedAt: new Date().toISOString(),
  };

  const indexBody = framework === "dashboard"
    ? `<div class="app-shell">
  <header>
    <h1>${title}</h1>
    <p class="muted">${blurb}</p>
  </header>
  <div class="dash-layout">
    <nav class="dash-nav" id="nav" aria-label="主导航"></nav>
    <main id="view" class="dash-grid"></main>
  </div>
</div>`
    : `<div class="app-shell">
  <header>
    <h1>${title}</h1>
    <p class="muted">${blurb}</p>
  </header>
  <main id="app"></main>
</div>`;

  const index = `<!doctype html>
<html lang="zh-CN"${themeAttr}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
${indexBody}
<script type="module" src="./app.js"></script>
</body>
</html>
`;

  const readme = `# ${name}

${description ? `${description}\n\n` : ""}由 514cc Control Center 脚手架生成的**静态 starter**（无构建步骤、无外部依赖、不装包）。

- 产物类型：\`${SCAFFOLD_KIND}\`
- 框架风味：\`${framework}\`（全部为诚实静态产物；react = 组件化 ES module 结构，不是 JSX / 不是 create-react-app）
- 风格 / 主题：\`${style}\` / \`${theme}\`
- 图标库约定：\`${iconLibrary}\`（本地引入，勿用 CDN）
- 字体栈：\`${fontStack}\`${fontId === "inter" ? "（本机装了 Inter 才会用到它，不拉 Google Fonts）" : ""}

## 运行

任选其一：

\`\`\`bash
python -m http.server 8080
# 或
npx --yes serve .
\`\`\`

然后访问 http://127.0.0.1:8080 。

## 结构

| 文件 | 说明 |
| --- | --- |
| \`index.html\` | 入口，\`data-theme\` 控制明暗；\`auto\` 跟随系统 |
| \`styles.css\` | OKLCH 设计令牌 + 基础组件 |
| \`app.js\` | 交互骨架（ES module） |
| \`514.json\` | 生成清单（本项目的 514cc 指纹） |
`;

  return [
    { path: "index.html", content: index },
    { path: "styles.css", content: buildStyles({ style, fontStack, framework }) },
    { path: "app.js", content: buildApp({ framework, name }) },
    { path: "README.md", content: readme },
    { path: "514.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
  ];
}

function posixJoin(dir, file) {
  return `${String(dir).replace(/\/+$/, "")}/${file}`;
}

function resultPayload({ files, targetDir, log, dryRun, extras, remote = false }) {
  const relativeFiles = files.map((file) => file.path);
  const absoluteFiles = files.map((file) => (remote ? posixJoin(targetDir, file.path) : join(targetDir, file.path)));
  return {
    ok: true,
    kind: SCAFFOLD_KIND,
    placement: remote ? "remote" : "local",
    targetDir,
    files: relativeFiles,
    filesPlanned: absoluteFiles,
    fileCount: files.length,
    runHint: ["python -m http.server 8080", "npx --yes serve ."],
    log,
    ...extras,
    ...(dryRun ? {} : { filesWritten: absoluteFiles }),
  };
}

function resolveFlavor(input, log) {
  const name = String(input?.name ?? "").trim();
  if (!name) throw validation("name is required");
  if (name.length > MAX_NAME) throw validation(`name must be <= ${MAX_NAME} chars`);
  const description = String(input?.description ?? "").trim().slice(0, MAX_DESCRIPTION);

  const framework = FRAMEWORKS.has(input?.framework) ? input.framework : "vanilla";
  log.push(FRAMEWORKS.has(input?.framework) ? `framework=${framework}` : `framework 非法或缺省（${String(input?.framework ?? "")}），回退 vanilla`);
  const theme = THEMES.has(input?.theme) ? input.theme : "auto";
  log.push(THEMES.has(input?.theme) ? `theme=${theme}` : `theme 非法或缺省，回退 auto（跟随系统明暗）`);
  const style = STYLES.has(input?.style) ? input.style : "minimal";
  log.push(STYLES.has(input?.style) ? `style=${style}` : `style 非法或缺省（${String(input?.style ?? "")}），回退 minimal`);
  const iconLibrary = String(input?.iconLibrary || "lucide").trim().slice(0, 40) || "lucide";
  const fontResolved = resolveFont(input?.font);
  if (fontResolved.fallback) log.push(`font 非法（${fontResolved.raw}），回退 system`);
  else log.push(`font=${fontResolved.id}`);
  log.push(`iconLibrary=${iconLibrary}`);
  if (description) log.push(`description=${description.slice(0, 48)}`);
  return { name, description, framework, theme, style, iconLibrary, fontResolved };
}

function remoteHomeOf(host) {
  if (host?.home) return String(host.home).replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const user = String(host?.user || "user");
  return String(host?.host || "").toLowerCase().includes("win")
    ? `C:/Users/${user}`
    : `/home/${user}`;
}

export function expandRemoteDir(raw, host, name) {
  const home = remoteHomeOf(host);
  const trimmed = String(raw ?? "").trim().replace(/\\/g, "/");
  if (!trimmed) return `${home}/514-projects/${slugify(name)}`;
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return `${home}/${trimmed.slice(2).replace(/^\/+/, "")}`;
  return trimmed.replace(/\/+$/, "") || "/";
}

function isMissingRemoteDir(error) {
  return error?.code === "SFTP_FAILED" && /no such file|ENOENT|not exist/i.test(String(error.message || ""));
}

export async function scaffoldProject(input = {}, { homeDir, allowedRoots = [] } = {}) {
  const log = [];
  const { name, description, framework, theme, style, iconLibrary, fontResolved } = resolveFlavor(input, log);

  const rawDir = expandUserDir(String(input?.dir ?? "").trim(), homeDir);
  const targetDir = resolve(rawDir || join(homeDir, "514-projects", slugify(name)));
  if (!rawDir) log.push(`dir 缺省，落到 ${targetDir}`);
  if (!allowedRoots.length || !allowedRoots.some((root) => isWithinRoot(root, targetDir))) {
    throw Object.assign(new Error(`dir escapes allowed roots: ${targetDir}`), { code: "PATH_BOUNDARY" });
  }
  log.push(`targetDir=${targetDir}（限根校验通过）`);

  let existing = null;
  try {
    existing = await readdir(targetDir);
  } catch {
    // 不存在 = 可创建
  }
  const force = input?.force === true;
  if (existing?.length && !force) {
    throw validation(`target dir is not empty (pass force to scaffold anyway): ${targetDir}`);
  }
  if (existing?.length) log.push(`目标目录非空（${existing.length} 项），force=true 继续写入`);

  const files = buildTemplates({
    framework,
    style,
    theme,
    iconLibrary,
    fontId: fontResolved.id,
    fontStack: fontResolved.stack,
    name,
    description,
  });
  log.push(`模板=${framework} 风味，计划 ${files.length} 个文件：${files.map((file) => file.path).join(", ")}`);

  if (input?.dryRun !== false) {
    if (input?.dryRun !== true) log.push("dryRun 未显式指定，按 true 处理（只出计划不落盘）");
    return resultPayload({
      files,
      targetDir,
      log,
      dryRun: true,
      extras: { framework, style, theme },
    });
  }

  await mkdir(targetDir, { recursive: true });
  for (const file of files) {
    const full = join(targetDir, file.path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, file.content, "utf8");
    log.push(`已写入 ${file.path}（${Buffer.byteLength(file.content, "utf8")} B）`);
  }
  return resultPayload({
    files,
    targetDir,
    log,
    dryRun: false,
    extras: { framework, style, theme },
  });
}

export async function scaffoldRemoteProject(input = {}, { ssh } = {}) {
  const log = [];
  if (!ssh) throw Object.assign(new Error("SSH service is not wired"), { code: "SSH_UNAVAILABLE", httpStatus: 503 });
  const hostId = String(input?.hostId ?? "").trim();
  if (!hostId) throw validation("hostId is required for remote scaffold");
  const host = (ssh.list?.() ?? []).find((entry) => entry?.id === hostId);
  if (!host) throw Object.assign(new Error(`host not found: ${hostId}`), { code: "SSH_NOT_FOUND", httpStatus: 404 });
  if (host.enabled === false) {
    throw Object.assign(new Error(`host is disabled: ${host.name || hostId}`), { code: "SSH_HOST_DISABLED", httpStatus: 409 });
  }

  const { name, description, framework, theme, style, iconLibrary, fontResolved } = resolveFlavor(input, log);
  const targetDir = expandRemoteDir(input?.dir, host, name);
  if (!String(input?.dir ?? "").trim()) log.push(`dir 缺省，落到 ${targetDir}`);
  log.push(`host=${host.name || hostId}（${host.user}@${host.host}）`);

  if (typeof ssh.assertSftpPathPublic === "function") {
    ssh.assertSftpPathPublic(hostId, targetDir);
  }
  log.push(`targetDir=${targetDir}（SFTP 围栏校验通过）`);

  let existing = null;
  try {
    existing = await ssh.sftpList(hostId, targetDir);
  } catch (error) {
    if (error?.code === "SFTP_PATH_BOUNDARY" || error?.code === "SFTP_BAD_PATH") throw error;
    if (!isMissingRemoteDir(error)) {
      log.push(`列目录未成功：${error.message}（确认写入时会再试）`);
    }
  }
  const force = input?.force === true;
  if (existing?.length && !force) {
    throw validation(`target dir is not empty (pass force to scaffold anyway): ${targetDir}`);
  }
  if (existing?.length) log.push(`目标目录非空（${existing.length} 项），force=true 继续写入`);

  const files = buildTemplates({
    framework,
    style,
    theme,
    iconLibrary,
    fontId: fontResolved.id,
    fontStack: fontResolved.stack,
    name,
    description,
  });
  log.push(`模板=${framework} 风味，计划 ${files.length} 个文件：${files.map((file) => file.path).join(", ")}`);

  const extras = { framework, style, theme, hostId, hostName: host.name || hostId };

  if (input?.dryRun !== false) {
    if (input?.dryRun !== true) log.push("dryRun 未显式指定，按 true 处理（只出计划不落盘）");
    return resultPayload({ files, targetDir, log, dryRun: true, extras, remote: true });
  }

  if (typeof ssh.sftpEnsureDir !== "function") {
    throw Object.assign(new Error("SFTP mkdir is not available"), { code: "SFTP_FAILED", httpStatus: 502 });
  }
  await ssh.sftpEnsureDir(hostId, targetDir);
  for (const file of files) {
    const full = posixJoin(targetDir, file.path);
    await ssh.sftpWrite(hostId, full, file.content);
    log.push(`已写入 ${file.path}（${Buffer.byteLength(file.content, "utf8")} B）`);
  }
  return resultPayload({ files, targetDir, log, dryRun: false, extras, remote: true });
}
