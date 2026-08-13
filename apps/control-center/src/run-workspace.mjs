import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

const execFileAsync = promisify(execFile);

const WORKTREE_SUFFIX = /-wt-\d{14}-[0-9a-f]{8}$/i;

function invalid(message, code = "VALIDATION_FAILED") {
  return Object.assign(new Error(message), { code });
}

function samePath(left, right) {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function absolutePath(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.includes("\0") || !isAbsolute(raw)) {
    throw invalid(`${label}必须是绝对路径`);
  }
  return resolve(raw);
}

export function resolveRunWorkspace(run, { fallbackPath = null } = {}) {
  const hasWorktreePath = Boolean(run?.worktreePath);
  const hasWorktreeBase = Boolean(run?.worktreeBase);
  if (hasWorktreePath || hasWorktreeBase) {
    if (!hasWorktreePath || !hasWorktreeBase) {
      throw invalid("任务隔离工作树记录不完整");
    }
    const path = absolutePath(run.worktreePath, "任务隔离工作树");
    const base = absolutePath(run.worktreeBase, "任务原始仓库");
    const expectedPrefix = `${basename(base)}-wt-`;
    const worktreeName = basename(path);
    const prefixMatches = process.platform === "win32"
      ? worktreeName.toLowerCase().startsWith(expectedPrefix.toLowerCase())
      : worktreeName.startsWith(expectedPrefix);
    if (
      !samePath(dirname(path), dirname(base))
      || !prefixMatches
      || !WORKTREE_SUFFIX.test(worktreeName)
    ) {
      throw invalid("任务隔离工作树路径不符合受控命名与目录边界");
    }
    return { path, base, kind: "worktree" };
  }
  if (run?.permissionMode === "build") {
    throw invalid("构建任务的隔离工作树尚未就绪", "WORKTREE_NOT_READY");
  }
  if (run?.cwd) return { path: absolutePath(run.cwd, "任务工作目录"), base: null, kind: "workspace" };
  if (fallbackPath) return { path: absolutePath(fallbackPath, "控制面工作目录"), base: null, kind: "control-center" };
  throw invalid("该任务没有可用的项目目录");
}

function worktreeRecords(raw) {
  return String(raw ?? "")
    .split("\0")
    .filter((field) => field.startsWith("worktree "))
    .map((field) => field.slice("worktree ".length));
}

async function sameDirectoryIdentity(candidate, canonicalPath, canonicalInfo) {
  try {
    const candidatePath = await realpath(candidate);
    const candidateInfo = await lstat(candidatePath);
    if (canonicalInfo.ino && candidateInfo.ino) {
      return canonicalInfo.dev === candidateInfo.dev && canonicalInfo.ino === candidateInfo.ino;
    }
    return resolve(candidatePath) === resolve(canonicalPath);
  } catch {
    return false;
  }
}

export async function attestRunWorkspace(run, { execFileImpl = execFileAsync } = {}) {
  const workspace = resolveRunWorkspace(run);
  if (workspace.kind !== "worktree") return workspace;

  let pathInfo;
  let baseInfo;
  let canonicalPath;
  let canonicalBase;
  try {
    [pathInfo, baseInfo, canonicalPath, canonicalBase] = await Promise.all([
      lstat(workspace.path),
      lstat(workspace.base),
      realpath(workspace.path),
      realpath(workspace.base),
    ]);
  } catch (error) {
    throw invalid(`任务隔离工作树不可读取：${error?.code || "UNKNOWN"}`, "WORKTREE_INVALID");
  }
  if (!pathInfo.isDirectory() || pathInfo.isSymbolicLink() || !baseInfo.isDirectory() || baseInfo.isSymbolicLink()) {
    throw invalid("任务隔离工作树或原始仓库不能是链接且必须为目录", "WORKTREE_INVALID");
  }

  let listing;
  let topLevel;
  try {
    [listing, topLevel] = await Promise.all([
      execFileImpl("git", ["-C", canonicalBase, "worktree", "list", "--porcelain", "-z"], {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      }),
      execFileImpl("git", ["-C", canonicalPath, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 256 * 1024,
        windowsHide: true,
      }),
    ]);
  } catch (error) {
    throw invalid(`任务隔离工作树 Git 身份不可验证：${error?.code || "UNKNOWN"}`, "WORKTREE_INVALID");
  }
  const registeredMatches = await Promise.all(
    worktreeRecords(listing.stdout).map((path) => sameDirectoryIdentity(path, canonicalPath, pathInfo)),
  );
  const topLevelMatches = await sameDirectoryIdentity(String(topLevel.stdout ?? "").trim(), canonicalPath, pathInfo);
  if (!registeredMatches.some(Boolean) || !topLevelMatches) {
    throw invalid("任务隔离工作树未登记在原始仓库或 Git 顶层不匹配", "WORKTREE_INVALID");
  }
  return { path: canonicalPath, base: canonicalBase, kind: "worktree" };
}
