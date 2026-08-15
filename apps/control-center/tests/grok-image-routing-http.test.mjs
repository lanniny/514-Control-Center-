import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnTestServer, stopTestServer, waitForUrl } from "./server-fixture.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRepo = resolve(appRoot, "../..");

async function jsonRequest(origin, path, token, body) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function createIsolatedRepo(root) {
  const repoRoot = resolve(root, "repo");
  const configRoot = resolve(repoRoot, "config/control-center");
  const schemaRoot = resolve(repoRoot, "schemas/control-center");
  await Promise.all([mkdir(configRoot, { recursive: true }), mkdir(schemaRoot, { recursive: true })]);
  for (const name of [
    "models.json",
    "routing.json",
    "permissions.json",
    "claude-coordinator.md",
    "claude-headless-settings.json",
  ]) {
    await copyFile(resolve(sourceRepo, "config/control-center", name), resolve(configRoot, name));
  }
  await copyFile(
    resolve(sourceRepo, "schemas/control-center/contracts.schema.json"),
    resolve(schemaRoot, "contracts.schema.json"),
  );

  const modelsPath = resolve(configRoot, "models.json");
  const models = JSON.parse(await readFile(modelsPath, "utf8"));
  for (const profile of models.profiles) {
    // 健康探针只执行 `<command> --version`；统一用当前 Node，避免测试依赖宿主机安装任一付费 CLI。
    if (profile.command) profile.command = process.execPath;
  }
  await Promise.all([
    writeFile(modelsPath, `${JSON.stringify(models, null, 2)}\n`, "utf8"),
    writeFile(resolve(configRoot, "sources.json"), `${JSON.stringify({
      version: 1,
      explicit: [],
      discover: [],
      runtime: [],
    }, null, 2)}\n`, "utf8"),
  ]);
  return repoRoot;
}

function assertPrivateInteractionSourcesHidden(run, privatePaths) {
  assert.equal(Object.hasOwn(run, "activeInteractionSources"), false);
  assert.equal(Object.hasOwn(run, "pendingInteractionSources"), false);
  for (const steer of run.pendingSteer || []) assert.equal(Object.hasOwn(steer, "sources"), false);
  const serialized = JSON.stringify(run);
  for (const privatePath of privatePaths) assert.doesNotMatch(serialized, new RegExp(privatePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

test("PNG direct-send to Grok routes and creates a dry run without spawning a provider", { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-grok-image-route-"));
  const repoRoot = await createIsolatedRepo(root);
  const dataRoot = resolve(root, "data");
  const imagePath = resolve(root, "clipboard-shot.png");
  const secondImagePath = resolve(root, "continued-shot.png");
  const webpPath = resolve(root, "continued-image.webp");
  const videoPath = resolve(root, "continued-video.mp4");
  const token = "grok-image-routing-http-token";
  await Promise.all([
    writeFile(imagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", "base64")),
    writeFile(secondImagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", "base64")),
    writeFile(webpPath, "webp fixture", "utf8"),
    writeFile(videoPath, "video fixture", "utf8"),
  ]);

  const child = spawnTestServer({ env: {
    CONTROL_CENTER_TOKEN: token,
    CONTROL_CENTER_DATA_DIR: dataRoot,
    CONTROL_CENTER_TEST_REPO_ROOT: repoRoot,
    CONTROL_CENTER_PORT: "0",
  } });
  t.after(async () => {
    if (child.exitCode == null && child.signalCode == null) await stopTestServer(child, { token });
    await rm(root, { recursive: true, force: true });
  });
  const origin = new URL(await waitForUrl(child)).origin;
  const body = {
    prompt: "请识别这张截图",
    taskType: "coding",
    sources: [imagePath],
    teamId: "team-514cc",
    startAgentId: "grok-build",
    requestedProvider: "grok-build",
  };

  const preview = await jsonRequest(origin, "/api/router/preview", token, body);
  assert.equal(preview.response.status, 200);
  assert.equal(preview.payload.taskType, "multimodal");
  assert.equal(preview.payload.selected.id, "grok-build");
  assert.equal(preview.payload.selected.runtimeProfileId, "grok-build");
  assert.equal(preview.payload.fallbackUsed, false);

  const conflict = await jsonRequest(origin, "/api/router/preview", token, {
    ...body,
    requestedProvider: "claude-fable",
  });
  assert.equal(conflict.response.status, 422);
  assert.equal(conflict.payload.error.code, "VALIDATION_FAILED");

  const { requestedProvider: _omittedProvider, ...directTargetOnly } = body;
  const created = await jsonRequest(origin, "/api/runs", token, {
    ...directTargetOnly,
    execute: false,
    permissionMode: "plan",
  });
  assert.equal(created.response.status, 202);
  assert.equal(created.payload.taskType, "multimodal");
  assert.equal(created.payload.startAgentId, "grok-build");
  assert.equal(created.payload.executionOwnerId, "grok-build");
  assert.equal(created.payload.route.selected.id, "grok-build");
  assert.equal(created.payload.status, "succeeded");
  assert.equal(created.payload.execute, false);
  assert.equal(created.payload.result.type, "route-preview", "execute:false must not enter any provider adapter");
  assert.deepEqual(created.payload.sources, [{ kind: "file", name: "clipboard-shot.png" }]);
  assertPrivateInteractionSourcesHidden(created.payload, [imagePath]);

  const rejectedAtomicMessage = await jsonRequest(origin, `/api/runs/${created.payload.id}/messages`, token, {
    prompt: "",
    agentId: "grok-build",
    messageIntent: "steer",
    sources: [secondImagePath],
  });
  assert.equal(rejectedAtomicMessage.response.status, 422);
  assert.equal(rejectedAtomicMessage.payload.error.code, "INVALID_PROMPT");
  const afterRejectedMessage = await fetch(`${origin}/api/runs`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(afterRejectedMessage.status, 200);
  const rejectedReadback = (await afterRejectedMessage.json()).runs.find((run) => run.id === created.payload.id);
  assert.deepEqual(rejectedReadback.sources.map((source) => source.name), ["clipboard-shot.png"]);
  assertPrivateInteractionSourcesHidden(rejectedReadback, [imagePath, secondImagePath]);

  const expectedNames = ["clipboard-shot.png"];
  for (const attachmentPath of [webpPath, videoPath]) {
    const accepted = await jsonRequest(origin, `/api/runs/${created.payload.id}/sources`, token, {
      sources: [attachmentPath],
    });
    assert.equal(accepted.response.status, 200);
    expectedNames.push(attachmentPath.endsWith(".webp") ? "continued-image.webp" : "continued-video.mp4");
    const readback = await fetch(`${origin}/api/runs`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(readback.status, 200);
    const persisted = (await readback.json()).runs.find((run) => run.id === created.payload.id);
    assert.deepEqual(
      persisted.sources.map((source) => source.name),
      expectedNames,
      "附件格式不再被能力包络提前拒绝",
    );
    assertPrivateInteractionSourcesHidden(persisted, [imagePath, secondImagePath, attachmentPath]);
  }
});
