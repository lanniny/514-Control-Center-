/**
 * hero-starmap.js — G4 协作星图英雄页（Awwwards 艺术面，独立视图不动工具面）。
 *
 * 视觉契约：
 *   - 六 CLI 家族节点（品牌色取自 tokens --agent-*），物理布局：库仑斥力 + 环形锚点引力 + 阻尼
 *   - 中心 514 核 + 三层呼吸脉冲环；活跃家族（roster/runs 真实数据）亮起并带流光边
 *   - 指针引力井（200px 吸引）+ hover 节点放大发光
 *   - 主题跟随（MutationObserver 重读 token）；reduced-motion → 静态一帧
 *   - 零 emoji；汉字代号取 blurb 语义首字：主/烛/织/前/驻/研
 */
import { request, apiReady } from "./api.js";

const FAMILIES = [
  { id: "claude", label: "Claude", glyph: "主", colorVar: "--agent-claude", fallback: "#d97757" },
  { id: "codex", label: "Codex", glyph: "烛", colorVar: "--agent-codex", fallback: "#7a9dff" },
  { id: "grok", label: "Grok", glyph: "织", colorVar: "--agent-grok", fallback: "#a78bfa" },
  { id: "gemini", label: "Gemini", glyph: "研", colorVar: "--agent-cursor", fallback: "#9ca3af" },
  { id: "kimi", label: "Kimi", glyph: "前", colorVar: "--agent-kimi", fallback: "#eab308" },
  { id: "pi", label: "Pi", glyph: "驻", colorVar: "--agent-pi", fallback: "#2dd4bf" },
];

function readTokens() {
  const style = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    primary: pick("--primary", "#d97757"),
    foreground: pick("--foreground", "#1c1917"),
    muted: pick("--muted-foreground", "#78716c"),
    background: pick("--background", "#ffffff"),
    agents: FAMILIES.map((family) => pick(family.colorVar, family.fallback)),
  };
}

async function loadActivity() {
  const active = new Set();
  const edges = new Set();
  try {
    const [roster, runs] = await Promise.all([
      request("/api/roster").catch(() => null),
      request("/api/runs?limit=20").catch(() => null),
    ]);
    for (const agent of Object.values(roster?.agents ?? {})) {
      const family = String(agent.agentId || "").split("-")[0];
      if (family) active.add(family);
    }
    for (const run of runs?.runs ?? []) {
      const leader = String(run?.route?.selected?.id || run?.leaderId || "").split("-")[0];
      if (leader) active.add(leader);
      const members = run?.route?.candidates ?? run?.members ?? [];
      for (const member of members) {
        const other = String(member?.id || member || "").split("-")[0];
        if (leader && other && other !== leader) edges.add([leader, other].sort().join("~"));
      }
    }
  } catch { /* 空数据即静态星图 */ }
  return { active, edges };
}

