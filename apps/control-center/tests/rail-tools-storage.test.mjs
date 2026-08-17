import test from "node:test";
import assert from "node:assert/strict";
import { safeLocalStorage, safeStorageGet, safeStorageRemove, safeStorageSet } from "../public/rail-tools.js";

test("rail tool storage helpers fail soft when Web Storage is blocked", () => {
  const blocked = {
    getItem() { throw new DOMException("blocked", "SecurityError"); },
    setItem() { throw new DOMException("blocked", "SecurityError"); },
    removeItem() { throw new DOMException("blocked", "SecurityError"); },
  };
  assert.equal(safeStorageGet(blocked, "key"), null);
  assert.doesNotThrow(() => safeStorageSet(blocked, "key", "value"));
  assert.doesNotThrow(() => safeStorageRemove(blocked, "key"));
});

test("rail tool storage helpers preserve normal storage behavior", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  safeStorageSet(storage, "active", "mission");
  assert.equal(safeStorageGet(storage, "active"), "mission");
  safeStorageRemove(storage, "active");
  assert.equal(safeStorageGet(storage, "active"), null);
});

test("rail tools fail soft when localStorage getter itself is blocked", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw new DOMException("blocked", "SecurityError"); },
  });
  try {
    assert.equal(safeLocalStorage(), null);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});
