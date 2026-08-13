export function shouldSetShutdownFailureExitCode(error) {
  return error?.code !== "CONTROL_CENTER_CLOSE_INCOMPLETE" || Boolean(error?.transportReopenError);
}

export function createShutdownController({
  closeTransport,
  reopenTransport,
  closeState,
  onClosed,
  onError,
  log = () => {},
} = {}) {
  for (const [name, operation] of Object.entries({ closeTransport, reopenTransport, closeState, onClosed, onError, log })) {
    if (typeof operation !== "function") throw new TypeError(`${name} must be a function`);
  }

  let pending = null;
  async function shutdown(signal = "unknown") {
    if (pending) return pending;
    const attempt = (async () => {
      log(`Shutting down (${signal})...\n`);
      await closeTransport();
      try {
        await closeState();
      } catch (error) {
        if (error?.code === "CONTROL_CENTER_CLOSE_INCOMPLETE") {
          try {
            await reopenTransport();
          } catch (reopenError) {
            error.transportReopenError = reopenError;
          }
        }
        throw error;
      }
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