function createEngine(canvas, overlay) {
  const ctx = canvas.getContext("2d", { alpha: true });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let tokens = readTokens();
  let width = 0;
  let height = 0;
  let raf = 0;
  let running = false;
  let activity = { active: new Set(), edges: new Set() };
  const pointer = { x: -9999, y: -9999, inside: false };

  // 节点初始化：环形 + 确定性扰动（同尺寸下同构图，构图稳定）
  const nodes = FAMILIES.map((family, index) => {
    const angle = (index / FAMILIES.length) * Math.PI * 2 - Math.PI / 2;
    return {
      ...family,
      index,
      angle,
      anchorT: angle, // 环形锚点角（缓慢进动）
      x: 0, y: 0, vx: 0, vy: 0,
      r: 26,
      hover: 0, // 0..1 平滑 hover 态
      active: false,
      seed: index * 137.51,
    };
  });

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    width = Math.max(320, rect.width);
    height = Math.max(320, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduced) draw(0);
  }

  function anchors() {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.32;
    return nodes.map((node) => ({
      x: cx + Math.cos(node.anchorT) * radius * 1.25,
      y: cy + Math.sin(node.anchorT) * radius * 0.82,
    }));
  }

  function step(time) {
    const anchorPoints = anchors();
    for (const node of nodes) {
      // 锚点缓慢进动（每族不同速率，构图在秩序中缓慢流动）
      node.anchorT += 0.000016 * (1 + node.index * 0.12);
      const anchor = anchorPoints[node.index];
      // 锚点引力
      node.vx += (anchor.x - node.x) * 0.0022;
      node.vy += (anchor.y - node.y) * 0.0022;
      // 库仑斥力
      for (const other of nodes) {
        if (other === node) continue;
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const distSq = Math.max(900, dx * dx + dy * dy);
        const force = 2600 / distSq;
        const dist = Math.sqrt(distSq);
        node.vx += (dx / dist) * force;
        node.vy += (dy / dist) * force;
      }
      // 指针引力井
      if (pointer.inside) {
        const dx = pointer.x - node.x;
        const dy = pointer.y - node.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 200 * 200 && distSq > 400) {
          const dist = Math.sqrt(distSq);
          const pull = 0.028 * (1 - dist / 200);
          node.vx += (dx / dist) * pull * dist * 0.05;
          node.vy += (dy / dist) * pull * dist * 0.05;
        }
      }
      // 微漂移（有机感）
      node.vx += Math.sin(time * 0.00021 + node.seed) * 0.006;
      node.vy += Math.cos(time * 0.00017 + node.seed * 1.3) * 0.006;
      // 阻尼 + 积分
      node.vx *= 0.94;
      node.vy *= 0.94;
      node.x += node.vx;
      node.y += node.vy;
      // hover 平滑
      const hovering = pointer.inside
        && Math.hypot(pointer.x - node.x, pointer.y - node.y) < node.r + 14;
      node.hover += ((hovering ? 1 : 0) - node.hover) * 0.14;
    }
  }

  function drawEdge(a, b, time, active) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const cx = width / 2;
    const cy = height / 2;
    // 向中心外侧弯（二次贝塞尔，构图张力）
    const bend = 0.12;
    const qx = mx + (mx - cx) * bend;
    const qy = my + (my - cy) * bend;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(qx, qy, b.x, b.y);
    ctx.strokeStyle = active ? tokens.primary : tokens.muted;
    ctx.globalAlpha = active ? 0.34 : 0.07;
    ctx.lineWidth = active ? 1.2 : 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (active && !reduced) {
      // 沿边流光粒子（两枚，相位错半）
      for (let k = 0; k < 2; k += 1) {
        const t = ((time * 0.00022 + k * 0.5 + a.index * 0.13) % 1);
        const inv = 1 - t;
        const px = inv * inv * a.x + 2 * inv * t * qx + t * t * b.x;
        const py = inv * inv * a.y + 2 * inv * t * qy + t * t * b.y;
        ctx.beginPath();
        ctx.arc(px, py, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = tokens.primary;
        ctx.globalAlpha = 0.85 * Math.sin(t * Math.PI);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawCore(time) {
    const cx = width / 2;
    const cy = height / 2;
    // 三层呼吸脉冲环
    for (let i = 0; i < 3; i += 1) {
      const phase = reduced ? 0.3 + i * 0.2 : ((time * 0.00035 + i / 3) % 1);
      const radius = 14 + phase * 90;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = tokens.primary;
      ctx.globalAlpha = 0.22 * (1 - phase);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // 核
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22);
    gradient.addColorStop(0, tokens.primary);
    gradient.addColorStop(1, "transparent");
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = tokens.primary;
    ctx.fill();
  }

  function drawNode(node, time) {
    const color = tokens.agents[node.index];
    const scale = 1 + node.hover * 0.28 + (node.active ? 0.06 : 0);
    const radius = node.r * scale;
    // 光晕
    const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius * 2.4);
    glow.addColorStop(0, color);
    glow.addColorStop(1, "transparent");
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius * 2.4, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.globalAlpha = (node.active ? 0.20 : 0.10) + node.hover * 0.16;
    ctx.fill();
    ctx.globalAlpha = 1;
    // 活跃环（慢转虚线）
    if (node.active && !reduced) {
      ctx.save();
      ctx.translate(node.x, node.y);
      ctx.rotate(time * 0.0004 + node.seed);
      ctx.beginPath();
      ctx.setLineDash([3, 7]);
      ctx.arc(0, 0, radius + 7, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // 本体圆
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = tokens.background;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 汉字代号
    ctx.fillStyle = color;
    ctx.font = `600 ${Math.round(radius * 0.86)}px "Songti SC", "Noto Serif SC", "SimSun", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(node.glyph, node.x, node.y + 1);
    // 标签
    ctx.fillStyle = tokens.muted;
    ctx.font = '500 11px system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(node.label, node.x, node.y + radius + 16);
    if (node.active) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x + radius * 0.72, node.y - radius * 0.72, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    // 边：先全连接细线，再活动边
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const key = [nodes[i].id, nodes[j].id].sort().join("~");
        if (!activity.edges.has(key)) drawEdge(nodes[i], nodes[j], time, false);
      }
    }
    for (const key of activity.edges) {
      const [aId, bId] = key.split("~");
      const a = nodes.find((node) => node.id === aId);
      const b = nodes.find((node) => node.id === bId);
      if (a && b) drawEdge(a, b, time, true);
    }
    drawCore(time);
    for (const node of nodes) drawNode(node, time);
    syncOverlay();
  }

  // DOM overlay：hover 名称卡（canvas 不画长文，保持排版精度）
  function syncOverlay() {
    if (!overlay) return;
    const hovered = nodes.find((node) => node.hover > 0.5);
    if (!hovered) {
      overlay.classList.remove("is-visible");
      return;
    }
    overlay.textContent = `${hovered.label} · ${hovered.glyph} · ${hovered.active ? "在线" : "待命"}`;
    overlay.style.setProperty("--hero-tip-x", `${hovered.x}px`);
    overlay.style.setProperty("--hero-tip-y", `${hovered.y - hovered.r - 14}px`);
    overlay.classList.add("is-visible");
  }

  function frame(time) {
    if (!running) return;
    step(time);
    draw(time);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    resize();
    // 初始位置落到锚点（避免首帧收敛抖动）
    const anchorPoints = anchors();
    nodes.forEach((node, index) => {
      node.x = anchorPoints[index].x;
      node.y = anchorPoints[index].y;
    });
    if (reduced) {
      draw(0);
      return;
    }
    running = true;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  function setActivity(next) {
    activity = next;
    for (const node of nodes) node.active = next.active.has(node.id);
    if (reduced) draw(0);
  }

  function retokenize() {
    tokens = readTokens();
    if (reduced) draw(0);
  }

  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    pointer.inside = true;
  });
  canvas.addEventListener("pointerleave", () => {
    pointer.inside = false;
    pointer.x = -9999;
    pointer.y = -9999;
  });

  const observer = new ResizeObserver(() => resize());
  observer.observe(canvas.parentElement);

  return { start, stop, setActivity, retokenize, resize };
}

async function mount(root) {
  root.innerHTML = `
    <div class="hero-stage">
      <canvas class="hero-canvas" aria-label="六 CLI 协作星图" role="img"></canvas>
      <div class="hero-tip" aria-hidden="true"></div>
      <div class="hero-type" aria-hidden="true">
        <span class="hero-type-vertical">协作星图</span>
        <span class="hero-type-latin">CONSTELLATION<br>OF SIX CLIS</span>
      </div>
      <div class="hero-count" aria-hidden="true">
        <span class="hero-count-num">6</span>
        <span class="hero-count-label">CLI FAMILIES<br>ONE FABRIC</span>
      </div>
    </div>`;
  const canvas = root.querySelector(".hero-canvas");
  const overlay = root.querySelector(".hero-tip");
  const engine = createEngine(canvas, overlay);
  engine.start();
  engine.setActivity(await loadActivity());
  // 主题切换重读 token
  const themeObserver = new MutationObserver(() => engine.retokenize());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  // 30s 慢轮询活动态（星图不是监控面，节奏克制）
  const poll = setInterval(async () => {
    if (!document.body.contains(canvas)) {
      clearInterval(poll);
      themeObserver.disconnect();
      engine.stop();
      return;
    }
    engine.setActivity(await loadActivity());
  }, 30_000);
}

function bootWhenReady() {
  if (typeof document === "undefined") return;
  const start = () => void apiReady.then(() => {
    const root = document.getElementById("hero-container");
    if (root) void mount(root);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

bootWhenReady();
