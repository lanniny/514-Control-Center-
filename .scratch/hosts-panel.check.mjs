/**
 * hosts-panel.js — 远程主机视图（Codex「连接」页对齐，2026-08-11 波）。
 *
 * 形态：标题「来自此电脑的 SSH 连接」+ 行列表（toggle / globe / 名称+状态 / ⋯菜单 / exec / SFTP）。
 * 能力契约（Wave G 保留，不砍）：
 *   - toggle = 启用开关（持久化 host.enabled）；停用即拒连，不假装实时连接
 *   - 状态点如实探测：未探测 / 探测中 / 已连接 / 待确认指纹 / 不可达 / 已停用，绝不伪造在线
 *   - 「添加」对话框自动发现 ~/.ssh/config Host 条目（GET /api/ssh/discover），复选批量登记；
 *     已登记条目置灰；手动添加展开原表单；凭据仍只进 secrets 台账，API 永不回显
 *   - 指纹确认、移除收进 ⋯ 菜单；exec / SFTP 行内图标按钮；SFTP 浏览区保留在下方
 */
import { request, apiReady } from "./api.js";
import { lucideIcon } from "./lucide.js";

const state = {
  hosts: [],
  probes: new Map(), // hostId → { phase: "idle"|"probing"|"ok"|"unconfirmed"|"fail", message? }
  sftp: { hostId: null, path: "", items: [], fileContent: null },
  dialog: { mode: "discover", discovered: [], source: null, defaultUser: null, selected: new Set(), loaded: false, error: null },
};

let docMenuListenerBound = false;

