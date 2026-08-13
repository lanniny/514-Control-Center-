// 514cc v4.0 Forge：项目脚手架（POST /api/bootstrap/scaffold）——本地字符串模板生成
// 静态 starter（index.html + styles.css + app.js + README.md + 514.json），零网络、零安装、
// 零构建。安全纪律：目标目录解析后必须在允许根内（home 或仓库父目录），拒绝 ".." 逃逸；
// 非空目录需显式 force；dryRun 只出计划不落盘。每个关键决策都进 log，前端可回放。
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const FRAMEWORKS = new Set(["vanilla", "react", "dashboard"]);
const THEMES = new Set(["light", "dark", "auto"]);
const DEFAULT_FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const MAX_NAME = 60;

function validation(message) {
  return Object.assign(new Error(message), { code: "VALIDATION_FAILED" });
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

// 模板全部为诚实静态产物：不引 CDN、不需要构建步骤；react 风味 = 组件化 ES module 结构
// （无 JSX，免构建），dashboard 风味 = 侧栏 + 卡片网格布局骨架
function buildTemplates({ framework, style, theme, iconLibrary, font, name }) {
  const title = escapeHtml(name);
  const themeAttr = theme === "auto" ? "" : ` data-theme="${theme}"`;
  const manifest = {
    name,
    framework,
    style,
    theme,
    iconLibrary,
    font,
    generatedBy: "514cc control-center /api/bootstrap/scaffold",
    generatedAt: new Date().toISOString(),
  };

  const styles = `:root {
  --background: oklch(0.99 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --muted-foreground: oklch(0.45 0 0);
  --border: oklch(0.9 0 0);
  --primary: oklch(0.52 0.19 15);
  --radius: 0.625rem;
  color-scheme: light;
}
[data-theme="dark"] {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.96 0 0);
  --card: oklch(0.19 0 0);
  --muted-foreground: oklch(0.65 0 0);
  --border: oklch(0.28 0 0);
  --primary: oklch(0.62 0.2 15);
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ${font};
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

  const indexBody = framework === "dashboard"
    ? `<div class="app-shell">
  <header>
    <h1>${title}</h1>
    <p class="muted">由 514cc 脚手架生成 · ${framework} · ${style}</p>
  </header>
  <div class="dash-layout">
    <nav class="dash-nav" id="nav" aria-label="主导航"></nav>
    <main id="view" class="dash-grid"></main>
  </div>
</div>`
    : `<div class="app-shell">
  <header>
    <h1>${title}</h1>
    <p class="muted">由 514cc 脚手架生成 · ${framework} · ${style}</p>
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

  const app = framework === "dashboard"
    ? `// ${name} — dashboard 骨架（514cc 脚手架，静态 ES module，无构建）
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
`
    : framework === "react"
      ? `// ${name} — 组件化骨架（React 风格静态版：纯 ES module + 函数组件，无 JSX、无构建；
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
`
      : `// ${name} — vanilla 骨架（514cc 脚手架，静态 ES module，无构建）
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

  const readme = `# ${name}

由 514cc Control Center 脚手架生成的静态 starter（无构建步骤、无外部依赖）。

- 框架风味：\`${framework}\`（全部为诚实静态产物；react = 组件化 ES module 结构）
- 风格 / 主题：\`${style}\` / \`${theme}\`
- 图标库约定：\`${iconLibrary}\`（本地引入，勿用 CDN）
- 字体栈：\`${font}\`

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
| \`index.html\` | 入口，\`data-theme\` 控制明暗 |
| \`styles.css\` | OKLCH 设计令牌 + 基础组件 |
| \`app.js\` | 交互骨架（ES module） |
| \`514.json\` | 生成清单（本项目的 514cc 指纹） |
`;

  return [
    { path: "index.html", content: index },
    { path: "styles.css", content: styles },
    { path: "app.js", content: app },
    { path: "README.md", content: readme },
    { path: "514.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
  ];
}

export async function scaffoldProject(input = {}, { homeDir, allowedRoots = [] } = {}) {
  const log = [];
  const name = String(input?.name ?? "").trim();
  if (!name) throw validation("name is required");
  if (name.length > MAX_NAME) throw validation(`name must be <= ${MAX_NAME} chars`);

  const framework = FRAMEWORKS.has(input?.framework) ? input.framework : "vanilla";
  log.push(FRAMEWORKS.has(input?.framework) ? `framework=${framework}` : `framework 非法或缺省（${String(input?.framework ?? "")}），回退 vanilla`);
  const theme = THEMES.has(input?.theme) ? input.theme : "auto";
  log.push(THEMES.has(input?.theme) ? `theme=${theme}` : `theme 非法或缺省，回退 auto（跟随系统明暗）`);
  const style = String(input?.style || "minimal").trim().slice(0, 40) || "minimal";
  const iconLibrary = String(input?.iconLibrary || "lucide").trim().slice(0, 40) || "lucide";
  const font = String(input?.font || DEFAULT_FONT).trim().slice(0, 200) || DEFAULT_FONT;
  log.push(`style=${style} iconLibrary=${iconLibrary} font=${font}`);

  const rawDir = String(input?.dir ?? "").trim();
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

  const files = buildTemplates({ framework, style, theme, iconLibrary, font, name });
  log.push(`模板=${framework} 风味，计划 ${files.length} 个文件：${files.map((file) => file.path).join(", ")}`);

  if (input?.dryRun !== false) {
    if (input?.dryRun !== true) log.push("dryRun 未显式指定，按 true 处理（只出计划不落盘）");
    return { ok: true, filesPlanned: files.map((file) => join(targetDir, file.path)), targetDir, log };
  }

  await mkdir(targetDir, { recursive: true });
  for (const file of files) {
    const full = join(targetDir, file.path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, file.content, "utf8");
    log.push(`已写入 ${file.path}（${Buffer.byteLength(file.content, "utf8")} B）`);
  }
  return { ok: true, filesWritten: files.length, targetDir, log };
}
