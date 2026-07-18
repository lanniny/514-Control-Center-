#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createControlCenter } from "../src/app.mjs";

const outputPath = process.argv[2] ? resolve(process.argv[2]) : null;
const state = await createControlCenter();
const startedAt = new Date().toISOString();

try {
  const run = await state.orchestrator.create({
    prompt: "只读核验 apps/control-center/package.json：确认包名，并列出 test、validate、probe:codex-protocol 三个脚本的精确命令。不要修改任何文件。",
    taskType: "coding",
    risk: "high",
    execute: true,
    collaborationMode: "standard",
    permissionMode: "plan",
    maxRounds: 3,
    maxBudgetUsdPerTurn: 0.5,
  });
  const deadline = Date.now() + 20 * 60_000;
  let completed = run;
  while (!new Set(["succeeded", "failed", "cancelled"]).has(completed.status) && Date.now() < deadline) {
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 1000));
    completed = state.orchestrator.get(run.id);
  }
  const evidence = {
    startedAt,
    completedAt: new Date().toISOString(),
    ok: completed.status === "succeeded" && completed.round === 3,
    runId: completed.id,
    status: completed.status,
    round: completed.round,
    route: completed.route,
    sessions: completed.sessions,
    turns: completed.turns.map((turn) => ({
      round: turn.round,
      agentId: turn.agentId,
      sessionId: turn.sessionId,
      protocol: turn.protocol,
      permissionMode: turn.permissionMode,
      requestedModel: turn.requestedModel,
      effectiveModel: turn.effectiveModel,
      costUsd: turn.costUsd,
      text: turn.text,
    })),
    result: completed.result,
    error: completed.error,
    auditDegraded: Boolean(completed.auditDegraded),
  };
  if (outputPath) await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence.ok) process.exitCode = 1;
} finally {
  await state.close();
  process.exit(process.exitCode || 0);
}
