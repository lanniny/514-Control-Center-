/**
 * Provider-native resume commands for multi-CLI sessions.
 * Fail-closed: unknown providers get canResume=false.
 */

export function resumeHintsFromSessions(sessions = {}) {
  const hints = [];
  for (const [agentId, session] of Object.entries(sessions || {})) {
    const sessionId = typeof session === "string"
      ? session
      : (session?.sessionId || session?.id || null);
    if (!sessionId) continue;
    const id = String(agentId || "");
    let canResume = false;
    let command = null;
    let protocol = "unknown";
    if (id.startsWith("claude") || id.includes("fable")) {
      canResume = true;
      protocol = "claude-stream-json";
      command = `claude -r ${sessionId}`;
    } else if (id.startsWith("codex")) {
      canResume = true;
      protocol = "codex";
      command = `codex exec resume ${sessionId}`;
    } else if (id.startsWith("kimi")) {
      canResume = true;
      protocol = "kimi";
      command = `kimi -S ${sessionId}`;
    } else if (id.startsWith("grok-build") || id.includes("grok-build")) {
      canResume = true;
      protocol = "grok-build";
      command = `grok -r ${sessionId}`;
    } else if (id.startsWith("pi")) {
      canResume = false;
      protocol = "pi-rpc";
      command = null;
    }
    hints.push({
      agentId: id,
      sessionId: String(sessionId),
      protocol,
      canResume,
      command,
      note: canResume
        ? "native-session resume only; never cross-provider"
        : "no verified native resume for this adapter",
    });
  }
  return hints;
}

export function resumeHintsMarkup(hints, { escapeHtml }) {
  const list = Array.isArray(hints) ? hints.filter((item) => item?.canResume && item.command) : [];
  if (!list.length) return "";
  return `
    <div class="resume-hints" role="group" aria-label="异构 CLI 原生恢复命令">
      <div class="resume-hints-head">
        <strong>原生会话恢复</strong>
        <span class="subtle">按 provider 原生命令；禁止跨 CLI 静默 resume</span>
      </div>
      <ul class="resume-hints-list">
        ${list.map((item) => `
          <li class="resume-hint-row">
            <span class="resume-hint-agent">${escapeHtml(item.agentId)}</span>
            <code class="resume-hint-cmd" title="${escapeHtml(item.sessionId)}">${escapeHtml(item.command)}</code>
            <button type="button" class="text-button" data-copy-resume="${escapeHtml(item.command)}">复制</button>
          </li>`).join("")}
      </ul>
    </div>`;
}
