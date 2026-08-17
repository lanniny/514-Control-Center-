/**
 * 协作台终端的工作目录解析。
 * app.js 注入当前选中项目 / 会话 cwd；终端面板 spawn 时读取，避免循环依赖。
 */

let resolver = () => ({});

export function setWorkbenchCwdResolver(fn) {
  resolver = typeof fn === "function" ? fn : () => ({});
}

export function resolveWorkbenchPtySpawn() {
  const value = resolver() || {};
  const cwd = typeof value.cwd === "string" && value.cwd.trim() ? value.cwd.trim() : "";
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim() : "";
  const ssh = value.ssh && value.ssh.hostId ? value.ssh : null;
  return {
    ...(cwd ? { cwd } : {}),
    ...(title ? { title } : {}),
    ...(ssh ? { ssh } : {}),
  };
}

export function folderNameFromPath(path) {
  const text = String(path ?? "").replace(/[\\/]+$/, "");
  return text.split(/[\\/]/).pop() || text || "";
}