function esc(text) {
  return String(text ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

async function refresh(root) {
  try {
    state.hosts = (await request("/api/ssh/hosts"))?.hosts ?? [];
  } catch (error) {
    if (/REMOTE_GATE/.test(error.message || "")) {
      root.innerHTML = `
        <div class="forge-empty-waveg">
          ${lucideIcon("lock", "icon lucide icon-lg")}
          <h2>远程主机门闸未开放</h2>
          <p class="subtle">${esc(error.message)}</p>
        </div>`;
      return;
    }
    state.hosts = [];
  }
  // 清理已移除主机的探测缓存
  const alive = new Set(state.hosts.map((host) => host.id));
  for (const id of [...state.probes.keys()]) if (!alive.has(id)) state.probes.delete(id);
  render(root);
  autoProbe(root);
}

/* —— 状态探测（如实，不伪造在线）—— */

function statusInner(host, probe) {
  if (host.enabled === false) return `<span class="sshconn-dot is-off"></span>已停用`;
  switch (probe?.phase) {
    case "probing": return `<span class="sshconn-dot is-probing"></span>探测中…`;
    case "ok": return `<span class="sshconn-dot is-ok"></span>已连接`;
    case "unconfirmed": return `<span class="sshconn-dot is-warn"></span>待确认指纹`;
    case "fail": return `<span class="sshconn-dot is-fail"></span>不可达`;
    default: return `<span class="sshconn-dot"></span>未探测`;
  }
}

function paintStatus(root, host) {
  const el = root.querySelector(`[data-host-status="${host.id}"]`);
  if (!el) return;
  const probe = state.probes.get(host.id) ?? { phase: "idle" };
  el.innerHTML = statusInner(host, probe);
  el.title = probe.phase === "fail" && probe.message ? `不可达：${probe.message}` : "点击重新探测";
}

async function probeHost(root, id) {
  const host = state.hosts.find((entry) => entry.id === id);
  if (!host) return;
  if (host.enabled === false) {
    state.probes.set(id, { phase: "idle" });
    paintStatus(root, host);
    return;
  }
  state.probes.set(id, { phase: "probing" });
  paintStatus(root, host);
  try {
    await request(`/api/ssh/hosts/${id}/test`, { method: "POST", body: JSON.stringify({}) });
    state.probes.set(id, { phase: "ok" });
  } catch (error) {
    const code = error?.payload?.code ?? "";
    if (code === "SSH_HOSTKEY_UNCONFIRMED" || code === "SSH_HOSTKEY_CHANGED") state.probes.set(id, { phase: "unconfirmed" });
    else if (code === "SSH_HOST_DISABLED") state.probes.set(id, { phase: "idle" });
    else state.probes.set(id, { phase: "fail", message: error.message });
  }
  paintStatus(root, host);
}

function autoProbe(root) {
  for (const host of state.hosts) {
    if (host.enabled === false) continue;
    const probe = state.probes.get(host.id);
    if (probe && (probe.phase === "ok" || probe.phase === "probing")) continue;
    void probeHost(root, host.id);
  }
}

/* —— 行渲染 —— */

function rowHtml(host) {
  const probe = state.probes.get(host.id) ?? { phase: "idle" };
  const off = host.enabled === false;
  return `
    <div class="sshconn-row${off ? " is-off" : ""}" data-host-row="${host.id}">
      <button type="button" class="sshconn-toggle${off ? "" : " is-on"}" data-host-toggle="${host.id}"
              role="switch" aria-checked="${off ? "false" : "true"}" title="${off ? "启用" : "停用"}">
        <span class="sshconn-toggle-thumb"></span>
      </button>
      <span class="sshconn-row-icon">${lucideIcon("globe", "icon lucide")}</span>
      <div class="sshconn-main">
        <div class="sshconn-name">
          ${esc(host.name)}
          ${host.trusted ? "" : `<span class="sshconn-badge is-warn">待确认指纹</span>`}
        </div>
        <button type="button" class="sshconn-status" data-host-status="${host.id}" title="点击重新探测">${statusInner(host, probe)}</button>
        <span class="sshconn-addr">${esc(host.user)}@${esc(host.host)}:${host.port}${host.hasSecret ? " · 凭据已登记" : ""}</span>
      </div>
      <div class="sshconn-actions">
        <button type="button" class="icon-button" data-host-exec="${host.id}" title="执行命令" aria-label="执行命令">${lucideIcon("square-terminal", "icon lucide")}</button>
        <button type="button" class="icon-button" data-host-sftp="${host.id}" title="SFTP 浏览" aria-label="SFTP 浏览">${lucideIcon("folder", "icon lucide")}</button>
        <div class="sshconn-menu-wrap">
          <button type="button" class="icon-button" data-host-menu="${host.id}" title="更多操作" aria-label="更多操作">⋯</button>
          <div class="sshconn-menu" hidden>
            <button type="button" data-host-trust="${host.id}">${lucideIcon("fingerprint", "icon lucide")} 确认指纹</button>
            <button type="button" data-host-sync="${host.id}">${lucideIcon("refresh-cw", "icon lucide")} 同步 ssh config</button>
            <button type="button" class="is-danger" data-host-delete="${host.id}">${lucideIcon("trash-2", "icon lucide")} 移除</button>
          </div>
        </div>
      </div>
    </div>`;
}

function render(root) {
  root.innerHTML = `
    <div class="sshconn-head">
      <div class="sshconn-head-text">
        <h2>来自此电脑的 SSH 连接</h2>
        <p class="subtle">状态点按需如实探测，不伪造在线；toggle 是启用开关，停用即拒连。</p>
      </div>
      <div class="sshconn-head-actions">
        <button type="button" class="button" id="hosts-reprobe">${lucideIcon("refresh-cw", "icon lucide")} 探测状态</button>
        <button type="button" class="button primary" id="hosts-add">${lucideIcon("plus", "icon lucide")} 添加</button>
      </div>
    </div>

    <div class="sshconn-list">
      ${state.hosts.map(rowHtml).join("") || `
        <div class="sshconn-empty">
          ${lucideIcon("satellite-dish", "icon lucide icon-lg")}
          <p>还没有 SSH 连接。点「添加」自动识别 ~/.ssh/config 里已配置的主机，或手动登记。</p>
        </div>`}
    </div>

    <div id="host-action-result"></div>

    <h2 class="waveg-section-title">${lucideIcon("folder", "icon lucide")} SFTP 浏览</h2>
    <div class="waveg-form">
      <div class="waveg-form-row">
        <label>路径<input class="input" id="sftp-path" type="text" value="${esc(state.sftp.path)}" placeholder="/srv/data" /></label>
      </div>
      <div class="waveg-card-actions">
        <button type="button" class="button" id="sftp-list" ${state.sftp.hostId ? "" : "disabled"}>${lucideIcon("list", "icon lucide")} 列目录</button>
      </div>
      <div class="waveg-log" id="sftp-result">${state.sftp.fileContent != null
        ? esc(state.sftp.fileContent)
        : state.sftp.items.map((item) => `${item.isDirectory ? "[目录]" : "[文件]"} ${esc(item.name)}\t${item.size}B`).join("\n") || "先在某台主机行上点 SFTP 图标，再列目录。"}</div>
    </div>`;

  wireRows(root);
  root.querySelector("#hosts-add")?.addEventListener("click", () => void openAddDialog(root));
  root.querySelector("#hosts-reprobe")?.addEventListener("click", () => {
    for (const host of state.hosts) state.probes.set(host.id, { phase: "idle" });
    for (const host of state.hosts) paintStatus(root, host);
    autoProbe(root);
  });
  root.querySelector("#sftp-list")?.addEventListener("click", () => void sftpList(root));

  if (!docMenuListenerBound) {
    docMenuListenerBound = true;
    document.addEventListener("click", () => {
      document.querySelectorAll(".sshconn-menu").forEach((menu) => { menu.hidden = true; });
    });
  }
}

function wireRows(root) {
  root.querySelectorAll("[data-host-toggle]").forEach((button) => {
    button.addEventListener("click", () => void toggleHost(root, button.dataset.hostToggle));
  });
  root.querySelectorAll("[data-host-status]").forEach((button) => {
    button.addEventListener("click", () => void probeHost(root, button.dataset.hostStatus));
  });
  root.querySelectorAll("[data-host-exec]").forEach((button) => {
    button.addEventListener("click", () => void execOnHost(root, button.dataset.hostExec));
  });
  root.querySelectorAll("[data-host-sftp]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sftp.hostId = button.dataset.hostSftp;
      state.sftp.fileContent = null;
      render(root);
      root.querySelector("#sftp-path")?.focus();
    });
  });
  root.querySelectorAll("[data-host-menu]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = button.parentElement?.querySelector(".sshconn-menu");
      const willOpen = menu?.hidden;
      root.querySelectorAll(".sshconn-menu").forEach((entry) => { entry.hidden = true; });
      if (menu && willOpen) {
        // 方向自适应：视口下方空间不足一个菜单高度时向上展开（列表 overflow 不裁切，但贴底行下展开会出视口）
        const spaceBelow = window.innerHeight - button.getBoundingClientRect().bottom;
        menu.classList.toggle("is-up", spaceBelow < 160);
        menu.hidden = false;
      }
    });
  });
  root.querySelectorAll("[data-host-trust]").forEach((button) => {
    button.addEventListener("click", () => void trustHost(root, button.dataset.hostTrust));
  });
  root.querySelectorAll("[data-host-sync]").forEach((button) => {
    button.addEventListener("click", () => void syncConfig(root, button.dataset.hostSync));
  });
  root.querySelectorAll("[data-host-delete]").forEach((button) => {
    button.addEventListener("click", () => void deleteHost(root, button.dataset.hostDelete));
  });
}

