/**
 * 514 Forge Atelier Canvas — pointer-reactive light field + soft particle constellation.
 * Pure visual layer; never blocks input (pointer-events: none on host).
 */
(function () {
  const canvas = document.getElementById("atelier-canvas");
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0;
  let h = 0;
  let raf = 0;
  let pointer = { x: 0.5, y: 0.35, tx: 0.5, ty: 0.35 };
  let reduced = false;

  try {
    reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    /* ignore */
  }

  const particles = Array.from({ length: reduced ? 10 : 22 }, (_, i) => ({
    x: Math.random(),
    y: Math.random(),
    r: 0.4 + Math.random() * 1.6,
    vx: (Math.random() - 0.5) * 0.00035,
    vy: (Math.random() - 0.5) * 0.00035,
    phase: Math.random() * Math.PI * 2,
    seed: i,
  }));

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function themeInk() {
    const dark = document.documentElement.dataset.theme === "dark";
    // Claude 人文暖纸：低饱和玫瑰点，不用霓虹
    return dark
      ? { particle: "rgba(255, 120, 152, 0.22)", line: "rgba(255, 120, 152, 0.06)", glow: "rgba(255, 120, 152, 0.06)" }
      : { particle: "rgba(180, 35, 77, 0.18)", line: "rgba(180, 35, 77, 0.05)", glow: "rgba(180, 35, 77, 0.05)" };
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;

    ctx.clearRect(0, 0, w, h);
    const ink = themeInk();
    const px = pointer.x * w;
    const py = pointer.y * h;

    // soft spotlight following pointer
    const g = ctx.createRadialGradient(px, py, 0, px, py, Math.max(w, h) * 0.42);
    g.addColorStop(0, ink.glow);
    g.addColorStop(0.45, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (reduced) return;

    const pts = [];
    for (const p of particles) {
      p.x += p.vx + Math.sin(t * 0.0004 + p.phase) * 0.00005;
      p.y += p.vy + Math.cos(t * 0.00035 + p.phase) * 0.00005;
      if (p.x < -0.05) p.x = 1.05;
      if (p.x > 1.05) p.x = -0.05;
      if (p.y < -0.05) p.y = 1.05;
      if (p.y > 1.05) p.y = -0.05;
      // mild attraction to pointer
      const dx = pointer.x - p.x;
      const dy = pointer.y - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist < 0.35) {
        p.x += dx * 0.0008;
        p.y += dy * 0.0008;
      }
      pts.push({ x: p.x * w, y: p.y * h, r: p.r });
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = ink.line;
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        const a = pts[i];
        const b = pts[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 140) {
          ctx.globalAlpha = (1 - d / 140) * 0.55;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink.particle;
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function onMove(event) {
    pointer.tx = event.clientX / Math.max(1, w);
    pointer.ty = event.clientY / Math.max(1, h);
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", onMove, { passive: true });
  raf = requestAnimationFrame(frame);

  window.addEventListener("beforeunload", () => cancelAnimationFrame(raf), { once: true });
})();
