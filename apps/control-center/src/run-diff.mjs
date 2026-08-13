// run 产物 diff（codeg 对标 P2：worktree 与 run 关联的产物视图——控制面独有价值）。
// 只读 git 查询；路径只信服务端 ensureRunWorktree 生成的命名形态（纵深校验防 run 记录被篡改指路）；
// 内容过 scrub 脱敏（worktree 里可能有 agent 写入的密钥字面量）；超 200KB 截断如实标注。
import { runProcess } from "./process-runner.mjs";
import { scrub } from "./bus.mjs";
import { attestRunWorkspace } from "./run-workspace.mjs";

const DIFF_LIMIT = 200 * 1024;

export async function runDiffForRun(run, { runner = runProcess } = {}) {
  let workspace;
  try {
    workspace = await attestRunWorkspace(run);
  } catch (error) {
    if (run?.worktreePath || run?.worktreeBase) throw error;
    throw Object.assign(new Error("该任务无隔离工作树（plan 模式或未提供项目地址），无产物可比对"), { code: "VALIDATION_FAILED" });
  }
  if (workspace.kind !== "worktree") {
    throw Object.assign(new Error("该任务无隔离工作树（plan 模式或未提供项目地址），无产物可比对"), { code: "VALIDATION_FAILED" });
  }
  const worktreePath = workspace.path;
  const [status, stat, diff] = await Promise.all([
    runner("git", ["-C", worktreePath, "status", "--porcelain"], { timeoutMs: 30_000, maxOutputBytes: 256 * 1024 }),
    runner("git", ["-C", worktreePath, "diff", "--stat", "HEAD"], { timeoutMs: 30_000, maxOutputBytes: 256 * 1024 }),
    runner("git", ["-C", worktreePath, "diff", "HEAD"], { timeoutMs: 60_000, maxOutputBytes: 2 * 1024 * 1024 }),
  ]);
  const diffText = scrub(diff.stdout);
  const truncated = diffText.length > DIFF_LIMIT;
  return {
    runId: run.id,
    worktree: worktreePath,
    base: workspace.base,
    status: status.stdout,
    stat: stat.stdout,
    diff: truncated ? `${diffText.slice(0, DIFF_LIMIT)}\n\n…（diff 超 200KB 已截断，完整内容请在工作树内查看）` : diffText,
    truncated,
  };
}