function actionResult(root, html) {
  const box = root.querySelector("#host-action-result");
  if (box) box.innerHTML = html;
}

/* —— 启用开关 —— */

async function toggleHost(root, id) {
  const host = state.hosts.find((entry) => entry.id === id);
  if (!host) return;
  const next = host.enabled === false;
  try {
    const result = await request(`/api/ssh/hosts/${id}/enabled`, { method: "POST", body: JSON.stringify({ enabled: next }) });
    host.enabled = result?.host?.enabled !== false;
  } catch (error) {
    actionResult(root, `<div class="waveg-review"><strong>${next ? "启用" : "停用"}失败</strong><p class="subtle">${esc(error.message)}</p></div>`);
    return;
  }
  const row = root.querySelector(`[data-host-row="${id}"]`);
  const toggle = root.querySelector(`[data-host-toggle="${id}"]`);
  if (row) row.classList.toggle("is-off", host.enabled === false);
  if (toggle) {
    toggle.classList.toggle("is-on", host.enabled !== false);
    toggle.setAttribute("aria-checked", String(host.enabled !== false));
    toggle.title = host.enabled === false ? "启用" : "停用";
  }
  state.probes.set(id, { phase: "idle" });
  paintStatus(root, host);
  if (host.enabled !== false) void probeHost(root, id);
}

