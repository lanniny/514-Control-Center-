/**
 * channels-panel.js — Wave G 渠道视图。
 * 渠道 CRUD（telegram/webhook_out/webhook_in）+ 启停 + 测试 + 最近事件流。
 */
import { request, apiReady } from "./api.js";
import { lucideIcon } from "./lucide.js";

const TYPE_META = {
  telegram: { icon: "send", label: "Telegram Bot", fields: [{ key: "token", label: "Bot Token", secret: true }], outbound: true },
  webhook_out: { icon: "webhook", label: "出站 Webhook", fields: [{ key: "url", label: "目标 URL" }, { key: "secret", label: "签名 Secret", secret: true }], outbound: true },
  webhook_in: { icon: "satellite-dish", label: "入站 Webhook", fields: [{ key: "secret", label: "验签 Secret", secret: true }], outbound: false },
};

const state = { channels: [], events: [], formType: "telegram" };

function esc(text) {
  return String(text ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

async function refresh(root) {
  try {
    const [channels, events] = await Promise.all([
      request("/api/channels"),
      request("/api/channels/events?limit=30"),
    ]);
    state.channels = channels?.channels ?? [];
    state.events = events?.events ?? [];
  } catch (error) {
    if (/REMOTE_GATE/.test(error.message || "")) {
      root.innerHTML = `
        <div class="forge-empty-waveg">
          ${lucideIcon("lock", "icon lucide icon-lg")}
          <h2>渠道门闸未开放</h2>
          <p class="subtle">${esc(error.message)}</p>
        </div>`;
      return;
    }
    state.channels = [];
    state.events = [];
  }
  render(root);
}

function render(root) {
  const meta = TYPE_META[state.formType];
  root.innerHTML = `
    <div class="waveg-form">
      <div class="waveg-form-row" role="tablist" aria-label="渠道类型">
        ${Object.entries(TYPE_META).map(([type, item]) => `
          <button type="button" class="terminal-tab ${state.formType === type ? "is-active" : ""}" data-channel-type="${type}" role="tab" aria-selected="${state.formType === type}">
            ${lucideIcon(item.icon, "icon lucide")}<span>${item.label}</span>
          </button>`).join("")}
      </div>
      <div class="waveg-form-row">
        <label>名称<input class="input" id="channel-name" type="text" placeholder="例如：运维通知群" /></label>
        ${meta.fields.map((field) => `
          <label>${field.label}<input class="input" id="channel-field-${field.key}" type="${field.secret ? "password" : "text"}" autocomplete="off" /></label>`).join("")}
      </div>
      <div class="waveg-card-actions">
        <button type="button" class="button button-primary" id="channel-create">${lucideIcon("plus", "icon lucide")} 创建渠道</button>
      </div>
      <p class="subtle" id="channel-form-msg"></p>
    </div>

    <h2 class="waveg-section-title">${lucideIcon("satellite-dish", "icon lucide")} 已接入渠道</h2>
    <div class="waveg-grid">
      ${state.channels.map((channel) => {
        const typeMeta = TYPE_META[channel.type] ?? { icon: "webhook", label: channel.type };
        return `
        <div class="waveg-card">
          <div class="waveg-card-head">
            ${lucideIcon(typeMeta.icon, "icon lucide")}
            <h3>${esc(channel.name)}</h3>
            <span class="waveg-badge ${channel.enabled ? "is-on" : ""}">${channel.enabled ? "已启用" : "停用"}</span>
          </div>
          <dl class="waveg-kv">
            <dt>类型</dt><dd>${typeMeta.label}</dd>
            <dt>ID</dt><dd>${esc(channel.id)}</dd>
            ${channel.type === "webhook_in" ? `<dt>入站地址</dt><dd>/api/channels/webhook/${esc(channel.id)}</dd>` : ""}
          </dl>
          <div class="waveg-card-actions">
            <button type="button" class="button" data-channel-toggle="${channel.id}" data-enabled="${channel.enabled}">
              ${lucideIcon(channel.enabled ? "circle-stop" : "play", "icon lucide")} ${channel.enabled ? "停用" : "启用"}
            </button>
            ${TYPE_META[channel.type]?.outbound ? `<button type="button" class="button" data-channel-test="${channel.id}">${lucideIcon("send", "icon lucide")} 发测试</button>` : ""}
            <button type="button" class="button" data-channel-delete="${channel.id}">${lucideIcon("trash-2", "icon lucide")} 删除</button>
          </div>
        </div>`;
      }).join("") || `<p class="subtle">还没有渠道。从上方创建第一个 Telegram 或 Webhook 接入。</p>`}
    </div>

    <h2 class="waveg-section-title">${lucideIcon("activity", "icon lucide")} 最近渠道事件</h2>
    <div class="waveg-log">${state.events.map((event) => {
      const head = `[${esc(event.at)}] ${esc(event.kind)} · ${esc(event.type)} · ${esc(event.channelId)}`;
      const body = event.text ? ` — ${esc(event.text)}` : event.message ? ` — ${esc(event.message)}` : event.status ? ` — HTTP ${event.status}` : "";
      return `${head}${body}`;
    }).join("\n") || "暂无事件。"}</div>`;

  root.querySelectorAll("[data-channel-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.formType = button.dataset.channelType;
      render(root);
    });
  });
  root.querySelector("#channel-create")?.addEventListener("click", () => void createChannel(root));
  root.querySelectorAll("[data-channel-toggle]").forEach((button) => {
    button.addEventListener("click", () => void toggleChannel(root, button.dataset.channelToggle, button.dataset.enabled !== "true"));
  });
  root.querySelectorAll("[data-channel-test]").forEach((button) => {
    button.addEventListener("click", () => void testChannel(root, button.dataset.channelTest));
  });
  root.querySelectorAll("[data-channel-delete]").forEach((button) => {
    button.addEventListener("click", () => void deleteChannel(root, button.dataset.channelDelete));
  });
}

function formMessage(root, text) {
  const el = root.querySelector("#channel-form-msg");
  if (el) el.textContent = text;
}

async function createChannel(root) {
  const name = root.querySelector("#channel-name")?.value?.trim() || "";
  const config = {};
  for (const field of TYPE_META[state.formType].fields) {
    config[field.key] = root.querySelector(`#channel-field-${field.key}`)?.value?.trim() || "";
  }
  try {
    await request("/api/channels", { method: "POST", body: JSON.stringify({ type: state.formType, name, config, enabled: true }) });
    await refresh(root);
  } catch (error) {
    formMessage(root, `创建失败：${error.message}`);
  }
}

async function toggleChannel(root, id, enabled) {
  try {
    await request(`/api/channels/${id}`, { method: "PUT", body: JSON.stringify({ enabled }) });
  } catch { /* 刷新后可见真实状态 */ }
  await refresh(root);
}

async function testChannel(root, id) {
  try {
    await request(`/api/channels/${id}/test`, { method: "POST", body: JSON.stringify({ text: "514 Forge 渠道连通性测试" }) });
  } catch { /* 结果进事件流 */ }
  await refresh(root);
}

async function deleteChannel(root, id) {
  try {
    await request(`/api/channels/${id}`, { method: "DELETE" });
  } catch { /* 忽略 */ }
  await refresh(root);
}

function bootWhenReady() {
  if (typeof document === "undefined") return;
  const start = () => void apiReady.then(() => {
    const root = document.getElementById("channels-container");
    if (root) void refresh(root);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

bootWhenReady();
