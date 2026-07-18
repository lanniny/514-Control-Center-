import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { findSecretCandidates, sanitizeForPersistence } from "./redaction.mjs";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const CODEX_TRANSPORT_FAILURES = new Set(["APP_SERVER_EXIT", "APP_SERVER_TIMEOUT", "EPIPE", "ECONNRESET", "ENOENT", "UNSAFE_COMMAND_SHIM"]);

async function closeWithin(adapter, timeoutMs = 10_000) {
  let timer;
  const result = await Promise.race([
    Promise.resolve().then(() => adapter.close?.()).then(() => null, (error) => error),
    new Promise((resolveTimeout) => { timer = setTimeout(() => resolveTimeout(new Error(`adapter close timed out after ${timeoutMs}ms`)), timeoutMs); }),
  ]);
  clearTimeout(timer);
  return result;
}

export class Orchestrator {
  constructor({ router, adapters, eventStore, dataRoot, policy, approvalBroker, teams = null }) {
    this.router = router;
    this.adapters = adapters;
    this.eventStore = eventStore;
    this.dataRoot = dataRoot;
    this.policy = policy;
    this.approvalBroker = approvalBroker;
    this.teams = teams;
    this.runs = new Map();
    this.controllers = new Map();
    this.executions = new Map();
    this.closing = false;
    this.runDir = join(dataRoot, "runs");
    this.saveChains = new Map(); // per-run 写盘串行链（save 竞态修复），完成即自清
    // 已清除 run 的墓碑：终态尾巴协程（drain 收尾/emitEvent 降级路径）持有 run 引用的迟到 save
    // 会绕过 Map 复活文件——墓碑让 save 直接丢弃。uuid 每条约 40B、清除频率低，不回收。
    this.clearedRuns = new Set();
  }

  async init() {
    await mkdir(this.runDir, { recursive: true });
    let names = [];
    try {
      names = await readdir(this.runDir);
    } catch {
      names = [];
    }
    for (const name of names.filter((item) => item.endsWith(".json"))) {
      let run = null;
      try {
        run = JSON.parse(await readFile(join(this.runDir, name), "utf8"));
        let restatedOnRestart = false; // 重启改写必须落盘，否则内存与磁盘分叉（烛 wave2 回炉 P2）
        if (run.status === "waiting_approval") {
          restatedOnRestart = true;
          run.status = "cancelled";
          if (run.buildApproval) run.buildApproval.status = "expired";
          run.error = "Pending approval expired when the control plane restarted.";
          run.recoveryNote = "Submit a new build run to create a fresh action-bound approval.";
        } else if (["running", "waiting_agent"].includes(run.status)) {
          restatedOnRestart = true;
          if (run.permissionMode === "build") {
            run.status = "cancelled";
            if (run.buildApproval) run.buildApproval.status = "revoked";
            run.error = "A write-capable run cannot resume automatically after a control-plane restart.";
            run.recoveryNote = "Native session IDs are retained for read-only inspection; submit a new build run for further writes.";
          } else if ((run.turnAttempts || []).some((attempt) => ["submitting", "submitted", "ambiguous"].includes(attempt.phase))) {
            run.status = "recovery_required";
            run.error = "A native turn may have been submitted before the control plane stopped.";
            run.recoveryNote = "Inspect the persisted session and explicitly acknowledge recovery before sending another prompt; automatic replay is blocked.";
          } else {
            run.status = "waiting_agent";
            run.recoveryNote = "Control plane restarted; native session IDs are retained and can be continued.";
          }
        }
        // 重启改写必须先成功落盘才入内存（烛 wave2 回炉 P2a）：save 失败抛进外层 catch。
        // save() 成功路径内部已做 runs.set。
        if (restatedOnRestart) await this.save(run);
        else this.runs.set(run.id, run);
      } catch {
        // 解析失败或落盘失败的 run 不入内存、文件留盘待查。save() 的同步段先 runs.set 后写盘，
        // 真实 writeFile/rename 失败时 run 已在 Map——此处显式移除，堵住内存新态/磁盘旧态分叉。
        if (run?.id) this.runs.delete(run.id);
      }
    }
    return this;
  }

  policySha256() {
    return createHash("sha256").update(JSON.stringify(this.policy)).digest("hex");
  }

  buildApprovalMessage(run) {
    const policySha256 = this.policySha256();
    return {
      method: "control/runBuild/requestApproval",
      params: {
        runId: run.id,
        promptSha256: createHash("sha256").update(run.prompt).digest("hex"),
        workspace: this.adapters.get("codex-technical")?.cwd || null,
        selectedAgent: run.route.selected.id,
        permissionMode: run.permissionMode,
        collaborationMode: run.collaborationMode,
        maxRounds: run.maxRounds,
        policyVersion: this.policy.version,
        policySha256,
      },
    };
  }

  buildApprovalIsValid(run) {
    if (run.permissionMode !== "build" || run.buildApproval?.status !== "approved") return false;
    const message = this.buildApprovalMessage(run);
    const expectedActionSha256 = createHash("sha256")
      .update(JSON.stringify({ method: message.method, params: message.params }))
      .digest("hex");
    return run.permissionMode === "build"
      && run.buildApproval.policySha256 === this.policySha256()
      && run.buildApproval.actionSha256 === expectedActionSha256;
  }