/* —— 添加对话框（自动发现 + 手动添加）—— */

function ensureDialog() {
  let dialog = document.getElementById("ssh-add-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "ssh-add-dialog";
    dialog.className = "action-dialog sshconn-dialog";
    document.body.appendChild(dialog);
    dialog.addEventListener("close", () => {
      state.dialog.mode = "discover";
      state.dialog.selected = new Set();
    });
  }
  return dialog;
}

function isRegistered(entry) {
  return state.hosts.some((host) => (
    host.name === entry.alias
    || (host.host === entry.host && Number(host.port) === Number(entry.port) && (!entry.user || host.user === entry.user))
  ));
}

async function openAddDialog(root) {
  const dialog = ensureDialog();
  state.dialog.mode = "discover";
  renderDialog(root);
  if (!dialog.open) dialog.showModal();
  await loadDiscover(root);
}

async function loadDiscover(root) {
  state.dialog.loaded = false;
  state.dialog.error = null;
  renderDialog(root);
  try {
    const result = await request("/api/ssh/discover");
    state.dialog.discovered = result?.hosts ?? [];
    state.dialog.source = result?.source ?? null;
    state.dialog.defaultUser = result?.defaultUser ?? null;
  } catch (error) {
    state.dialog.error = error.message;
    state.dialog.discovered = [];
    state.dialog.source = null;
  }
  state.dialog.loaded = true;
  // 默认勾选全部可导入条目（已登记的置灰不选）
  state.dialog.selected = new Set(state.dialog.discovered.filter((entry) => !isRegistered(entry)).map((entry) => entry.alias));
  renderDialog(root);
}

function discoverListHtml() {
  if (!state.dialog.loaded) return `<p class="subtle">正在扫描 ~/.ssh/config …</p>`;
  if (state.dialog.error) {
    return `
      <p class="subtle">扫描失败：${esc(state.dialog.error)}</p>
      <button type="button" class="button" data-dialog-rescan>${lucideIcon("refresh-cw", "icon lucide")} 重新扫描</button>`;
  }
  if (!state.dialog.discovered.length) {
    return `<p class="subtle">未在 ${esc(state.dialog.source ?? "~/.ssh/config")} 发现可导入的主机。可用下方「手动添加」。</p>`;
  }
  return `
    <div class="sshconn-discover-list">
      ${state.dialog.discovered.map((entry) => {
        const registered = isRegistered(entry);
        return `
          <label class="sshconn-discover-row${registered ? " is-registered" : ""}">
            ${lucideIcon("server", "icon lucide")}
            <span class="sshconn-discover-main">
              <span class="sshconn-discover-alias">${esc(entry.alias)}${entry.knownFingerprint ? ` <span class="sshconn-badge is-ok">known_hosts 已信任</span>` : ""}</span>
              <span class="sshconn-discover-host">${esc(entry.host)}${entry.port !== 22 ? `:${entry.port}` : ""}${entry.user ? ` · ${esc(entry.user)}` : state.dialog.defaultUser ? ` · ${esc(state.dialog.defaultUser)}（缺省）` : ""}</span>
            </span>
            ${registered
              ? `<span class="sshconn-badge">已登记</span>`
              : `<input type="checkbox" class="sshconn-check" data-discover-check="${esc(entry.alias)}" ${state.dialog.selected.has(entry.alias) ? "checked" : ""} />`}
          </label>`;
      }).join("")}
    </div>`;
}

