/**
 * Stable project identity for session data created on either Windows or POSIX.
 * The source path's shape determines semantics; the current host must not.
 */
export function normalizePathKey(value) {
  const path = String(value ?? "").trim();
  if (!path) return "";
  const drivePath = /^[A-Za-z]:[\\/]/.test(path);
  const uncPath = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(path);
  if (uncPath) {
    const body = path.replace(/^[\\/]+/, "").replace(/[\\/]+/g, "\\").replace(/\\+$/, "");
    return `\\\\${body.toLowerCase()}`;
  }
  if (drivePath) {
    const normalized = path.replace(/[\\/]+/g, "\\").toLowerCase();
    return /^[a-z]:\\$/.test(normalized) ? normalized : normalized.replace(/\\+$/, "");
  }
  if (path === "/") return path;
  return path.replace(/\/+$/, "") || "/";
}
