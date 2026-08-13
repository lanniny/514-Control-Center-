function requirePositiveLimit(value, name) {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return limit;
}

function busyError() {
  return Object.assign(new Error("run event response capacity is busy; retry shortly"), {
    code: "EVENT_INDEX_BUSY",
    retryAfterSeconds: 1,
  });
}

function disconnectedError() {
  return Object.assign(new Error("run event response client disconnected"), {
    name: "AbortError",
    code: "CLIENT_DISCONNECTED",
  });
}

export class ResponseLeaseLimiter {
  #active = 0;
  #activeByKey = new Map();

  constructor({ maxActive, maxActivePerKey }) {
    this.maxActive = requirePositiveLimit(maxActive, "maxActive");
    this.maxActivePerKey = requirePositiveLimit(maxActivePerKey, "maxActivePerKey");
    if (this.maxActivePerKey > this.maxActive) {
      throw new TypeError("maxActivePerKey cannot exceed maxActive");
    }
  }

  snapshot(key = null) {
    const normalizedKey = key == null ? null : String(key);
    return {
      active: this.#active,
      activeForKey: normalizedKey == null ? null : (this.#activeByKey.get(normalizedKey) ?? 0),
    };
  }

  async run(key, response, operation, { request = null } = {}) {
    if (!response || typeof response.once !== "function" || typeof response.off !== "function") {
      throw new TypeError("response must support once/off lifecycle events");
    }
    if (typeof operation !== "function") throw new TypeError("operation must be a function");
    if (request && (typeof request.once !== "function" || typeof request.off !== "function")) {
      throw new TypeError("request must support once/off lifecycle events");
    }

    const release = this.#acquire(String(key));
    const controller = new AbortController();
    let operationSettled = false;
    const initiallyDisconnected = Boolean(
      response.destroyed
      || response.writableEnded
      || response.writableFinished
      || request?.aborted
      || request?.destroyed
    );
    let responseSettled = Boolean(response.writableFinished || initiallyDisconnected);
    if (initiallyDisconnected) controller.abort(disconnectedError());

    const cleanup = () => {
      response.off("finish", onResponseSettled);
      response.off("close", onResponseSettled);
      response.off("error", onResponseSettled);
      request?.off("aborted", onRequestAborted);
      request?.off("error", onRequestAborted);
    };
    const maybeRelease = () => {
      if (!operationSettled || !responseSettled) return;
      cleanup();
      release();
    };
    const onResponseSettled = () => {
      responseSettled = true;
      if (!response.writableFinished && !controller.signal.aborted) controller.abort(disconnectedError());
      maybeRelease();
    };
    const onRequestAborted = () => {
      if (!controller.signal.aborted) controller.abort(disconnectedError());
    };

    response.once("finish", onResponseSettled);
    response.once("close", onResponseSettled);
    response.once("error", onResponseSettled);
    request?.once("aborted", onRequestAborted);
    request?.once("error", onRequestAborted);
    try {
      if (controller.signal.aborted) throw controller.signal.reason;
      return await operation(controller.signal);
    } finally {
      operationSettled = true;
      responseSettled ||= Boolean(response.writableFinished || response.destroyed);
      maybeRelease();
    }
  }

  #acquire(key) {
    const activeForKey = this.#activeByKey.get(key) ?? 0;
    if (this.#active >= this.maxActive || activeForKey >= this.maxActivePerKey) {
      throw busyError();
    }

    this.#active += 1;
    this.#activeByKey.set(key, activeForKey + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
      const remaining = (this.#activeByKey.get(key) ?? 1) - 1;
      if (remaining > 0) this.#activeByKey.set(key, remaining);
      else this.#activeByKey.delete(key);
    };
  }
}