function manualFormHtml() {
  return `
    <div class="sshconn-manual">
      <label class="field"><span class="field-label">名称</span><input class="input" id="sshdlg-name" type="text" placeholder="生产盒 01" /></label>
      <label class="field"><span class="field-label">主机</span><input class="input" id="sshdlg-host" type="text" placeholder="192.168.1.10 或 host.example.com" /></label>
      <div class="sshconn-manual-pair">
        <label class="field"><span class="field-label">端口</span><input class="input" id="sshdlg-port" type="number" value="22" /></label>
        <label class="field"><span class="field-label">用户</span><input class="input" id="sshdlg-user" type="text" placeholder="lo" /></label>
      </div>
      <label class="field"><span class="field-label">密码（可选，与私钥/agent 二选一）</span><input class="input" id="sshdlg-password" type="password" autocomplete="off" /></label>
      <label class="field"><span class="field-label">私钥路径（可选，缺省自动试 ~/.ssh 默认密钥与 ssh-agent）</span><input class="input" id="sshdlg-keyfile" type="text" placeholder="~/.ssh/id_ed25519" /></label>
      <label class="field"><span class="field-label">SFTP 根白名单（逗号分隔，可选）</span><input class="input" id="sshdlg-roots" type="text" placeholder="/srv/data,/home/lo" /></label>
      <p class="subtle">凭据只写入本机 secrets 台账，API 永不回显。首次连接需确认主机指纹后才放行。</p>
      <p class="subtle" id="sshdlg-msg"></p>
    </div>`;
}

function renderDialog(root) {
  const dialog = ensureDialog();
  const isDiscover = state.dialog.mode === "discover";
  dialog.innerHTML = `
    <div class="dialog-heading">
      <div>
        <span class="eyebrow">远程主机</span>
        <h2>${isDiscover ? "添加 SSH 连接" : "手动添加"}</h2>
      </div>
      <button type="button" class="icon-button" data-dialog-close aria-label="关闭对话框" title="关闭">${lucideIcon("x", "icon lucide")}</button>
    </div>
    <div class="dialog-body">
      ${isDiscover ? discoverListHtml() : manualFormHtml()}
    </div>
    <div class="dialog-actions">
      ${isDiscover ? `
        <button type="button" class="button" data-dialog-manual>${lucideIcon("pencil", "icon lucide")} 手动添加</button>
        <span class="dialog-actions-spacer"></span>
        <button type="button" class="button secondary" data-dialog-close>取消</button>
        <button type="button" class="button primary" data-dialog-import ${state.dialog.selected.size ? "" : "disabled"}>添加${state.dialog.selected.size ? `（${state.dialog.selected.size}）` : ""}</button>` : `
        <button type="button" class="button" data-dialog-back>返回列表</button>
        <span class="dialog-actions-spacer"></span>
        <button type="button" class="button secondary" data-dialog-close>取消</button>
        <button type="button" class="button primary" data-dialog-create>登记主机</button>`}
    </div>`;

  dialog.querySelectorAll("[data-dialog-close]").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });
  dialog.querySelector("[data-dialog-manual]")?.addEventListener("click", () => {
    state.dialog.mode = "manual";
    renderDialog(root);
  });
  dialog.querySelector("[data-dialog-back]")?.addEventListener("click", () => {
    state.dialog.mode = "discover";
    renderDialog(root);
  });
  dialog.querySelector("[data-dialog-rescan]")?.addEventListener("click", () => void loadDiscover(root));
  dialog.querySelectorAll("[data-discover-check]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.dialog.selected.add(checkbox.dataset.discoverCheck);
      else state.dialog.selected.delete(checkbox.dataset.discoverCheck);
      const importButton = dialog.querySelector("[data-dialog-import]");
      if (importButton) {
        importButton.disabled = !state.dialog.selected.size;
        importButton.textContent = `添加${state.dialog.selected.size ? `（${state.dialog.selected.size}）` : ""}`;
      }
    });
  });
  dialog.querySelector("[data-dialog-import]")?.addEventListener("click", () => void importSelected(root));
  dialog.querySelector("[data-dialog-create]")?.addEventListener("click", () => void createFromDialog(root, dialog));
}