  async save(run) {
    if (this.clearedRuns.has(run.id)) return run; // 墓碑：已清除 run 的迟到写盘直接丢弃，不复活文件
    // 竞态修复（烛 wave2 P1）：旧序"快照 → await 写盘 → 回写旧快照"会把写盘窗口内的并发变更
    // （pendingSteer.push/shift、turns.push）用旧快照覆盖抹掉——用户插话可能静默丢失或已执行项
    // 被写回重复执行。现序两根支柱：①快照+回写在同一 tick 内完成（事件循环内原子，无覆盖窗口）；
    // ②写盘挂 per-run 链串行（防旧快照后落盘造成磁盘回退）。
    run.updatedAt = new Date().toISOString();
    const safe = sanitizeForPersistence(run);
    Object.assign(run, safe);
    this.runs.set(run.id, run);
    const previous = this.saveChains.get(run.id) || Promise.resolve();
    const flush = previous.catch(() => {}).then(async () => {
      // 写盘前复查墓碑（纵深防御，烛 R6）：清理窗口内已通过入口检查、排在链上的迟到写盘也丢弃
      if (this.clearedRuns.has(run.id)) return;
      const target = join(this.runDir, `${run.id}.json`);
      const temp = join(this.runDir, `.${run.id}.${randomUUID()}.tmp`);
      await writeFile(temp, `${JSON.stringify(safe, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temp, target);
    });
    this.saveChains.set(run.id, flush);
    try {
      await flush; // 自身写盘失败仍如实抛给调用方；前序失败已被链上 catch 隔离
    } finally {
      if (this.saveChains.get(run.id) === flush) this.saveChains.delete(run.id);
    }
    return run;
  }

  async emitEvent(run, type, data = {}, context = {}) {
    try {
      return await this.eventStore.emit(type, data, context);
    } catch (error) {
      run.auditDegraded = true;
      run.auditErrors = [...(run.auditErrors || []), { type, message: error.message, at: new Date().toISOString() }].slice(-20);
      await this.save(run).catch(() => {});
      return null;
    }
  }

  list() {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // 清除已结束任务（succeeded/failed/cancelled）——活跃与 recovery_required 一律不动
  async clearFinished() {
    const cleared = [];
    for (const run of [...this.runs.values()]) {
      // 活跃协程门闩（烛 R7）：终态置位与协程收尾之间（emitEvent/排干轮间的 await 窗口）不清理——
      // 否则协程持有的 run 被删、get 抛 RUN_NOT_FOUND 或"记录已清、agent 仍执行"。跳过本轮，下次再收。
      const coroutineActive = () =>
        this.controllers.has(run.id) || this.executions.has(run.id) || this.executions.has(`continue:${run.id}`);
      if (!TERMINAL.has(run.status) || coroutineActive()) continue;
      try {
        // 清理屏障（烛 wave2 回炉 P1a）：①循环收敛在途写链——等待期间挂上的新链继续等，
        // 只删自己等完的那条引用，不误删新链②复查 terminal（等待期间被续聊激活则放过）
        // ③先摘内存 Map 再删文件——摘除后 continue 必 RUN_NOT_FOUND，rm 的 await 窗口内
        // 不可能再产生新 save 链或激活，迟到 rename 复活与误删活跃 run 两个口同时堵死。
        let chain;
        while ((chain = this.saveChains.get(run.id))) {
          await chain.catch(() => {});
          if (this.saveChains.get(run.id) === chain) {
            this.saveChains.delete(run.id);
            break;
          }
        }
        if (!TERMINAL.has(run.status) || coroutineActive()) continue; // 链等待期间被激活/新协程接管则放过
        this.runs.delete(run.id);
        this.clearedRuns.add(run.id); // 墓碑先立（与 Map 摘除同 tick）：rm 的 await 窗口内迟到 save 直接被丢弃（烛 R6）
        try {
          await rm(join(this.runDir, `${run.id}.json`), { force: true });
        } catch (removeError) {
          this.clearedRuns.delete(run.id); // 删盘失败撤销墓碑并恢复内存可见性——磁盘还在就不能装作已清除
          this.runs.set(run.id, run);
          throw removeError;
        }
        cleared.push(run.id);
      } catch {
        // 删除失败的保留在列表，如实反映磁盘状态
      }
    }
    await this.eventStore
      .emit("run.finished_cleared", { count: cleared.length, runIds: cleared }, { sensitivity: "internal", agentId: "control-plane" })
      .catch(() => {});
    return { cleared: cleared.length, runIds: cleared };
  }

  get(id) {
    const run = this.runs.get(id);
    if (!run) throw Object.assign(new Error("run not found"), { code: "RUN_NOT_FOUND" });
    return run;
  }

  async create(input = {}) {
    if (this.closing) throw Object.assign(new Error("control plane is shutting down"), { code: "CONTROL_PLANE_CLOSING" });
    const prompt = String(input.prompt || "").trim();
    if (!prompt) throw Object.assign(new Error("prompt is required"), { code: "INVALID_PROMPT" });
    if (Buffer.byteLength(prompt, "utf8") > 256 * 1024) throw Object.assign(new Error("prompt exceeds 256 KiB"), { code: "INVALID_PROMPT" });
    if (findSecretCandidates(prompt).length) {
      throw Object.assign(new Error("prompt contains secret-like material; pass credential references instead of values"), { code: "SENSITIVE_PROMPT" });
    }
    // 团队 = 会话级能力配比：成员进路由白名单，提示词/能力声明注入主脑规划轮
    let team = null;
    if (this.teams) {
      team = this.teams.get(String(input.teamId || "team-514cc")); // 不存在 → SOURCE_NOT_FOUND
    }
    const route = await this.router.preview({
      prompt,
      taskType: input.taskType,
      requestedProvider: input.requestedProvider,
      risk: input.risk,
      needsCurrentSource: input.needsCurrentSource === true,
      allowedProviders: team ? [...team.members] : null,
    });
    const requestedPermissionMode = input.permissionMode === "build" ? "build" : "plan";
    const permissionContract = this.policy.modes?.[requestedPermissionMode];
    if (!permissionContract) throw Object.assign(new Error(`permission mode ${requestedPermissionMode} is not configured`), { code: "POLICY_VIOLATION" });
    if (requestedPermissionMode === "build" && permissionContract.approvalRequired !== true) {
      throw Object.assign(new Error("build mode must remain approval-bound"), { code: "POLICY_VIOLATION" });
    }
    // 会话项目地址：CLI 子进程的工作目录。地址=项目身份（claude 原生按 cwd 归属 ~/.claude/projects）。
    // 校验绝对路径 + 真实存在的目录；不存在/不是目录如实拒绝，不静默回退 repoRoot。
    let sessionCwd = null;
    if (input.cwd) {
      const requested = String(input.cwd).trim();
      if (!isAbsolute(requested)) {
        throw Object.assign(new Error("session cwd must be an absolute path"), { code: "INVALID_CWD" });
      }
      let info;
      try {
        info = await stat(requested);
      } catch {
        throw Object.assign(new Error(`session cwd does not exist: ${requested}`), { code: "INVALID_CWD" });
      }
      if (!info.isDirectory()) {
        throw Object.assign(new Error(`session cwd is not a directory: ${requested}`), { code: "INVALID_CWD" });
      }
      sessionCwd = requested;
    }
    // /model 会话级模型覆盖（claude 主脑轮生效）：白名单校验——别名或 claude-* 完整 id，拒绝任意串进命令行
    let modelOverride = null;
    if (input.model) {
      const requested = String(input.model).trim();
      if (!/^(?:fable|opus|sonnet|haiku|claude-[a-z0-9.-]{1,48})$/i.test(requested)) {
        throw Object.assign(new Error(`unsupported model: ${requested}`), { code: "INVALID_MODEL" });
      }
      modelOverride = requested;
    }
    // /effort 会话级推理力度覆盖（claude 主脑轮生效）：CLI --effort 白名单五档（含 ultracode，
    // 2026-07-19 headless 实测 CLI 接受），拒绝任意串进命令行
    let effortOverride = null;
    if (input.effort) {
      const requestedEffort = String(input.effort).trim().toLowerCase();
      if (!/^(?:low|medium|high|xhigh|ultracode)$/.test(requestedEffort)) {
        throw Object.assign(new Error(`unsupported effort level: ${requestedEffort}`), { code: "INVALID_EFFORT" });
      }
      effortOverride = requestedEffort;
    }
    // 会话入口由团队主脑决定：主脑=规划/综合轮执行者（默认 claude-fable，旧 run 无字段时兜底）
    const coordinatorId = team?.coordinator || "claude-fable";
    const requestedMaxRounds = Number(input.maxRounds) || this.policy.limits.maxRounds;
    const minimumRounds = route.selected.id === coordinatorId ? (route.independentRequired ? 3 : 1) : 3;
    if (this.policy.limits.maxRounds < minimumRounds) {
      throw Object.assign(new Error(`permission policy maxRounds cannot satisfy the selected ${minimumRounds}-round topology`), { code: "POLICY_VIOLATION" });
    }
    if (requestedMaxRounds < minimumRounds) {
      throw Object.assign(new Error(`selected topology requires at least ${minimumRounds} collaboration rounds`), {
        code: "INSUFFICIENT_ROUNDS",
        minimumRounds,
      });
    }
    const now = new Date().toISOString();
    const run = {
      id: randomUUID(),
      status: "queued",
      prompt,
      taskType: route.taskType,
      createdAt: now,
      updatedAt: now,
      maxRounds: Math.max(minimumRounds, Math.min(requestedMaxRounds, this.policy.limits.maxRounds)),
      round: 0,
      route,
      sessions: {},
      turns: [],
      turnAttempts: [],
      inflightTurns: {},
      execute: input.execute === true,
      teamId: team?.id ?? null,
      teamName: team?.name ?? null,
      teamBrief: team ? this.teams.brief(team.id) : null,
      teamMembers: team ? [...team.members] : null, // 成员白名单快照，续聊按此服务端强制隔离（团队删除后仍固化）
      coordinatorId,
      modelOverride,
      effortOverride,
      cwd: sessionCwd, // null=控制面默认（repoRoot）；有值=会话项目地址，CLI 原生会话落该项目
      collaborationMode: input.collaborationMode === "deep" ? "deep" : "standard",
      permissionMode: requestedPermissionMode,
      maxBudgetUsdPerTurn: Math.max(0.05, Math.min(Number(input.maxBudgetUsdPerTurn) || 0.75, Number(this.policy.limits.maxBudgetUsdPerTurn) || 2)),
      buildApproval: requestedPermissionMode === "build" && input.execute === true
        ? { status: "pending", policySha256: this.policySha256(), actionSha256: null, approvedAt: null }
        : null,
      result: null,
      error: null,
    };
    await this.save(run);
    await this.emitEvent(run, "run.created", { taskType: run.taskType, execute: run.execute, route: route.selected, collaborationMode: run.collaborationMode }, { runId: run.id });
    if (!run.execute) {
      run.status = "succeeded";
      run.result = { type: "route-preview", route };
      await this.save(run);
      await this.emitEvent(run, "run.completed", { status: run.status, dryRun: true }, { runId: run.id });
    } else if (run.permissionMode === "build") {
      run.status = "waiting_approval";
      await this.save(run);
      await this.emitEvent(run, "run.waiting_approval", { permissionMode: run.permissionMode }, { runId: run.id });
      queueMicrotask(() => void this.awaitBuildApproval(run.id));
    } else {
      queueMicrotask(() => void this.startExecution(run.id));
    }
    return this.get(run.id);
  }

  async awaitBuildApproval(id) {
    const run = this.get(id);
    const policySha256 = this.policySha256();
    const message = this.buildApprovalMessage(run);
    run.buildApproval.actionSha256 = createHash("sha256").update(JSON.stringify({ method: message.method, params: message.params })).digest("hex");
    await this.save(run);
    try {
      const response = await this.approvalBroker.request(message, { runId: run.id, sessionId: null });
      if (run.status !== "waiting_approval") return;
      if (response.decision !== "accept") {
        run.status = "cancelled";
        run.error = "Build permission was denied or expired.";
        run.buildApproval.status = "denied";
        await this.save(run);
        await this.emitEvent(run, "run.cancelled", { reason: "build approval denied" }, { runId: run.id });
        return;
      }
      run.buildApproval.status = "approved";
      run.buildApproval.approvedAt = new Date().toISOString();
      await this.save(run);
      await this.emitEvent(run, "run.approved", { permissionMode: run.permissionMode, policySha256 }, { runId: run.id });
      await this.startExecution(run.id);
    } catch (error) {
      if (run.status === "cancelled") return;
      run.status = "failed";
      run.error = error.message;
      await this.save(run);
      await this.emitEvent(run, "run.failed", { code: error.code || null, message: error.message }, { runId: run.id });
    }
  }

  async checkpointTurn(run, agentId, attemptId, phase, patch = {}) {
    const attempt = (run.turnAttempts || []).find((item) => item.attemptId === attemptId);
    if (!attempt) throw Object.assign(new Error("turn attempt checkpoint is missing"), { code: "CHECKPOINT_MISSING" });
    Object.assign(attempt, patch, { phase, updatedAt: new Date().toISOString() });
    if (attempt.sessionId) run.sessions[agentId] = attempt.sessionId;
    run.inflightTurns ||= {};
    if (["completed", "failed"].includes(phase)) delete run.inflightTurns[agentId];
    else run.inflightTurns[agentId] = attemptId;
    await this.save(run);
    await this.emitEvent(
      run,
      "agent.turn_checkpoint",
      {
        attemptId,
        round: attempt.round,
        agentId,
        phase,
        protocol: attempt.protocol || null,
        clientUserMessageId: attempt.clientUserMessageId || null,
        nativeTurnId: attempt.nativeTurnId || null,
      },
      { runId: run.id, sessionId: attempt.sessionId || null, agentId },
    );
  }

  async turn(run, agentId, prompt, { allowWorkspaceWrite = false } = {}) {
    if (run.round >= run.maxRounds) throw Object.assign(new Error("maximum collaboration rounds reached"), { code: "ROUND_LIMIT" });
    const controller = this.controllers.get(run.id);
    if (!controller || controller.signal.aborted) throw Object.assign(new Error("run cancelled"), { code: "ABORTED" });
    const coordinatorId = run.coordinatorId || "claude-fable";
    const requestsWorkspaceWrite = allowWorkspaceWrite
      && run.permissionMode === "build"
      && agentId === run.route.selected.id
      && agentId !== coordinatorId;
    if (requestsWorkspaceWrite && !this.buildApprovalIsValid(run)) {
      throw Object.assign(new Error("workspace-write requires a current action-bound build approval"), { code: "POLICY_VIOLATION" });
    }
    // 主脑轮恒 plan（协调者只规划不落盘）；专家轮按审批分 workspace-write / read-only
    const effectivePermissionMode = agentId === coordinatorId ? "plan" : requestsWorkspaceWrite ? "workspace-write" : "read-only";
    run.round += 1;
    run.status = "waiting_agent";
    const attemptId = randomUUID();
    run.turnAttempts ||= [];
    run.inflightTurns ||= {};
    run.turnAttempts.push({
      attemptId,
      round: run.round,
      agentId,
      phase: "prepared",
      promptSha256: createHash("sha256").update(prompt).digest("hex"),
      sessionId: run.sessions[agentId] || null,
      protocol: null,
      clientUserMessageId: null,
      nativeTurnId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    run.inflightTurns[agentId] = attemptId;
    await this.save(run);
    await this.emitEvent(run, "agent.turn_started", { round: run.round, agentId }, { runId: run.id, sessionId: run.sessions[agentId] || null, agentId });

    const adapter = this.adapters.get(agentId);
    if (!adapter) throw Object.assign(new Error(`no executable adapter for ${agentId}`), { code: "ADAPTER_UNAVAILABLE" });
    let response;
    const checkpoint = (phase, data = {}) => this.checkpointTurn(run, agentId, attemptId, phase, {
      sessionId: data.sessionId || run.sessions[agentId] || null,
      protocol: data.protocol || null,
      clientUserMessageId: data.clientUserMessageId || null,
      nativeTurnId: data.turnId || null,
    });
    const lifecycle = {
      onSessionStarted: (data) => checkpoint("session_ready", data),
      onTurnSubmitting: (data) => checkpoint("submitting", data),
      onTurnAccepted: (data) => checkpoint("submitted", data),
    };
    try {
      response = await adapter.send({
        sessionId: run.sessions[agentId] || null,
        prompt,
        runId: run.id,
        signal: controller.signal,
        permissionMode: effectivePermissionMode,
        maxBudgetUsd: run.maxBudgetUsdPerTurn,
        timeoutMs: this.policy.limits.turnTimeoutMs,
        model: agentId === coordinatorId ? run.modelOverride || null : null, // /model 只作用于主脑轮
        effort: agentId === coordinatorId ? run.effortOverride || null : null, // /effort 同样只作用于主脑轮
        cwd: run.cwd || null, // 会话项目地址（spawn 型适配器生效；常驻型 codex app-server 沿用启动 cwd）
        ...lifecycle,
      });
    } catch (error) {
      if (
        agentId !== "codex-technical"
        || controller.signal.aborted
        || !CODEX_TRANSPORT_FAILURES.has(error.code)
        || error.safeToFallback !== true
      ) {
        if (agentId === "codex-technical" && error.safeToFallback === false) {
          if (error.sessionId) {
            run.sessions[agentId] = error.sessionId;
          }
          await checkpoint("ambiguous", {
            sessionId: error.sessionId || run.sessions[agentId] || null,
            protocol: "app-server-v2",
            clientUserMessageId: error.clientUserMessageId || null,
          });
          await this.emitEvent(
            run,
            "adapter.replay_blocked",
            {
              from: "codex-app-server",
              reason: error.message,
              phase: error.codexPhase || "unknown",
              clientUserMessageId: error.clientUserMessageId || null,
            },
            { runId: run.id, sessionId: error.sessionId || run.sessions[agentId] || null, agentId },
          );
        }
        throw error;
      }
      const fallback = this.adapters.get("codex-technical-fallback");
      if (!fallback) throw error;
      await this.emitEvent(
        run,
        "adapter.fallback",
        { from: "codex-app-server", to: "codex-exec-json", reason: error.message },
        { runId: run.id, sessionId: run.sessions[agentId] || null, agentId },
      );
      response = await fallback.send({
        sessionId: run.sessions[agentId] || null,
        prompt,
        runId: run.id,
        signal: controller.signal,
        timeoutMs: this.policy.limits.turnTimeoutMs,
        ...lifecycle,
      });
    }
    run.sessions[agentId] = response.sessionId;
    run.turns.push({
      // id/createdAt/role 供前端重启后从 turns 恢复对话时稳定去重、真实时序排序、正确归属（避免倒置/全显 Agent）
      id: attemptId,
      round: run.round,
      role: "assistant",
      agentId,
      createdAt: new Date().toISOString(),
      sessionId: response.sessionId,
      protocol: response.protocol,
      permissionMode: effectivePermissionMode,
      requestedModel: response.requestedModel ?? null,
      effectiveModel: response.effectiveModel ?? null,
      costUsd: response.costUsd ?? null,
      tokens: response.tokens ?? null, // 状态栏累计用量
      text: response.text,
    });
    await checkpoint("completed", {
      sessionId: response.sessionId,
      protocol: response.protocol,
      clientUserMessageId: (run.turnAttempts || []).find((item) => item.attemptId === attemptId)?.clientUserMessageId || null,
    });
    await this.save(run);
    await this.emitEvent(run, "agent.turn_completed", {
      round: run.round,
      agentId,
      protocol: response.protocol,
      permissionMode: effectivePermissionMode,
      requestedModel: response.requestedModel ?? null,
      effectiveModel: response.effectiveModel ?? null,
      costUsd: response.costUsd ?? null,
      tokens: response.tokens ?? null,
    }, { runId: run.id, sessionId: response.sessionId, agentId });
    return response.text;
  }

  async execute(id) {
    const run = this.get(id);
    if (TERMINAL.has(run.status)) return run;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    run.status = "running";
    await this.save(run);
    try {
      const specialistId = run.route.selected.id;
      const independentId = run.route.independent?.id || null;
      const coordinatorId = run.coordinatorId || "claude-fable";
      const teamContext = run.teamBrief ? `${run.teamBrief}\n\n` : "";
      // 轮间插话：每个 turn 边界尝试注入最早一条排队追问（turn 原子性不变——只在边界接管，不打断子进程）
      const turn = async (...args) => {
        const text = await this.turn(run, ...args);
        await this.injectNextSteer(run);
        return text;
      };
      const plan = await turn(
        coordinatorId,
        `${teamContext}你是 514cc 团队主脑与总协调者。本轮是规划阶段（plan 权限模式，只读不落盘）；禁止声称已写入、已部署或未验证的完成。请输出可公开审计的计划、派工理由、验收标准和给执行者的任务包，不输出隐藏思维链。\n\n用户目标：\n${run.prompt}\n\n路由器建议：${specialistId}\n路由理由：${run.route.reason}`,
      );
      if (specialistId === coordinatorId || run.round >= run.maxRounds) {
        // 主脑兼任被路由选中的执行者时，本分支只做规划轮（plan，只读）不落盘。
        // build 模式下用户期望写入却不会发生：明示告知而非静默 no-op（严禁 silent fallback）。
        if (run.permissionMode === "build" && run.execute && specialistId === coordinatorId) {
          await this.emitEvent(run, "run.coordinator_write_skipped", {
            coordinatorId,
            note: "主脑同时被选为执行者，本轮仅规划不落盘；如需写入请改用独立专家或 claude 主脑团队",
          }, { runId: run.id, agentId: coordinatorId });
        }
        if (independentId && run.round < run.maxRounds) {
          const independent = await turn(
            independentId,
            `你是独立验证者，不受主脑结论约束。请核查以下计划的正确性、遗漏、风险和可执行性，给出证据化 verdict。不要输出隐藏思维链。\n\n原始目标：\n${run.prompt}\n\n主脑计划：\n${plan}`,
          );
          const final = run.round < run.maxRounds
            ? await turn(
                coordinatorId,
                `独立验证者 ${independentId} 已审查你的计划。请吸收有效纠偏并给出最终可执行结论、验收证据和剩余风险。\n\n原始计划：\n${plan}\n\n独立审查：\n${independent}`,
              )
            : independent;
          run.result = { plan, independent, final };
        } else {
          run.result = { plan, final: plan };
        }
      } else {
        const specialist = await turn(
          specialistId,
          `主脑（${coordinatorId}）派发以下任务。请作为独立技术/研究执行者完成，保留证据、指出阻塞并提出明确反问。\n\n原始目标：\n${run.prompt}\n\n主脑计划：\n${plan}`,
          { allowWorkspaceWrite: true },
        );
        const verifierId = independentId || coordinatorId;
        const critique = await turn(
          verifierId,
          `你是本轮独立验证者。执行者 ${specialistId} 已返回结果。请检查它是否满足原目标，指出缺口、核验证据，并输出可直接作为最终审计结论使用的 verdict；如仍有轮次，再附给执行者的补强指令。\n\n原始目标：\n${run.prompt}\n\n执行结果：\n${specialist}`,
        );
        let verified = specialist;
        if (run.collaborationMode === "deep" && run.round < run.maxRounds - 1) {
          verified = await turn(
            specialistId,
            `独立验证者（${verifierId}）对上一轮结果的复核如下。请在同一个原生会话中完成补强并给出最终证据。\n\n${critique}`,
            { allowWorkspaceWrite: true },
          );
        }
        const final = run.round < run.maxRounds
          ? await turn(
              coordinatorId,
              `作为主脑，请综合原始目标、执行结果和复核结果，输出最终结论、已验证证据、未完成风险与下一步。不要隐藏工具失败。\n\n原始目标：${run.prompt}\n\n初次执行：${specialist}\n\n复核/补强：${verified}`,
            )
          : critique;
        run.result = { plan, specialist, critique, verified, final };
      }
      // 轮间插话收尾：拓扑走完后仍排队的追问按 FIFO 逐轮续跑，直到清空/封顶/取消（不打断子进程）
      while ((run.pendingSteer || []).length) {
        if (!(await this.injectNextSteer(run))) break;
        run.result = { ...(run.result || {}), continued: run.turns.at(-1)?.text ?? null };
      }
      // abort 与拓扑收尾竞态：取消回执优先，不改回 succeeded
      run.status = controller.signal.aborted ? "cancelled" : "succeeded";
      await this.save(run);
      await this.emitEvent(run, "run.completed", { status: run.status, rounds: run.round, sessions: run.sessions }, { runId: run.id });
    } catch (error) {
      run.status = controller.signal.aborted || error.code === "ABORTED" ? "cancelled" : "failed";
      run.error = error.message;
      await this.save(run);
      await this.emitEvent(run, "run.failed", { status: run.status, code: error.code || null, message: error.message }, { runId: run.id });
    } finally {
      // 只删自己的 controller：terminal 置位到此处之间新 continue 可能已接管同键（烛 wave2 R5 余波）
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
    }
    return this.get(id);
  }

  startExecution(id) {
    if (this.executions.has(id)) return this.executions.get(id);
    const execution = this.execute(id)
      .finally(() => this.executions.delete(id))
      .then(() => this.ensureSteerDrained(id));
    this.executions.set(id, execution);
    return execution;
  }

  // 收尾窗口兜底：terminal 置位与 controller/executions 释放之间排入的插话没有活跃消费者，
  // 协程链彻底结束后补启后台 drain——排队项最多滞留一瞬，绝不静默丢失。队列空/run 已清除时 no-op。
  ensureSteerDrained(id) {
    if (this.closing) return; // 关闭中不重启任何排干（烛 R6）
    const run = this.runs.get(id);
    if (!run || this.clearedRuns.has(id)) return;
    if (this.executions.has(id)) return; // 已有 execute/drain 在消费——再建 controller 只会覆盖占位（烛 R6）
    if (!(run.pendingSteer || []).length) return;
    // 仅 succeeded 补收：cancelled/failed 的留队是取消/失败语义的如实呈现，重启消费违背用户意图（烛 R6）
    if (run.status !== "succeeded") return;
    // 封顶主动留队（丢弃即停排、剩余如实可见）不是滞留——补启只会把留队项逐条丢光，违背审计语义
    if (run.round >= this.policy.limits.maxRounds) return;
    const controller = new AbortController();
    this.controllers.set(id, controller); // cancel(id) 仍可中止补启的排干
    this.startSteerDrain(id, controller);
  }

  // 取最早一条排队追问注入为下一轮：先发 user.message（前端实时可见），再走既有 turn 路径。
  // 只在 turn 边界被调用（execute 轮间 / 排干 driver），绝不打断进行中的子进程。
  // 轮预算尽量自带（maxRounds+1、封顶策略上限，不吃拓扑既有轮次）；腾挪不出一轮时如实丢弃留痕，不把 run 打 failed。
  // 返回 false = 轮次封顶已丢弃，调用方应停止排干（剩余追问留在队列里如实可见）。
  async injectNextSteer(run) {
    const steer = (run.pendingSteer || []).shift();
    if (!steer) return true;
    run.maxRounds = Math.min(this.policy.limits.maxRounds, run.maxRounds + 1);
    if (run.round >= run.maxRounds) {
      await this.save(run); // 出队落盘，重启后队列状态如实恢复
      await this.emitEvent(run, "run.steer_dropped", { text: steer.prompt, agentId: steer.agentId, reason: "ROUND_LIMIT" }, { runId: run.id, agentId: "LO" });
      return false;
    }
    await this.save(run); // 出队 + 轮预算一并落盘
    await this.emitEvent(run, "user.message", { text: steer.prompt }, { runId: run.id, agentId: "LO" });
    await this.turn(run, steer.agentId || run.coordinatorId || "claude-fable", steer.prompt);
    return true;
  }

  // 排干 driver 主体（与 execute 同构：内部自捕获，不向调用方抛错）；失败如实落 failed + run.failed 事件
  async drainSteer(id, controller) {
    const run = this.get(id);
    try {
      while ((run.pendingSteer || []).length && !controller.signal.aborted) {
        if (!(await this.injectNextSteer(run))) break;
        run.status = controller.signal.aborted ? "cancelled" : "succeeded"; // 轮内被取消不覆盖 cancel 回执
        run.result = { ...(run.result || {}), continued: run.turns.at(-1)?.text ?? null };
        await this.save(run);
      }
    } catch (error) {
      run.status = controller.signal.aborted ? "cancelled" : "failed";
      run.error = error.message;
      await this.save(run);
      await this.emitEvent(run, "run.failed", { status: run.status, code: error.code || null, message: error.message }, { runId: id });
    } finally {
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
    }
  }

  // 轮间插话排干：接管续聊的 controller，按 FIFO 把排队追问逐轮注入直到清空/封顶/取消。
  // 与 startExecution 同构的后台执行：进 executions（close() 会等待、isBusy() 计入），不进 HTTP 等待路径。
  startSteerDrain(id, controller) {
    if (this.executions.has(id)) return this.executions.get(id);
    const drain = this.drainSteer(id, controller)
      .finally(() => this.executions.delete(id))
      .then(() => this.ensureSteerDrained(id)); // 排干尾窗又排入的继续补收，队列空即终止递归
    this.executions.set(id, drain);
    return drain;
  }

  async continue(id, { prompt, agentId = null, acknowledgeRecovery = false }) {
    const run = this.get(id);
    agentId = agentId || run.coordinatorId || "claude-fable"; // 续聊缺省回到团队主脑（会话入口）
    if (this.closing) throw Object.assign(new Error("control plane is shutting down"), { code: "CONTROL_PLANE_CLOSING" });
    const nextPrompt = String(prompt || "").trim();
    if (!nextPrompt) throw Object.assign(new Error("prompt is required"), { code: "INVALID_PROMPT" });
    if (Buffer.byteLength(nextPrompt, "utf8") > 256 * 1024) throw Object.assign(new Error("prompt exceeds 256 KiB"), { code: "INVALID_PROMPT" });
    if (findSecretCandidates(nextPrompt).length) throw Object.assign(new Error("prompt contains secret-like material"), { code: "SENSITIVE_PROMPT" });
    if (run.status === "waiting_approval" || run.buildApproval?.status === "pending") {
      throw Object.assign(new Error("run is waiting for its action-bound build approval"), { code: "APPROVAL_REQUIRED" });
    }
    if (run.status === "recovery_required" && acknowledgeRecovery !== true) {
      throw Object.assign(new Error("the previous native turn has an ambiguous submission state"), { code: "RECOVERY_REQUIRED" });
    }
    if (!this.adapters.get(agentId)) throw Object.assign(new Error(`no executable adapter for ${agentId}`), { code: "ADAPTER_UNAVAILABLE" });
    // 续聊只能派给团队成员（派工白名单服务端强制，不信前端下拉）——旧 run 无快照时放行兼容
    if (Array.isArray(run.teamMembers) && !run.teamMembers.includes(agentId)) {
      throw Object.assign(new Error(`${agentId} is not a member of this run's team`), { code: "NOT_TEAM_MEMBER" });
    }
    if (run.round >= this.policy.limits.maxRounds) {
      throw Object.assign(new Error("maximum collaboration rounds reached"), { code: "ROUND_LIMIT" });
    }
    // recovery 确认在全部准入校验通过后才写入（烛 wave2 回炉 P2）：先写后校验会在校验抛错时
    // 留下未持久化的孤儿字段，内存与磁盘分叉
    if (run.status === "recovery_required") {
      run.recoveryAcknowledgedAt = new Date().toISOString();
      run.recoveryNote = "Operator acknowledged the ambiguous prior turn before sending a new prompt.";
    }
    if (this.controllers.has(id)) {
      // 轮间插话：run 活跃时 continue 不再抛 RUN_ACTIVE——准入校验同上，排队持久化到 run.pendingSteer，
      // 当前 turn 边界由编排器按 FIFO 取出注入（injectNextSteer：先 user.message 再续轮），不打断子进程。
      run.pendingSteer ||= [];
      run.pendingSteer.push({ prompt: nextPrompt, agentId, queuedAt: new Date().toISOString() });
      await this.save(run);
      await this.emitEvent(run, "run.steer_queued", { text: nextPrompt, agentId, depth: run.pendingSteer.length }, { runId: run.id, agentId: "LO" });
      return this.get(id);
    }
    // HTTP 直接续聊注册进 executions（烛 wave2 回炉 R5/R6）：close() 等待、isBusy() 计入——
    // 否则关闭时在途续聊的落盘不被等待、可能被进程 exit 截断。键加前缀避免与
    // startExecution/startSteerDrain 的裸 id 去重键冲突（drain 启动需 has(id) 为空）。
    // controller 建立、状态变更与 executions 注册同 tick 完成（首个 await 前）——close 的
    // active 快照不再有"已进入但未注册"的漏等窗口。
    const controller = new AbortController();
    this.controllers.set(id, controller);
    run.status = "running";
    run.maxRounds = Math.min(this.policy.limits.maxRounds, Math.max(run.maxRounds, run.round + 1));
    const continuation = (async () => {
      let drainStarted = false;
      try {
        await this.save(run);
        // 续聊的用户追问进对话历史（实时+重启后都可见）——否则只有 assistant 回复、看不到问的是什么
        await this.emitEvent(run, "user.message", { text: nextPrompt }, { runId: run.id, agentId: "LO" });
        const text = await this.turn(run, agentId, nextPrompt);
        // abort 与轮完成竞态：cancel 已对用户回执 cancelled，即使轮恰好跑完也不改回 succeeded
        run.status = controller.signal.aborted ? "cancelled" : "succeeded";
        run.result = { ...(run.result || {}), continued: text };
        await this.save(run);
        // 本轮结束后仍有排队追问 → 后台 driver 接管同一 controller 逐轮排干（HTTP 即刻返回，不等排干）
        if ((run.pendingSteer || []).length) {
          this.startSteerDrain(id, controller);
          drainStarted = true;
        }
        return this.get(id);
      } catch (error) {
        run.status = controller.signal.aborted ? "cancelled" : "failed";
        run.error = error.message;
        await this.save(run);
        throw error;
      } finally {
        if (!drainStarted && this.controllers.get(id) === controller) this.controllers.delete(id);
      }
    })();
    const tracked = continuation.finally(() => {
      this.executions.delete(`continue:${id}`);
      this.ensureSteerDrained(id); // 直接续聊的收尾窗兜底（同 startExecution 链）；同步 no-op 不阻塞 HTTP 返回
    });
    this.executions.set(`continue:${id}`, tracked);
    return tracked;
  }

  // 会话元数据（侧栏右键菜单）：白名单字段浅更新——置顶/归档/未读/重命名，全部走 save 持久化
  async updateMeta(id, patch = {}) {
    const run = this.get(id);
    if (patch.pinned !== undefined) run.pinned = Boolean(patch.pinned);
    if (patch.archived !== undefined) run.archived = Boolean(patch.archived);
    if (patch.unread !== undefined) run.unread = Boolean(patch.unread);
    if (patch.title !== undefined) {
      const title = String(patch.title).trim().slice(0, 120);
      if (!title) throw Object.assign(new Error("title cannot be empty"), { code: "VALIDATION_FAILED" });
      run.title = title;
    }
    await this.save(run);
    return this.get(id);
  }

  // 项目级批量归档：cwd 归一匹配的全部终态任务标记 archived（侧栏项目右键"归档任务"）
  async archiveFinishedByCwd(cwd) {
    const target = String(cwd || "").replace(/[\\/]+$/, "").toLowerCase();
    const archived = [];
    for (const run of this.runs.values()) {
      if (!TERMINAL.has(run.status) || run.archived) continue;
      const runCwd = String(run.cwd || "").replace(/[\\/]+$/, "").toLowerCase();
      if (runCwd !== target) continue;
      run.archived = true;
      await this.save(run);
      archived.push(run.id);
    }
    return { archived: archived.length, runIds: archived };
  }

  async cancel(id) {
    const run = this.get(id);
    run.status = "cancelled";
    if (run.buildApproval && run.buildApproval.status !== "denied") run.buildApproval.status = "revoked";
    await this.approvalBroker.denyRun(id);
    this.controllers.get(id)?.abort();
    await this.save(run);
    await this.emitEvent(run, "run.cancelled", { round: run.round }, { runId: id });
    return this.get(id);
  }

  async revokeBuildGrants(reason = "runtime policy changed") {
    for (const run of this.runs.values()) {
      if (run.permissionMode !== "build" || !run.buildApproval || ["revoked", "denied", "expired"].includes(run.buildApproval.status)) continue;
      run.buildApproval.status = "revoked";
      run.recoveryNote = `Build authorization revoked: ${reason}`;
      this.controllers.get(run.id)?.abort();
      await this.approvalBroker.denyRun(run.id, reason);
      await this.save(run);
      await this.emitEvent(run, "run.authorization_revoked", { reason }, { runId: run.id });
    }
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    for (const controller of this.controllers.values()) controller.abort();
    const active = [...this.executions.values()];
    if (active.length) {
      let drainTimer;
      await Promise.race([
        Promise.allSettled(active),
        new Promise((resolveTimeout) => { drainTimer = setTimeout(resolveTimeout, 2_000); }),
      ]);
      clearTimeout(drainTimer);
    }
    const closeErrors = await Promise.all([...new Set(this.adapters.values())].map((adapter) => closeWithin(adapter)));
    for (const error of closeErrors.filter(Boolean)) {
      await this.eventStore.emit("adapter.close_degraded", { message: error.message }, { agentId: "control-plane" }).catch(() => {});
    }
    await Promise.allSettled(active);
    // 关闭前循环收敛全部在途写链（烛 wave2 回炉 P1b）：直接 HTTP continue 的写盘不在 executions
    // 集合内；一次性快照会漏掉等待期间新挂的链（abort/catch 路径仍可 save）。每轮等完快照后
    // 兜底清除"已 settle 但未自清"的条目（save() 的 finally 自清只覆盖它自己建的链），否则
    // size 恒>0 死循环；被新链替换的条目留到下轮继续等。上游 server 先停 HTTP 再调 close，
    // 新链来源有限、循环必然收敛。
    while (this.saveChains.size) {
      const snapshot = [...this.saveChains.entries()];
      await Promise.allSettled(snapshot.map(([, chain]) => chain));
      for (const [runId, chain] of snapshot) {
        if (this.saveChains.get(runId) === chain) this.saveChains.delete(runId);
      }
    }
  }

  isBusy() {
    return this.controllers.size > 0 || this.executions.size > 0;
  }

  async replaceRuntime({ router, adapters, policy }) {
    if (this.isBusy()) throw Object.assign(new Error("active runs prevent an atomic runtime graph swap"), { code: "RUNTIME_BUSY" });
    const previousAdapters = this.adapters;
    this.router = router;
    this.adapters = adapters;
    this.policy = policy;
    const retained = new Set(adapters.values());
    const retired = [...new Set(previousAdapters.values())].filter((adapter) => !retained.has(adapter));
    const results = await Promise.all(retired.map((adapter) => closeWithin(adapter)));
    return results.filter(Boolean).map((error) => error.message || String(error));
  }
}
