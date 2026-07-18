import { createControlCenter } from "../src/app.mjs";

const state = await createControlCenter();
try {
  const items = await state.healthService.all({ refresh: true });
  process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), generation: state.generation, items }, null, 2)}\n`);
  if (items.some((item) => item.status === "offline" && ["claude-fable", "codex-technical"].includes(item.id))) process.exitCode = 1;
} finally {
  await state.close();
}