async function importSelected(root) {
  const dialog = ensureDialog();
  const entries = state.dialog.discovered.filter((entry) => state.dialog.selected.has(entry.alias));
  if (!entries.length) return;
  let created = 0;
  let inherited = 0;
  const failed = [];
  for (const entry of entries) {
    const user = entry.user || state.dialog.defaultUser || "";
    if (!user) {
      failed.push(`${entry.alias}：缺用户（config 未写 User，本机用户名也不可得）`);
      continue;
    }
    try {
      const result = await request("/api/ssh/hosts", {
        method: "POST",
        body: JSON.stringify({
          name: entry.alias, host: entry.host, port: entry.port, user, auth: {},
          identityFile: entry.identityFile ?? undefined, // undefined 被 JSON 丢弃，null 不覆盖旧语义
        }),
      });
      created += 1;
      // known_hosts 已信任的主机键直接继承，登记完即是可信状态
      if (entry.knownFingerprint && result?.host?.id) {
        try {
          await request(`/api/ssh/hosts/${result.host.id}/trust`, { method: "POST", body: JSON.stringify({ fingerprint: entry.knownFingerprint }) });
          inherited += 1;
        } catch { /* 继承失败不阻断登记，后续走一键确认 */ }
      }
    } catch (error) {
      failed.push(`${entry.alias}：${error.message}`);
    }
  }
  dialog.close();
  await refresh(root);
  actionResult(root, `
    <div class="waveg-review">
      <strong>${lucideIcon("check", "icon lucide")} 已登记 ${created} 台主机${inherited ? `，其中 ${inherited} 台已继承 known_hosts 信任` : ""}</strong>
      ${failed.length ? `<p class="subtle">${failed.map(esc).join("；")}</p>` : ""}
    </div>`);
}

async function createFromDialog(root, dialog) {
  const payload = {
    name: dialog.querySelector("#sshdlg-name")?.value?.trim() || "",
    host: dialog.querySelector("#sshdlg-host")?.value?.trim() || "",
    port: Number(dialog.querySelector("#sshdlg-port")?.value) || 22,
    user: dialog.querySelector("#sshdlg-user")?.value?.trim() || "",
    auth: {},
    rootAllowlist: (dialog.querySelector("#sshdlg-roots")?.value || "").split(",").map((entry) => entry.trim()).filter(Boolean),
  };
  const password = dialog.querySelector("#sshdlg-password")?.value || "";
  if (password) payload.auth.password = password;
  const keyfile = dialog.querySelector("#sshdlg-keyfile")?.value?.trim() || "";
  if (keyfile) payload.identityFile = keyfile;
  const msg = dialog.querySelector("#sshdlg-msg");
  try {
    await request("/api/ssh/hosts", { method: "POST", body: JSON.stringify(payload) });
    dialog.close();
    await refresh(root);
  } catch (error) {
    if (msg) msg.textContent = `登记失败：${error.message}`;
  }
}

/* —— 既有能力：指纹 / exec / 移除 / SFTP —— */
/* 原生 window.confirm/prompt 在桌面壳（Electron 类）里是哑弹——调用被吞立即返回假值， */
/* 看上去就是「点完闪退」（LO 2026-08-11）。一律改走页内 <dialog>。 */

