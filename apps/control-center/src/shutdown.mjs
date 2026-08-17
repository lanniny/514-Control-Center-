export function shouldSetShutdownFailureExitCode(error) {
  const retryable = new Set([
    "CONTROL_CENTER_CLOSE_INCOMPLETE",
    "CONTROL_CENTER_CLOSE_FAILED",
    "CONTROL_CENTER_CLOSE_TIMEOUT",
    "CONTROL_CENTER_SHUTDOWN_TIMEOUT",
  ]);
  return !retryable.has(error?.code) || Boolean(error?.transportReopenError);
}

function shutdownTimeoutError(step, deadline) {
  return Object.assign(
    new Error(`shutdown step ${step} exceeded its budget`),
    { code: "CONTROL_CENTER_SHUTDOWN_TIMEOUT", step, deadline },
  );
}

async function settleShutdownStep(operation, deadline, step) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw shutdownTimeoutError(step, deadline);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(shutdownTimeoutError(step, deadline)), remainingMs);
  });
  try {
    return await Promise.race([
      typeof operation === "function" ? Promise.resolve().then(operation) : Promise.resolve(operation),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createShutdownController({
  closeTransport,
  reopenTransport,
  closeState,
  onClosed,
  onError,
  log = () => {},
  budgetMs = 30_000,
} = {}) {
  for (const [name, operation] of Object.entries({ closeTransport, reopenTransport, closeState, onClosed, onError, log })) {
    if (typeof operation !== "function") throw new TypeError(`${name} must be a function`);
  }

  let pending = null;
  async function shutdown(signal = "unknown") {
    if (pending) return pending;
    const attempt = (async () => {
      const startedAt = Date.now();
      const deadline = startedAt + Math.min(30_000, Math.max(500, Number(budgetMs) || 30_000));
      log(`Shutting down (${signal})...\n`);
      const transportAt = Date.now();
      await settleShutdownStep(closeTransport, deadline, "transport.close");
      log(`[shutdown] transport closed in ${Date.now() - transportAt}ms\n`);
      const stateOperation = Promise.resolve().then(() => closeState({ deadlineMs: deadline }));
      try {
        const stateAt = Date.now();
        await settleShutdownStep(stateOperation, deadline, "state.close");
        log(`[shutdown] state closed in ${Date.now() - stateAt}ms\n`);
      } catch (error) {
        let failure = error;
        // state.close 也收到同一绝对 deadline。若外层计时器先赢，只给它一个很短的
        // drain 窗口收敛内部阶段，避免 HTTP 重开后旧 close 仍在后台释放资源。
        if (error?.code === "CONTROL_CENTER_SHUTDOWN_TIMEOUT") {
          try {
            await settleShutdownStep(stateOperation, Date.now() + 250, "state.close.drain");
          } catch (drainError) {
            if (drainError?.code !== "CONTROL_CENTER_SHUTDOWN_TIMEOUT") failure = drainError;
          }
        }
        log(`[shutdown] state close failed after ${Date.now() - startedAt}ms (${failure?.code || "unknown"})\n`);
        try {
          // 状态关闭可能正好耗尽主预算；仍保留一个很小且有界的恢复窗口，
          // 否则 HTTP 已关闭而 transport 无法重开，后续重试入口会永久消失。
          const reopenDeadline = Math.max(deadline, Date.now() + 250);
          await settleShutdownStep(reopenTransport, reopenDeadline, "transport.reopen");
        } catch (reopenError) {
          failure.transportReopenError = reopenError;
        }
        throw failure;
      }
      log(`[shutdown] complete in ${Date.now() - startedAt}ms; exiting\n`);
      return onClosed();
    })();
    pending = attempt;
    try {
      return await attempt;
    } finally {
      if (pending === attempt) pending = null;
    }
  }

  function request(signal) {
    void shutdown(signal).catch((error) => onError(error, signal));
  }

  return { shutdown, request };
}