function ensureModal(id) {
  let dialog = document.getElementById(id);
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = id;
    dialog.className = "action-dialog sshconn-dialog";
    document.body.appendChild(dialog);
  }
  return dialog;
}

/** 指纹信任确认对话框：展示捕获的指纹请人工核对，resolve(true)=信任。 */
function confirmTrustDialog(host, fingerprint) {
  return new Promise((resolve) => {
    const dialog = ensureModal("ssh-trust-dialog");
    dialog.innerHTML = `
      <div class="dialog-heading">
        <div>
          <span class="eyebrow">确认指纹</span>
          <h2>信任主机指纹</h2>
        </div>
        <button type="button" class="icon-button" data-act="cancel" aria-label="关闭对话框" title="关闭">${lucideIcon("x", "icon lucide")}</button>
      </div>
      <div class="dialog-body">
        <p>请核对 <strong>${esc(host.name)}</strong>（${esc(host.user)}@${esc(host.host)}:${host.port}）的主机指纹：</p>
        <code class="sshconn-fp">${esc(fingerprint)}</code>
        <p class="subtle">与可信来源（服务器控制台、首次部署记录）核对一致再信任。信任后写入本机 known-hosts 台账；此后指纹变更将拒绝连接并告警。</p>
      </div>
      <div class="dialog-actions">
        <button type="button" class="button secondary" data-act="cancel">取消</button>
        <button type="button" class="button primary" data-act="trust">${lucideIcon("fingerprint", "icon lucide")} 信任并连接</button>
      </div>`;
    const done = (value) => {
      if (dialog.open) dialog.close();
      resolve(value);
    };
    dialog.querySelectorAll('[data-act="cancel"]').forEach((button) => button.addEventListener("click", () => done(false)));
    dialog.querySelector('[data-act="trust"]')?.addEventListener("click", () => done(true));
    dialog.addEventListener("close", () => resolve(false), { once: true }); // Esc/外力关闭；按钮路径先 resolve 者为胜
    dialog.showModal();
  });
}

/** exec 命令输入对话框：resolve(命令字符串) 或 null=取消。 */
function promptCommandDialog(host) {
  return new Promise((resolve) => {
    const dialog = ensureModal("ssh-exec-dialog");
    dialog.innerHTML = `
      <div class="dialog-heading">
        <div>
          <span class="eyebrow">执行命令</span>
          <h2>${esc(host.name)}</h2>
        </div>
        <button type="button" class="icon-button" data-act="cancel" aria-label="关闭对话框" title="关闭">${lucideIcon("x", "icon lucide")}</button>
      </div>
      <div class="dialog-body">
        <label class="field">
          <span class="field-label">命令（超时 30s，输出封顶 256KB 并过脱敏）</span>
          <input class="input" id="ssh-exec-command" type="text" value="uname -a" autocomplete="off" />
        </label>
      </div>
      <div class="dialog-actions">
        <button type="button" class="button secondary" data-act="cancel">取消</button>
        <button type="button" class="button primary" data-act="run">${lucideIcon("square-terminal", "icon lucide")} 执行</button>
      </div>`;
    const input = dialog.querySelector("#ssh-exec-command");
    const done = (value) => {
      if (dialog.open) dialog.close();
      resolve(value);
    };
    dialog.querySelectorAll('[data-act="cancel"]').forEach((button) => button.addEventListener("click", () => done(null)));
    dialog.querySelector('[data-act="run"]')?.addEventListener("click", () => done(input?.value?.trim() || null));
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        done(input.value.trim() || null);
      }
    });
    dialog.addEventListener("close", () => resolve(null), { once: true });
    dialog.showModal();
    input?.focus();
    input?.select();
  });
}

async function trustHost(root, id) {
  const host = state.hosts.find((entry) => entry.id === id);
  actionResult(root, `<p class="subtle">正在连接获取主机指纹…</p>`);
  let captured;
  try {
    captured = await request(`/api/ssh/hosts/${id}/fingerprint`, { method: "POST", body: JSON.stringify({}) });
  } catch (error) {
    actionResult(root, `<div class="waveg-review"><strong>获取指纹失败</strong><p class="subtle">${esc(error.message)}</p></div>`);
    return;
  }
  actionResult(root, "");
  const confirmed = await confirmTrustDialog(
    host ?? { id, name: id, user: "", host: "", port: "" },
    captured.fingerprint,
  );
  if (!confirmed) return;
  try {
    await request(`/api/ssh/hosts/${id}/trust`, { method: "POST", body: JSON.stringify({ fingerprint: captured.fingerprint }) });
    state.probes.set(id, { phase: "idle" });
  } catch (error) {
    actionResult(root, `<div class="waveg-review"><strong>信任失败</strong><p class="subtle">${esc(error.message)}</p></div>`);
  }
  await refresh(root);
}

async function execOnHost(root, id) {
  const host = state.hosts.find((entry) => entry.id === id);
  const command = await promptCommandDialog(host ?? { id, name: id });
  if (!command) return;
  actionResult(root, `<p class="subtle">执行中…</p>`);
  try {
    const result = await request(`/api/ssh/hosts/${id}/exec`, { method: "POST", body: JSON.stringify({ command, timeoutMs: 30000 }) });
    actionResult(root, `
      <div class="waveg-review">
        <strong>${lucideIcon("square-terminal", "icon lucide")} 退出码 ${result.code ?? "?"}</strong>
        <div class="waveg-log">${esc(result.stdout || "")}${result.stderr ? `\n[stderr]\n${esc(result.stderr)}` : ""}</div>
      </div>`);
  } catch (error) {
    actionResult(root, `<div class="waveg-review"><strong>执行失败</strong><p class="subtle">${esc(error.message)}</p></div>`);
  }
}

async function deleteHost(root, id) {
  try {
    await request(`/api/ssh/hosts/${id}`, { method: "DELETE" });
  } catch { /* 忽略 */ }
  await refresh(root);
}

/** 从 ~/.ssh/config 回同步连接参数（含 IdentityFile 路径）——老台账记录缺 identityFile 的补救通道。 */
async function syncConfig(root, id) {
  actionResult(root, `<p class="subtle">正在对照 ssh config …</p>`);
  try {
    const result = await request(`/api/ssh/hosts/${id}/sync-config`, { method: "POST", body: JSON.stringify({}) });
    const host = result?.host;
    actionResult(root, `
      <div class="waveg-review">
        <strong>${lucideIcon("check", "icon lucide")} 已同步 ${esc(host?.name ?? id)}</strong>
        <p class="subtle">${esc(host?.user ?? "")}@${esc(host?.host ?? "")}:${host?.port ?? ""}${host?.identityFile ? ` · 私钥 ${esc(host.identityFile)}` : " · config 未配 IdentityFile，走默认密钥/agent"}</p>
      </div>`);
    state.probes.set(id, { phase: "idle" });
  } catch (error) {
    actionResult(root, `<div class="waveg-review"><strong>同步失败</strong><p class="subtle">${esc(error.message)}</p></div>`);
    return;
  }
  await refresh(root);
}

async function sftpList(root) {
  if (!state.sftp.hostId) return;
  const path = root.querySelector("#sftp-path")?.value?.trim() || "/";
  state.sftp.path = path;
  const box = root.querySelector("#sftp-result");
  if (box) box.textContent = "读取中…";
  try {
    const result = await request(`/api/ssh/hosts/${state.sftp.hostId}/sftp/list?path=${encodeURIComponent(path)}`);
    state.sftp.items = result?.items ?? [];
    state.sftp.fileContent = null;
  } catch (error) {
    state.sftp.items = [];
    state.sftp.fileContent = `列目录失败：${error.message}`;
  }
  render(root);
}

function bootWhenReady() {
  if (typeof document === "undefined") return;
  const start = () => void apiReady.then(() => {
    const root = document.getElementById("hosts-container");
    if (root) void refresh(root);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

bootWhenReady();
