// cc-switch 迁移波：ProviderStore 单测——CRUD/校验/掩码/三 CLI 投影/备份/current 指针/团队绑定/live 回读
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProviderStore, codexBaseUrl, spliceToml, spliceEnv, claudeEnvProjection, maskConfigSecrets } from "../src/providers.mjs";
import { TeamStore } from "../src/teams.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const syncWaitCell = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

async function fixture(t, storeOptions = {}) {
  const root = await mkdtemp(resolve(appRoot, ".test-providers-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = join(root, "data");
  const runtimeHome = join(root, "home");
  await mkdir(runtimeHome, { recursive: true });
  const store = await new ProviderStore({ dataRoot, runtimeHome, ...storeOptions }).init();
  return { root, dataRoot, runtimeHome, store };
}

const PACKY = {
  name: "PackyCode",
  baseUrl: "https://api.packycode.com",
  apiKey: "sk-packy-1234567890abcdef",
  apps: { claude: true, codex: true, gemini: true },
  models: {
    claude: { model: "claude-sonnet-4-5", haikuModel: "claude-haiku-4-5" },
    codex: { model: "gpt-5-codex", reasoningEffort: "high" },
    gemini: { model: "gemini-2.5-pro" },
  },
  websiteUrl: "https://packycode.com",
  notes: "中转站",
};

test("codexBaseUrl：纯 origin 补 /v1，已带路径/版本不强行补", () => {
  assert.equal(codexBaseUrl("https://api.openai.com"), "https://api.openai.com/v1");
  assert.equal(codexBaseUrl("https://api.openai.com/"), "https://api.openai.com/v1");
  assert.equal(codexBaseUrl("https://api.openai.com/v1"), "https://api.openai.com/v1");
  assert.equal(codexBaseUrl("https://example.com/openai"), "https://example.com/openai");
  assert.equal(codexBaseUrl(""), "");
});

test("create/list：apiKey 永不出服务端（掩码 + hasApiKey），校验闸齐", async (t) => {
  const { store } = await fixture(t);
  const created = await store.create(PACKY);
  assert.equal(created.name, "PackyCode");
  assert.equal(created.hasApiKey, true);
  assert.equal(created.apiKeyMasked, "••••cdef");
  assert.equal(created.apiKey, undefined);

  const list = store.list();
  assert.equal(list.providers.length, 1);
  assert.equal(list.providers[0].apiKey, undefined);
  assert.equal(list.current.claude, null);

  await assert.rejects(() => store.create({ ...PACKY, name: "" }), /name is required/);
  await assert.rejects(() => store.create({ ...PACKY, baseUrl: "ftp://x" }), /http\(s\)/);
  await assert.rejects(() => store.create({ ...PACKY, apps: {} }), /at least one app/);
});

test("ProviderStore: providers.json 提交重试 Windows 瞬时 rename 并清理临时文件", async (t) => {
  let attempts = 0;
  const { dataRoot, store } = await fixture(t, {
    storeRename: async (source, target) => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("temporarily locked"), { code: "EPERM" });
      await rename(source, target);
    },
  });

  await store.create(PACKY);
  assert.equal(attempts, 3);
  assert.equal((await readdir(dataRoot)).some((name) => name.startsWith(".providers.") && name.endsWith(".tmp")), false);
});

test("ProviderStore: 候选图在 providers.json 提交前不可见", async (t) => {
  let notifyRename;
  let releaseRename;
  const renameStarted = new Promise((resolveStarted) => { notifyRename = resolveStarted; });
  const renameGate = new Promise((resolveGate) => { releaseRename = resolveGate; });
  const { store } = await fixture(t, {
    storeRename: async (source, target) => {
      notifyRename();
      await renameGate;
      await rename(source, target);
    },
  });

  const creating = store.create({ ...PACKY, name: "Pending provider" });
  await renameStarted;
  assert.equal(store.list().providers.length, 0, "uncommitted Provider must not leak through list()");
  releaseRename();
  await creating;
  assert.deepEqual(store.list().providers.map((provider) => provider.name), ["Pending provider"]);
});

test("ProviderStore: 永久持久化失败不会遗留或复活 create/update/remove 内存变更", async (t) => {
  let failRename = true;
  const { dataRoot, store } = await fixture(t, {
    storeRename: async (source, target) => {
      if (failRename) throw Object.assign(new Error("persistent storage failure"), { code: "EIO" });
      await rename(source, target);
    },
  });

  await assert.rejects(store.create({ ...PACKY, name: "Rejected provider" }), { code: "EIO" });
  assert.equal(store.list().providers.length, 0);
  assert.equal((await readdir(dataRoot)).some((name) => name.startsWith(".providers.") && name.endsWith(".tmp")), false);

  failRename = false;
  const accepted = await store.create({ ...PACKY, name: "Accepted provider" });
  failRename = true;
  await assert.rejects(store.update(accepted.id, { name: "Rejected update" }), { code: "EIO" });
  assert.equal(store.get(accepted.id).name, "Accepted provider");
  await assert.rejects(store.remove(accepted.id), { code: "EIO" });
  assert.equal(store.get(accepted.id).name, "Accepted provider");

  failRename = false;
  await store.update(accepted.id, { notes: "later successful commit" });
  const disk = JSON.parse(await readFile(join(dataRoot, "providers.json"), "utf8"));
  assert.deepEqual(disk.providers.map((provider) => provider.name), ["Accepted provider"]);
  assert.equal(disk.providers[0].notes, "later successful commit");
});

test("ProviderStore: sort/failover/commonConfig/markProxyCurrent 持久化失败保持候选图不可见", async (t) => {
  let failRename = false;
  const { dataRoot, store } = await fixture(t, {
    storeRename: async (source, target) => {
      if (failRename) throw Object.assign(new Error("persistent storage failure"), { code: "EIO" });
      await rename(source, target);
    },
  });
  const first = await store.create({ ...PACKY, name: "Candidate P1" });
  const second = await store.create({ ...PACKY, name: "Candidate P2" });
  failRename = true;

  const assertRejectedCandidate = async (operation) => {
    const beforeMemory = structuredClone(store.list());
    const beforeDisk = await readFile(join(dataRoot, "providers.json"), "utf8");
    await assert.rejects(operation(), { code: "EIO" });
    assert.deepEqual(store.list(), beforeMemory);
    assert.equal(await readFile(join(dataRoot, "providers.json"), "utf8"), beforeDisk);
  };
  await assertRejectedCandidate(() => store.sort([second.id, first.id]));
  await assertRejectedCandidate(() => store.setFailover("claude", { queue: [second.id], autoFailover: true }));
  await assertRejectedCandidate(() => store.setCommonConfig("claude", JSON.stringify({ attribution: false })));
  await assertRejectedCandidate(() => store.markProxyCurrent("claude", second.id));
});

test("ProviderStore: 慢 remove 越过 deadline 后按已提交处理并补偿全部 live 文件", async (t) => {
  let armed = false;
  let delayed = false;
  let protectedTarget = null;
  let overallDeadline = Infinity;
  const liveRemoveSync = (target, options) => {
    rmSync(target, options);
    if (!armed || delayed || target !== protectedTarget) return;
    delayed = true;
    const waitMs = overallDeadline - Date.now() + 10;
    if (waitMs > 0) Atomics.wait(syncWaitCell, 0, 0, waitMs);
  };
  const { runtimeHome, store } = await fixture(t, { liveRemoveSync });
  const provider = await store.create({
    name: "Claude Desktop official",
    category: "official",
    baseUrl: "",
    apiKey: "",
    apps: { "claude-desktop": true },
    models: { "claude-desktop": { model: "claude-test" } },
  });
  await store.switchTo("claude-desktop", provider.id);
  await store.setProxyTakeover("claude-desktop", true);

  const localAppData = join(runtimeHome, "AppData", "Local");
  const paths = [
    join(localAppData, "Claude", "claude_desktop_config.json"),
    join(localAppData, "Claude-3p", "claude_desktop_config.json"),
    join(localAppData, "Claude-3p", "configLibrary", "00000000-0000-4000-8000-000000157210.json"),
    join(localAppData, "Claude-3p", "configLibrary", "_meta.json"),
  ];
  protectedTarget = paths[2];
  const before = new Map(await Promise.all(paths.map(async (path) => [path, await readFile(path, "utf8")])));
  overallDeadline = Date.now() + 500;
  armed = true;
  let caught = null;
  await assert.rejects(
    store.setProxyTakeover("claude-desktop", false, {
      signal: new AbortController().signal,
      deadline: overallDeadline,
    }),
    (error) => {
      caught = error;
      return error?.code === "PROXY_CLOSE_TIMEOUT";
    },
  );
  armed = false;
  assert.equal(delayed, true);
  assert.equal(caught.rollbackErrors, undefined);
  for (const path of paths) assert.equal(await readFile(path, "utf8"), before.get(path));
  assert.equal(store.proxyRuntime.takeover.has("claude-desktop"), true);
});

test("ProviderStore: switchTo 将 live CLI、current 与 providers.json 作为同一失败可回滚事务", async (t) => {
  const { dataRoot, runtimeHome, store } = await fixture(t);
  const first = await store.create({ ...PACKY, name: "Switch P1" });
  const second = await store.create({
    ...PACKY,
    name: "Switch P2",
    baseUrl: "https://switch-p2.invalid",
    apiKey: "switch-p2-key",
  });
  await store.switchTo("claude", first.id);
  const settingsPath = join(runtimeHome, ".claude", "settings.json");
  const beforeSettings = await readFile(settingsPath, "utf8");
  const beforeStore = await readFile(join(dataRoot, "providers.json"), "utf8");
  let sidecarReached = false;
  store.beforeLiveConfigPublish = ({ target }) => {
    if (target !== store.path) return;
    sidecarReached = true;
    assert.equal(store.current.claude, first.id, "current must remain committed-old until the final sidecar rename");
    throw Object.assign(new Error("injected providers sidecar failure"), { code: "EIO" });
  };

  await assert.rejects(store.switchTo("claude", second.id), { code: "EIO" });
  assert.equal(sidecarReached, true);
  assert.equal(store.current.claude, first.id);
  assert.equal(await readFile(settingsPath, "utf8"), beforeSettings);
  assert.equal(await readFile(join(dataRoot, "providers.json"), "utf8"), beforeStore);
  const tempNames = [
    ...await readdir(dataRoot),
    ...await readdir(join(runtimeHome, ".claude")),
  ];
  assert.equal(tempNames.some((name) => name.startsWith(".514forge") && name.endsWith(".tmp")), false);
});

test("Provider 默认出站投影深层脱敏，明文只由显式 includeSecrets 读取", async (t) => {
  const { store } = await fixture(t);
  const secret = "nested-provider-secret-123456";
  const created = await store.create({
    ...PACKY,
    baseUrl: `https://${secret}@api.example.test/v1`,
    meta: {
      proxyOverrides: {
        headers: { "X-Auth-Token": secret, "X-Api-Keys": secret },
        body: { api_key: secret, credentials: secret, temperature: 0.2 },
      },
      appConfig: {
        opencode: {
          apiKeys: [secret, "${OPENAI_API_KEY}"],
          credentials: [{ value: secret, label: secret }],
        },
      },
    },
  });
  await store.setCommonConfig("claude", JSON.stringify({
    env: { PRIVATE_TOKEN: secret },
    apiKeys: [secret, "${OPENAI_API_KEY}"],
    credentials: [{ value: secret }],
    tokens: 42,
    visible: true,
  }));

  const listed = store.list();
  const maskedExport = store.exportProviders();
  const publicProvider = store.view(created.id);
  for (const [label, payload] of Object.entries({ listed, maskedExport, publicProvider })) {
    assert.equal(JSON.stringify(payload).includes(secret), false, `${label} leaked a nested credential`);
  }
  assert.equal(listed.providers[0].meta.proxyOverrides.headers["x-auth-token"], "[REDACTED]");
  assert.equal(listed.providers[0].meta.proxyOverrides.headers["x-api-keys"], "[REDACTED]");
  assert.equal(listed.providers[0].meta.proxyOverrides.body.api_key, "[REDACTED]");
  assert.equal(listed.providers[0].meta.proxyOverrides.body.credentials, "[REDACTED]");
  assert.equal(listed.providers[0].meta.proxyOverrides.body.temperature, 0.2);
  assert.deepEqual(listed.providers[0].meta.appConfig.opencode.apiKeys, ["[REDACTED]", "${OPENAI_API_KEY}"]);
  assert.deepEqual(listed.providers[0].meta.appConfig.opencode.credentials, [{ value: "[REDACTED]", label: "[REDACTED]" }]);
  const maskedCommon = JSON.parse(listed.commonConfig.claude);
  assert.deepEqual(maskedCommon.apiKeys, ["[REDACTED]", "${OPENAI_API_KEY}"]);
  assert.deepEqual(maskedCommon.credentials, [{ value: "[REDACTED]" }]);
  assert.equal(maskedCommon.tokens, 42);

  const revealedProvider = store.view(created.id, { includeSecrets: true });
  const revealedConfig = store.commonConfigView({ includeSecrets: true });
  const fullExport = store.exportProviders({ includeSecrets: true });
  assert.equal(revealedProvider.meta.proxyOverrides.headers["x-auth-token"], secret);
  assert.equal(revealedProvider.meta.appConfig.opencode.apiKeys[0], secret);
  assert.ok(revealedConfig.commonConfig.claude.includes(secret));
  assert.ok(JSON.stringify(fullExport).includes(secret));
});

test("legacy Provider unknown fields and malformed common config stay secret in every default projection", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-providers-legacy-redaction-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = join(root, "data");
  const runtimeHome = join(root, "home");
  await mkdir(dataRoot, { recursive: true });
  await mkdir(runtimeHome, { recursive: true });
  const secret = "legacy-provider-secret-123456";
  await writeFile(join(dataRoot, "providers.json"), `${JSON.stringify({
    providers: [{
      id: "legacy-provider",
      name: "Legacy",
      apps: { codex: true },
      models: { codex: { model: "gpt-5.6-sol", token: secret } },
      accessToken: secret,
      credentials: [secret],
      meta: {
        oauth: { credentials: [secret] },
        futureToken: secret,
      },
      apiKey: secret,
    }],
    current: { codex: "legacy-provider" },
    commonConfig: {
      claude: `${JSON.stringify({ apiKeys: [secret], visible: true }, null, 2)}\nwarning: legacy footer`,
    },
  }, null, 2)}\n`);
  const store = await new ProviderStore({ dataRoot, runtimeHome }).init();

  for (const [label, payload] of Object.entries({
    list: store.list(),
    view: store.view("legacy-provider"),
    export: store.exportProviders(),
    common: store.commonConfigView(),
  })) {
    assert.equal(JSON.stringify(payload).includes(secret), false, `${label} leaked a legacy credential`);
  }
  assert.ok(JSON.stringify(store.view("legacy-provider", { includeSecrets: true })).includes(secret));
  assert.equal(store.view("legacy-provider").accessToken, undefined);
  assert.equal(store.view("legacy-provider").credentials, undefined);
});

test("Provider models reject unknown fields instead of accepting a credential side channel", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(
    () => store.create({ ...PACKY, models: { ...PACKY.models, codex: { model: "gpt-5.6-sol", token: "hidden-side-secret" } } }),
    /models\.codex has unknown field: token/,
  );
});

test("update：apiKey 留空=保留原值，显式给值才换", async (t) => {
  const { store } = await fixture(t);
  const created = await store.create(PACKY);
  const renamed = await store.update(created.id, { ...PACKY, name: "Packy2", apiKey: "" });
  assert.equal(renamed.name, "Packy2");
  assert.equal(renamed.apiKeyMasked, "••••cdef"); // 原 key 保留
  const rotated = await store.update(created.id, { ...PACKY, apiKey: "sk-new-9999" });
  assert.equal(rotated.apiKeyMasked, "••••9999");
});

test("Provider 引用保护：禁用所需应用、删除、查询异常与歧义结果均 fail-closed", async (t) => {
  let referenceMode = "used";
  const referencesForProvider = async () => {
    if (referenceMode === "throw") throw Object.assign(new Error("catalog unavailable"), { code: "CATALOG_UNAVAILABLE" });
    if (referenceMode === "ambiguous") return null;
    if (referenceMode === "used") return [{ seatId: "seat-codex-a", providerApp: "codex" }];
    return [];
  };
  const { store } = await fixture(t, { referencesForProvider });
  const created = await store.create(PACKY);
  const original = structuredClone(store.list());

  await assert.rejects(
    () => store.update(created.id, { apps: { codex: false } }),
    (error) => error.code === "PROVIDER_IN_USE" && /seat-codex-a/.test(error.message),
  );
  await assert.rejects(
    () => store.remove(created.id),
    (error) => error.code === "PROVIDER_IN_USE" && error.references?.[0]?.seatId === "seat-codex-a",
  );
  assert.deepEqual(store.list(), original, "blocked reference mutations must not change memory state");

  referenceMode = "ambiguous";
  await assert.rejects(() => store.update(created.id, { name: "ambiguous-update" }), { code: "PROVIDER_REFERENCE_CHECK_FAILED" });
  await assert.rejects(() => store.remove(created.id), { code: "PROVIDER_REFERENCE_CHECK_FAILED" });

  referenceMode = "throw";
  await assert.rejects(
    () => store.update(created.id, { name: "failed-update" }),
    (error) => error.code === "PROVIDER_REFERENCE_CHECK_FAILED" && error.causeCode === "CATALOG_UNAVAILABLE",
  );
  await assert.rejects(
    () => store.remove(created.id),
    (error) => error.code === "PROVIDER_REFERENCE_CHECK_FAILED" && error.causeCode === "CATALOG_UNAVAILABLE",
  );
  assert.deepEqual(store.list(), original, "failed reference checks must not change memory state");
});

test("Provider 导入使用候选图：引用冲突、校验失败或写盘失败都保持内存与磁盘不变", async (t) => {
  let failWrites = false;
  let references = [{ seatId: "seat-codex-a", providerApp: "codex" }];
  const { store, dataRoot } = await fixture(t, {
    referencesForProvider: async () => references,
    storeWriteFile: async (...args) => {
      if (failWrites) throw Object.assign(new Error("injected write failure"), { code: "EIO" });
      return writeFile(...args);
    },
  });
  const created = await store.create(PACKY);
  const originalMemory = structuredClone(store.list());
  const originalDisk = await readFile(join(dataRoot, "providers.json"), "utf8");
  const exported = store.exportProviders({ includeSecrets: true });

  await assert.rejects(
    () => store.importProviders({ ...exported, providers: [] }, { mode: "replace" }),
    { code: "PROVIDER_IN_USE" },
  );
  const incompatible = structuredClone(exported);
  incompatible.providers[0].apps.codex = false;
  await assert.rejects(() => store.importProviders(incompatible, { mode: "replace" }), { code: "PROVIDER_IN_USE" });
  await assert.rejects(() => store.importProviders(incompatible, { mode: "merge" }), { code: "PROVIDER_IN_USE" });
  assert.deepEqual(store.list(), originalMemory);
  assert.equal(await readFile(join(dataRoot, "providers.json"), "utf8"), originalDisk);

  references = null;
  await assert.rejects(() => store.importProviders(exported, { mode: "replace" }), { code: "PROVIDER_REFERENCE_CHECK_FAILED" });
  assert.deepEqual(store.list(), originalMemory);
  assert.equal(await readFile(join(dataRoot, "providers.json"), "utf8"), originalDisk);

  references = [];
  const invalid = structuredClone(exported);
  invalid.providers.push({ ...PACKY, id: "provider-invalid", baseUrl: "ftp://invalid" });
  await assert.rejects(() => store.importProviders(invalid, { mode: "merge" }), { code: "VALIDATION_FAILED" });
  assert.deepEqual(store.list(), originalMemory);
  assert.equal(await readFile(join(dataRoot, "providers.json"), "utf8"), originalDisk);

  const renamed = structuredClone(exported);
  renamed.providers[0].name = "should-not-commit";
  failWrites = true;
  await assert.rejects(() => store.importProviders(renamed, { mode: "replace" }), { code: "EIO" });
  assert.equal(store.list().providers.find((provider) => provider.id === created.id)?.name, PACKY.name);
  assert.deepEqual(store.list(), originalMemory, "failed commit must restore the previous in-memory graph");
  assert.equal(await readFile(join(dataRoot, "providers.json"), "utf8"), originalDisk);
});

test("claude 投影：settings.json env 合并——既有键与无关配置一字不动，备份留痕", async (t) => {
  const { store, runtimeHome, dataRoot } = await fixture(t);
  const settingsPath = join(runtimeHome, ".claude", "settings.json");
  await mkdir(join(runtimeHome, ".claude"), { recursive: true });
  await writeFile(settingsPath, JSON.stringify({ model: "opus", env: { KEEP_ME: "1", ANTHROPIC_MODEL: "old" } }, null, 2), "utf8");

  const created = await store.create(PACKY);
  const result = await store.switchTo("claude", created.id);
  assert.equal(result.applied.length, 1);
  assert.equal(result.provider.id, created.id);
  assert.ok(result.applied[0].backup, "切换前必须留时间戳备份");

  const live = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.equal(live.model, "opus"); // 非 env 区不动
  assert.equal(live.env.KEEP_ME, "1"); // 无关 env 不动
  assert.equal(live.env.ANTHROPIC_BASE_URL, "https://api.packycode.com");
  assert.equal(live.env.ANTHROPIC_AUTH_TOKEN, "sk-packy-1234567890abcdef");
  assert.equal(live.env.ANTHROPIC_MODEL, "claude-sonnet-4-5");
  assert.equal(live.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "claude-haiku-4-5");
  assert.equal(live.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "claude-sonnet-4-5"); // 缺省回落主模型
  assert.equal(store.list().current.claude, created.id);

  const backups = await readdir(join(dataRoot, "backups", "providers"));
  assert.equal(backups.filter((name) => name.endsWith("settings.json")).length, 1);
  const backupContent = JSON.parse(await readFile(join(dataRoot, "backups", "providers", backups[0]), "utf8"));
  assert.equal(backupContent.env.ANTHROPIC_MODEL, "old"); // 备份是切换前原样
});

test("claude 投影：无 key 供应商不动现有 AUTH_TOKEN（官方订阅登录场景）", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  const settingsPath = join(runtimeHome, ".claude", "settings.json");
  await mkdir(join(runtimeHome, ".claude"), { recursive: true });
  await writeFile(settingsPath, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "subscription-token" } }), "utf8");
  const official = await store.create({ name: "官方", baseUrl: "", apiKey: "", apps: { claude: true } });
  await store.switchTo("claude", official.id);
  const live = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.equal(live.env.ANTHROPIC_AUTH_TOKEN, "subscription-token"); // 未被清空
  assert.equal(live.env.ANTHROPIC_BASE_URL, undefined);
});

test("claude 投影：live 文件是坏 JSON → INVALID_LIVE_JSON 拒写不 clobber", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  const settingsPath = join(runtimeHome, ".claude", "settings.json");
  await mkdir(join(runtimeHome, ".claude"), { recursive: true });
  await writeFile(settingsPath, "{broken", "utf8");
  const created = await store.create(PACKY);
  await assert.rejects(() => store.switchTo("claude", created.id), (error) => {
    assert.equal(error.code, "INVALID_LIVE_JSON");
    return true;
  });
  assert.equal(await readFile(settingsPath, "utf8"), "{broken"); // 原样未动
});

test("codex 投影：auth.json 合并 + config.toml 标记块外科手术（用户内容保留、重复切换不叠块）", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  await mkdir(join(runtimeHome, ".codex"), { recursive: true });
  const tomlPath = join(runtimeHome, ".codex", "config.toml");
  await writeFile(tomlPath, 'model = "old-model"\napproval_policy = "on-request"\n\n[notice]\nhide_full_access_warning = true\n', "utf8");

  const created = await store.create(PACKY);
  await store.switchTo("codex", created.id);

  const auth = JSON.parse(await readFile(join(runtimeHome, ".codex", "auth.json"), "utf8"));
  assert.equal(auth.OPENAI_API_KEY, "sk-packy-1234567890abcdef");

  let toml = await readFile(tomlPath, "utf8");
  assert.match(toml, /^model = "gpt-5-codex"$/m);
  assert.match(toml, /^model_provider = "forge"$/m);
  assert.match(toml, /^model_reasoning_effort = "high"$/m);
  assert.match(toml, /approval_policy = "on-request"/); // 用户顶层键保留
  assert.match(toml, /\[notice\][\s\S]*hide_full_access_warning = true/); // 用户 section 保留
  assert.match(toml, /\[model_providers\.forge\]\nname = "PackyCode"\nbase_url = "https:\/\/api\.packycode\.com\/v1"\nwire_api = "responses"\nrequires_openai_auth = true/);

  // 二次切换（换一个供应商）：旧标记块摘除不叠加
  const second = await store.create({ ...PACKY, name: "Zeta", baseUrl: "https://zeta.example.com", apiKey: "sk-zeta-1" });
  await store.switchTo("codex", second.id);
  toml = await readFile(tomlPath, "utf8");
  assert.equal((toml.match(/# >>> 514-forge-provider/g) ?? []).length, 1, "标记块永远只有一段");
  assert.match(toml, /base_url = "https:\/\/zeta\.example\.com\/v1"/);
  assert.equal(store.list().current.codex, second.id);
});

test("gemini 投影：.env 标记块，块外行原样保留", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  await mkdir(join(runtimeHome, ".gemini"), { recursive: true });
  const envPath = join(runtimeHome, ".gemini", ".env");
  await writeFile(envPath, "OTHER_FLAG=on\n", "utf8");
  const created = await store.create(PACKY);
  await store.switchTo("gemini", created.id);
  const content = await readFile(envPath, "utf8");
  assert.match(content, /OTHER_FLAG=on/);
  assert.match(content, /# >>> 514-forge-provider[\s\S]*GOOGLE_GEMINI_BASE_URL=https:\/\/api\.packycode\.com[\s\S]*GEMINI_API_KEY=sk-packy-1234567890abcdef[\s\S]*GEMINI_MODEL=gemini-2\.5-pro[\s\S]*# <<< 514-forge-provider/);
});

test("spliceToml/spliceEnv 纯函数：空原文可用、空值摘键回官方", () => {
  const spliced = spliceToml("", { blockId: "p1", topKeys: { model: "m1" }, sectionName: "model_providers.forge", sectionBody: ['base_url = "https://x/v1"'] });
  assert.match(spliced, /^model = "m1"/);
  assert.match(spliced, /\[model_providers\.forge\]/);
  const reverted = spliceToml(spliced, { blockId: "p1", topKeys: { model: "", model_provider: "" }, sectionName: null, sectionBody: [] });
  assert.equal(reverted.includes("514-forge-provider"), false);
  assert.equal(reverted.includes('model = "m1"'), false);
  const env = spliceEnv("A=1\n", "p1", { B: "2" });
  assert.match(env, /A=1\n/);
  assert.match(env, /B=2/);
  // sections 多表形态（kimi：providers + models 双表同块）
  const dual = spliceToml('default_model = "old"\n\n[thinking]\nenabled = true\n', {
    blockId: "p2",
    topKeys: { default_model: "514cc:x/m" },
    sections: [
      { name: 'providers."514cc:x"', body: ['type = "openai"', 'api_key = "k"'] },
      { name: 'models."514cc:x/m"', body: ['provider = "514cc:x"', 'model = "m"'] },
    ],
  });
  assert.match(dual, /^default_model = "514cc:x\/m"$/m);
  assert.match(dual, /\[providers\."514cc:x"\]\ntype = "openai"\napi_key = "k"\n\n\[models\."514cc:x\/m"\]\nprovider = "514cc:x"\nmodel = "m"/);
  assert.match(dual, /\[thinking\]\nenabled = true/);
  // 再拼接：旧块整体摘除不残留
  const dual2 = spliceToml(dual, { blockId: "p3", topKeys: { default_model: "514cc:y/n" }, sections: [{ name: 'providers."514cc:y"', body: ['type = "kimi"'] }] });
  assert.equal(dual2.includes("514cc:x"), false);
  assert.match(dual2, /^default_model = "514cc:y\/n"$/m);
});

test("remove：活跃档案拒删；applyTeamBindings 逐 app 如实回报（含未启用 app 的失败）", async (t) => {
  const { store } = await fixture(t);
  const created = await store.create(PACKY);
  const claudeOnly = await store.create({ name: "C", baseUrl: "https://c.example.com", apiKey: "k1", apps: { claude: true } });
  await store.switchTo("claude", created.id);

  const teamRoot = await mkdtemp(resolve(appRoot, ".test-providers-team-"));
  t.after(() => rm(teamRoot, { recursive: true, force: true }));
  const teams = await new TeamStore({ dataRoot: join(teamRoot, "d"), knownProviders: () => ["claude-fable"] }).init();
  const team = await teams.create({
    name: "绑定测试",
    members: ["claude-fable"],
    providers: { claude: claudeOnly.id, codex: created.id, gemini: created.id },
  });
  assert.deepEqual(team.providers, { claude: claudeOnly.id, codex: created.id, gemini: created.id });

  const report = await store.applyTeamBindings(team);
  assert.equal(report.skipped, false);
  assert.equal(report.applied.length, 3);
  assert.ok(report.applied.every((entry) => entry.ok));
  assert.equal(store.list().current.gemini, created.id);

  // claudeOnly 未启用 codex → 该 app 如实失败，其余不受影响
  const mixed = await teams.create({ name: "半绑", members: ["claude-fable"], providers: { codex: claudeOnly.id } });
  const mixedReport = await store.applyTeamBindings(mixed);
  assert.equal(mixedReport.applied[0].ok, false);
  assert.match(mixedReport.applied[0].error, /not enabled for Codex/);

  await assert.rejects(() => store.remove(created.id), (error) => {
    assert.equal(error.code, "PROVIDER_ACTIVE");
    return true;
  });
  const replacement = await store.create({ ...PACKY, name: "替代档案", apps: { codex: true, gemini: true } });
  await store.switchTo("codex", replacement.id);
  await store.switchTo("gemini", replacement.id);
  await store.remove(created.id);
  assert.equal(store.list().current.gemini, replacement.id);
  const orphan = await teams.create({ name: "失效绑", members: ["claude-fable"], providers: { claude: created.id } });
  const orphanReport = await store.applyTeamBindings(orphan);
  assert.equal(orphanReport.applied[0].code, "SOURCE_NOT_FOUND");
});

test("teams providers 校验：键白名单严格（拼写错即拒），非对象拒", async (t) => {
  const teamRoot = await mkdtemp(resolve(appRoot, ".test-providers-tv-"));
  t.after(() => rm(teamRoot, { recursive: true, force: true }));
  const teams = await new TeamStore({ dataRoot: join(teamRoot, "d"), knownProviders: () => ["claude-fable"] }).init();
  await assert.rejects(
    () => teams.create({ name: "x", members: ["claude-fable"], providers: { claud: "p1" } }),
    /must be one of claude\/claude-desktop\/codex\/gemini\/grokbuild\/kimi\/opencode\/openclaw\/hermes/,
  );
  await assert.rejects(() => teams.create({ name: "x", members: ["claude-fable"], providers: ["claude"] }), /must be an object/);
  const ok = await teams.create({ name: "x", members: ["claude-fable"], providers: { claude: " p1 ", codex: "" } });
  assert.deepEqual(ok.providers, { claude: "p1" }); // 空值摘除 + trim
});

test("liveStatus：外部手改 live 配置也能按 baseUrl 认亲，不唯 current 指针", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  const created = await store.create(PACKY);
  // 模拟外部工具写入（未经 switchTo）
  await mkdir(join(runtimeHome, ".claude"), { recursive: true });
  await writeFile(join(runtimeHome, ".claude", "settings.json"), JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://api.packycode.com", ANTHROPIC_MODEL: "claude-sonnet-4-5" } }), "utf8");
  const live = await store.liveStatus();
  assert.equal(live.claude.baseUrl, "https://api.packycode.com");
  assert.equal(live.claude.matchedProviderId, created.id); // 认亲成功
  assert.equal(live.codex.matchedProviderId, null);
});

test("claudeEnvProjection：models 缺省时主模型回落三档", () => {
  const env = claudeEnvProjection({ baseUrl: "https://x", apiKey: "k", models: { claude: { model: "main" } } });
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, "main");
  assert.equal(claudeEnvProjection({ baseUrl: "", apiKey: "", models: {} }).ANTHROPIC_MODEL, undefined);
});

test("claudeEnvProjection：模型映射——Fable/Subagent/显示名/[1m] 后缀", () => {
  const env = claudeEnvProjection({
    baseUrl: "https://x",
    apiKey: "k",
    models: {
      claude: {
        model: "glm-5.2",
        model1m: "1",
        sonnetModel: "glm-5.2-turbo",
        sonnetModelName: "GLM 5.2 Turbo",
        sonnetModel1m: "1",
        haikuModelName: "GLM Air",
        subagentModel: "glm-5.2-air",
      },
    },
  });
  assert.equal(env.ANTHROPIC_MODEL, "glm-5.2[1m]"); // 默认兜底的 1M 声明 → [1m] 后缀
  assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, "glm-5.2-turbo[1m]"); // 角色行独立生效
  assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME, "GLM 5.2 Turbo");
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "glm-5.2"); // 回落主模型、不带后缀（本行未声明 1M）
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME, "GLM Air"); // 显示名独立于实际模型
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, "glm-5.2");
  assert.equal(env.ANTHROPIC_DEFAULT_FABLE_MODEL, "glm-5.2"); // Fable 同律回落主模型
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME, undefined); // 未设置显示名不写
  assert.equal(env.ANTHROPIC_DEFAULT_SUBAGENT_MODEL, "glm-5.2-air"); // Subagent 显式才写
  assert.equal(env.ANTHROPIC_DEFAULT_SUBAGENT_MODEL_NAME, undefined); // Subagent 无显示名位

  // Subagent 不回落主模型；[1m] 不重复叠加
  const bare = claudeEnvProjection({ baseUrl: "", apiKey: "", models: { claude: { model: "m[1m]", model1m: "1" } } });
  assert.equal(bare.ANTHROPIC_MODEL, "m[1m]");
  assert.equal(bare.ANTHROPIC_DEFAULT_SUBAGENT_MODEL, undefined);
});

test("proxyOverrides：校验闸、保留头拒收、分区整体替换与清空", async (t) => {
  const { store } = await fixture(t);
  const created = await store.create({
    ...PACKY,
    meta: {
      proxyOverrides: {
        userAgent: "Mozilla/5.0 cc-test",
        headers: { "X-Provider": "cc-switch" },
        body: { temperature: 0.2, stream: false, junk: null },
      },
    },
  });
  assert.deepEqual(created.meta.proxyOverrides, {
    userAgent: "Mozilla/5.0 cc-test",
    headers: { "x-provider": "cc-switch" }, // 落库统一小写
    body: { temperature: 0.2, stream: false, junk: null },
  });
  await assert.rejects(
    () => store.create({ ...PACKY, meta: { proxyOverrides: { headers: { authorization: "Bearer x" } } } }),
    /reserved/, // 认证/协议头禁覆
  );
  await assert.rejects(
    () => store.create({ ...PACKY, meta: { proxyOverrides: { body: { messages: [] } } } }),
    /scalar/, // Body 值限标量
  );
  await assert.rejects(
    () => store.create({ ...PACKY, meta: { proxyOverrides: { userAgent: "a\nb" } } } ),
    /single line/, // UA 单行（防头注入）
  );
  // 分区整体替换语义：未提交的分区字段不保留
  const updated = await store.update(created.id, { meta: { proxyOverrides: { userAgent: "UA-2" } } });
  assert.deepEqual(updated.meta.proxyOverrides, { userAgent: "UA-2" });
  // 显式 null / 全空对象 = 清空
  const cleared = await store.update(created.id, { meta: { proxyOverrides: null } });
  assert.equal(cleared.meta?.proxyOverrides, undefined);
  const clearedEmpty = await store.update(created.id, { meta: { proxyOverrides: { userAgent: "", headers: {}, body: {} } } });
  assert.equal(clearedEmpty.meta?.proxyOverrides, undefined);
});

// ── cc-switch 配置方式对齐波（第三波）：预设目录字段 + common env 三层合并 ──

test("extraEnv：预设固定 env 铺底、投影键优先；非法键拒收", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  const created = await store.create({
    ...PACKY,
    meta: { extraEnv: { claude: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: "262144", ANTHROPIC_MODEL: "should-lose" } } },
  });
  await store.switchTo("claude", created.id);
  const settings = JSON.parse(await readFile(join(runtimeHome, ".claude", "settings.json"), "utf8"));
  assert.equal(settings.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, "262144"); // extra 键落盘
  assert.equal(settings.env.ANTHROPIC_MODEL, "claude-sonnet-4-5"); // 投影键优先于同名 extra 键
  await assert.rejects(
    () => store.create({ ...PACKY, meta: { extraEnv: { claude: { "lower-case": "x" } } } }),
    /UPPER_SNAKE/,
  );
});

test("extraSettings：预设 settings.json 顶层片段并入；forbidden 键拒收", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  const created = await store.create({
    ...PACKY,
    meta: { extraSettings: { includeCoAuthoredBy: false, effortLevel: "high" } },
  });
  await store.switchTo("claude", created.id);
  const settings = JSON.parse(await readFile(join(runtimeHome, ".claude", "settings.json"), "utf8"));
  assert.equal(settings.includeCoAuthoredBy, false);
  assert.equal(settings.effortLevel, "high");
  await assert.rejects(
    () => store.create({ ...PACKY, meta: { extraSettings: { env: { X: "1" } } } }),
    /not allowed/,
  );
});

test("codexTop/codexProviderExtra：raw RHS 落 TOML、切走即摘除；白名单外键拒收", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  const azure = await store.create({
    name: "Azure", baseUrl: "https://res.openai.azure.com/openai", apiKey: "sk-az",
    apps: { codex: true }, models: { codex: { model: "gpt-5.5", reasoningEffort: "high" } },
    meta: {
      apiFormat: "openai_chat",
      codexTop: { disable_response_storage: "true", review_model: '"gpt-5.5"' },
      codexProviderExtra: { env_key: '"OPENAI_API_KEY"', query_params: '{ "api-version" = "2025-04-01-preview" }' },
    },
  });
  await store.switchTo("codex", azure.id);
  let toml = await readFile(join(runtimeHome, ".codex", "config.toml"), "utf8");
  assert.match(toml, /^review_model = "gpt-5\.5"$/m); // raw RHS 保留引号
  assert.match(toml, /^disable_response_storage = true$/m); // 布尔不加引号
  assert.match(toml, /^wire_api = "chat"$/m); // apiFormat openai_chat → chat
  assert.match(toml, /^env_key = "OPENAI_API_KEY"$/m);
  assert.match(toml, /^query_params = \{ "api-version" = "2025-04-01-preview" \}$/m);

  // 切到无 extra 的供应商：顶层附加键必须摘除（不残留）
  const plain = await store.create({ name: "Plain", apps: { codex: true }, models: { codex: { model: "gpt-5.5" } } });
  await store.switchTo("codex", plain.id);
  toml = await readFile(join(runtimeHome, ".codex", "config.toml"), "utf8");
  assert.equal(toml.includes("review_model"), false);
  assert.equal(toml.includes("disable_response_storage"), false);
  assert.equal(toml.includes("env_key"), false);

  await assert.rejects(
    () => store.create({ ...PACKY, meta: { codexTop: { arbitrary_key: "1" } } }),
    /not allowed/,
  );
  await assert.rejects(
    () => store.create({ ...PACKY, meta: { apiFormat: "xml" } }),
    /apiFormat/,
  );
});

test("common env 三层合并：五开关场景（attribution 顶层 + env 四键）全进 settings.json", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  await store.setCommonConfig("claude", JSON.stringify({
    attribution: { commit: "", pr: "" },
    env: {
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      ENABLE_TOOL_SEARCH: "true",
      CLAUDE_CODE_EFFORT_LEVEL: "max",
      DISABLE_AUTOUPDATER: "1",
      ANTHROPIC_MODEL: "common-should-lose",
    },
  }));
  const created = await store.create(PACKY);
  await store.switchTo("claude", created.id);
  const settings = JSON.parse(await readFile(join(runtimeHome, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(settings.attribution, { commit: "", pr: "" }); // 顶层键并入
  assert.equal(settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, "1"); // common env 不再被跳过
  assert.equal(settings.env.ENABLE_TOOL_SEARCH, "true");
  assert.equal(settings.env.CLAUDE_CODE_EFFORT_LEVEL, "max");
  assert.equal(settings.env.DISABLE_AUTOUPDATER, "1");
  assert.equal(settings.env.ANTHROPIC_MODEL, "claude-sonnet-4-5"); // provider 投影盖 common env
});

test("modelCatalog：预设模型目录校验与保留", async (t) => {
  const { store } = await fixture(t);
  const created = await store.create({
    ...PACKY,
    meta: { modelCatalog: [{ model: "kimi-k2.7-code", displayName: "Kimi K2.7 Code", contextWindow: 262144 }, { displayName: "no-model" }] },
  });
  const listed = store.list().providers.find((p) => p.id === created.id);
  assert.equal(listed.meta.modelCatalog.length, 1); // 无 model 的条目被滤
  assert.equal(listed.meta.modelCatalog[0].contextWindow, 262144);
});

test("provider-presets.json：cc-switch 3.18 八应用目录、来源哈希与关键预设", async () => {
  const catalog = JSON.parse(await readFile(join(appRoot, "src", "data", "provider-presets.json"), "utf8"));
  assert.equal(catalog.version, 2);
  assert.ok(catalog.claude.length >= 60, `claude 预设数异常: ${catalog.claude.length}`);
  assert.ok(catalog.codex.length >= 50, `codex 预设数异常: ${catalog.codex.length}`);
  assert.ok(catalog.gemini.length >= 15, `gemini 预设数异常: ${catalog.gemini.length}`);
  assert.equal(catalog["claude-desktop"].length, 69);
  assert.equal(catalog.grokbuild.length, 39);
  assert.equal(catalog.kimi.length, 3);
  assert.equal(catalog.opencode.length, 60);
  assert.equal(catalog.openclaw.length, 60);
  assert.equal(catalog.hermes.length, 61);
  for (const app of ["claude", "codex", "gemini", "claude-desktop", "grokbuild", "opencode", "openclaw", "hermes"]) {
    assert.match(catalog.sourceFiles[app].sha256, /^[0-9a-f]{64}$/);
  }

  // kimi 手写段（514cc 维护，非 cc-switch 转换——sourceFiles 如实标注无 sha）
  const kimiCoding = catalog.kimi.find((p) => p.name === "Kimi For Coding");
  assert.equal(kimiCoding.baseUrl, "https://api.kimi.com/coding/v1");
  assert.equal(kimiCoding.appConfig.providerType, "kimi");
  const kimiDs = catalog.kimi.find((p) => p.name === "DeepSeek");
  assert.equal(kimiDs.appConfig.providerType, "openai");
  for (const p of catalog.kimi) assert.ok(p.name, "kimi preset missing name");

  const kimi = catalog.claude.find((p) => p.name === "Kimi For Coding");
  assert.equal(kimi.baseUrl, "https://api.kimi.com/coding");
  assert.equal(kimi.extraEnv.CLAUDE_CODE_MAX_CONTEXT_TOKENS, "262144");

  const packy = catalog.claude.find((p) => p.name === "PackyCode");
  assert.equal(packy.baseUrl, "https://www.packyapi.com");
  assert.ok(packy.endpointCandidates.length >= 1);

  const deepseek = catalog.codex.find((p) => p.name === "DeepSeek");
  assert.equal(deepseek.baseUrl, "https://api.deepseek.com");
  assert.equal(deepseek.codexTop.disable_response_storage, "true");

  const azure = catalog.codex.find((p) => p.name === "Azure OpenAI");
  assert.equal(azure.codexProviderExtra.env_key, '"OPENAI_API_KEY"');

  const eflow = catalog.claude.find((p) => p.name === "E-FlowCode");
  assert.equal(eflow.extraSettings.effortLevel, "high");

  // 全量不变量：每条预设必有 name；codexTop/codexProviderExtra 键不越白名单
  for (const p of [...catalog.claude, ...catalog.codex, ...catalog.gemini]) assert.ok(p.name, "preset missing name");
  for (const p of catalog.codex) {
    for (const key of Object.keys(p.codexTop ?? {})) assert.ok(["review_model", "disable_response_storage", "model_verbosity", "personality"].includes(key), `codexTop 越界键: ${key}`);
    for (const key of Object.keys(p.codexProviderExtra ?? {})) assert.ok(["env_key", "query_params", "model_context_window", "model_auto_compact_token_limit"].includes(key), `codexProviderExtra 越界键: ${key}`);
  }
});

test("limit 显式 null = 清除而非 NaN 422（前端空字段提交 null 的回归闸）", async (t) => {
  const { store } = await fixture(t);
  const created = await store.create({ ...PACKY, meta: { limitDailyUsd: null, limitMonthlyUsd: null } });
  assert.equal(created.meta?.limitDailyUsd, undefined);
  const withLimit = await store.update(created.id, { meta: { limitDailyUsd: 5 } });
  assert.equal(withLimit.meta.limitDailyUsd, 5);
  const cleared = await store.update(created.id, { meta: { limitDailyUsd: null } });
  assert.equal(cleared.meta.limitDailyUsd, undefined);
});

test("ProviderStore: 损坏或不可读的 providers.json 冻结写入且保留原字节", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-providers-corrupt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = join(root, "data");
  await mkdir(dataRoot, { recursive: true });
  const path = join(dataRoot, "providers.json");
  const corrupt = "{ definitely-not-json";
  await writeFile(path, corrupt, "utf8");

  const store = await new ProviderStore({ dataRoot, runtimeHome: join(root, "home") }).init();
  assert.equal(store.list().storeStatus.state, "blocked");
  await assert.rejects(() => store.create(PACKY), { code: "PROVIDER_STORE_UNREADABLE" });
  assert.equal(await readFile(path, "utf8"), corrupt);

  const injected = await new ProviderStore({
    dataRoot: join(root, "unreadable"),
    runtimeHome: join(root, "home-2"),
    storeReadFile: async () => { throw Object.assign(new Error("access denied"), { code: "EACCES" }); },
  }).init();
  assert.equal(injected.list().storeStatus.code, "PROVIDER_STORE_UNREADABLE");
  await assert.rejects(() => injected.create(PACKY), { code: "PROVIDER_STORE_UNREADABLE" });
});

test("九应用 writer：六类专用 live 配置隔离落盘并可回读认亲", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  const created = await store.create({
    name: "Eight Apps",
    baseUrl: "https://gateway.example.com/v1",
    apiKey: "sk-eight-apps",
    apps: {
      "claude-desktop": true,
      grokbuild: true,
      kimi: true,
      opencode: true,
      openclaw: true,
      hermes: true,
    },
    models: {
      "claude-desktop": { model: "claude-sonnet-5" },
      grokbuild: { model: "grok-4.5" },
      kimi: { model: "model-a" },
      opencode: { model: "model-a" },
      openclaw: { model: "model-a" },
      hermes: { model: "model-a" },
    },
    meta: {
      appConfig: {
        "claude-desktop": {
          mode: "direct",
          modelRoutes: [{ routeId: "claude-sonnet-5", upstreamModel: "claude-sonnet-5", supports1m: true }],
        },
        grokbuild: { profile: "eight", apiBackend: "responses", contextWindow: 500000 },
        kimi: { providerType: "openai", maxContextSize: 131072, capabilities: ["tool_use"] },
        opencode: {
          providerKey: "eight",
          settingsConfig: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "", apiKey: "" }, models: { "model-a": { name: "Model A" } } },
        },
        openclaw: {
          providerKey: "eight",
          settingsConfig: { baseUrl: "", apiKey: "", api: "openai-completions", models: [{ id: "model-a", name: "Model A" }] },
          suggestedDefaults: { model: { primary: "eight/model-a" } },
        },
        hermes: {
          providerKey: "eight",
          settingsConfig: { name: "eight", base_url: "", api_key: "", api_mode: "chat_completions", models: [{ id: "model-a", name: "Model A" }] },
          suggestedDefaults: { model: { default: "model-a", provider: "eight" } },
        },
      },
    },
  });

  for (const app of ["claude-desktop", "grokbuild", "kimi", "opencode", "openclaw", "hermes"]) {
    const result = await store.switchTo(app, created.id);
    assert.equal(result.app, app);
    assert.ok(result.applied.length >= 1);
  }

  const desktopProfile = JSON.parse(await readFile(join(runtimeHome, "AppData", "Local", "Claude-3p", "configLibrary", "00000000-0000-4000-8000-000000157210.json"), "utf8"));
  assert.equal(desktopProfile.inferenceGatewayBaseUrl, "https://gateway.example.com/v1");
  assert.equal(desktopProfile.inferenceGatewayApiKey, "sk-eight-apps");
  assert.equal(desktopProfile.inferenceModels[0].name, "claude-sonnet-5");

  const grok = await readFile(join(runtimeHome, ".grok", "config.toml"), "utf8");
  assert.match(grok, /# >>> 514-forge-grokbuild-provider/);
  assert.match(grok, /base_url = "https:\/\/gateway\.example\.com\/v1"/);
  assert.match(grok, /api_key = "sk-eight-apps"/);

  const kimiToml = await readFile(join(runtimeHome, ".kimi-code", "config.toml"), "utf8");
  assert.match(kimiToml, /# >>> 514-forge-provider \(/);
  assert.match(kimiToml, /default_model = "514cc:eight-apps\/model-a"/);
  assert.match(kimiToml, /\[providers\."514cc:eight-apps"\]/);
  assert.match(kimiToml, /\[models\."514cc:eight-apps\/model-a"\]/);
  assert.match(kimiToml, /max_context_size = 131072/);
  assert.match(kimiToml, /capabilities = \["tool_use"\]/);

  const opencode = JSON.parse(await readFile(join(runtimeHome, ".config", "opencode", "opencode.json"), "utf8"));
  assert.equal(opencode.provider.eight.options.apiKey, "sk-eight-apps");
  assert.equal(opencode.provider.eight.options.baseURL, "https://gateway.example.com/v1");

  const openclaw = JSON.parse(await readFile(join(runtimeHome, ".openclaw", "openclaw.json"), "utf8"));
  assert.equal(openclaw.models.providers.eight.apiKey, "sk-eight-apps");
  assert.equal(openclaw.agents.defaults.model.primary, "eight/model-a");

  const hermesText = await readFile(join(runtimeHome, ".hermes", "config.yaml"), "utf8");
  assert.match(hermesText, /name: eight/);
  assert.match(hermesText, /api_key: sk-eight-apps/);
  assert.match(hermesText, /provider: eight/);

  await assert.rejects(readFile(join(runtimeHome, ".gemini", ".env"), "utf8"), /ENOENT/);
  const live = await store.liveStatus();
  for (const app of ["claude-desktop", "grokbuild", "kimi", "opencode", "openclaw", "hermes"]) {
    assert.equal(live[app].matchedProviderId, created.id, `${app} live 未认亲`);
  }
  assert.deepEqual(Object.keys(store.list().failoverQueue), ["claude", "claude-desktop", "codex", "gemini", "grokbuild", "kimi", "opencode", "openclaw", "hermes"]);
});

test("kimi writer：default_model 顶层键 + providers/models 双表标记块；用户既有配置不动、切换整块摘换", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  // 预置用户自有配置（managed 登录态 + thinking 段）——投影一律不碰
  await mkdir(join(runtimeHome, ".kimi-code"), { recursive: true });
  const kimiConfigPath = join(runtimeHome, ".kimi-code", "config.toml");
  await writeFile(kimiConfigPath, [
    'default_model = "kimi-code/k3"',
    "",
    "[thinking]",
    "enabled = true",
    'effort = "high"',
    "",
    '[providers."managed:kimi-code"]',
    'type = "kimi"',
    'base_url = "https://api.kimi.com/coding/v1"',
    'api_key = "user-own-key"',
    "",
    '[models."kimi-code/k3"]',
    'provider = "managed:kimi-code"',
    'model = "k3"',
    "max_context_size = 1048576",
    "",
  ].join("\n"));

  const first = await store.create({
    name: "Kimi 聚合 A",
    baseUrl: "https://router-a.example.com/v1",
    apiKey: "sk-router-a",
    apps: { kimi: true },
    models: { kimi: { model: "kimi-k2.7-code" } },
  });
  await store.switchTo("kimi", first.id);
  let text = await readFile(kimiConfigPath, "utf8");
  // 用户区原样保留
  assert.ok(text.includes('[providers."managed:kimi-code"]'));
  assert.ok(text.includes('api_key = "user-own-key"'));
  assert.ok(text.includes("[thinking]"));
  // default_model 改指 514 别名；标记块内双表齐（type 缺省 openai、缺省 capabilities 带 tool_use）
  assert.match(text, /^default_model = "514cc:kimi-a\/kimi-k2\.7-code"$/m);
  assert.match(text, /\[providers\."514cc:kimi-a"\]\ntype = "openai"\nbase_url = "https:\/\/router-a\.example\.com\/v1"\napi_key = "sk-router-a"/);
  assert.match(text, /\[models\."514cc:kimi-a\/kimi-k2\.7-code"\]\nprovider = "514cc:kimi-a"\nmodel = "kimi-k2\.7-code"\nmax_context_size = 262144\ncapabilities = \["thinking", "image_in", "tool_use"\]/);
  const live = await store.liveStatus();
  assert.equal(live.kimi.matchedProviderId, first.id);
  assert.equal(live.kimi.baseUrl, "https://router-a.example.com/v1");
  assert.equal(live.kimi.model, "514cc:kimi-a/kimi-k2.7-code");

  // 切换第二家：旧块整体摘除零残留，default_model 跟到新别名，appConfig 档位落盘
  const second = await store.create({
    name: "Kimi 聚合 B",
    baseUrl: "https://router-b.example.com",
    apiKey: "sk-router-b",
    apps: { kimi: true },
    models: { kimi: { model: "deepseek-v4-pro" } },
    meta: { appConfig: { kimi: { providerType: "openai", supportEfforts: ["low", "high"], defaultEffort: "low" } } },
  });
  await store.switchTo("kimi", second.id);
  text = await readFile(kimiConfigPath, "utf8");
  assert.ok(!text.includes("router-a"), "旧供应商块残留");
  assert.ok(!text.includes("sk-router-a"), "旧密钥残留");
  assert.match(text, /^default_model = "514cc:kimi-b\/deepseek-v4-pro"$/m);
  assert.match(text, /support_efforts = \["low", "high"\]/);
  assert.match(text, /default_effort = "low"/);
  assert.ok(text.includes('[providers."managed:kimi-code"]'), "用户自有 provider 被误伤");
});

test("kimi liveStatus：514 块缺席时认出 managed:kimi-code 官方登录态，切换态退让", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  await mkdir(join(runtimeHome, ".kimi-code"), { recursive: true });
  const kimiConfigPath = join(runtimeHome, ".kimi-code", "config.toml");
  // OAuth 官方登录态（LO 真实形态）：oauth 子表 + 空 api_key
  await writeFile(kimiConfigPath, [
    'default_model = "kimi-code/k3"',
    "",
    '[providers."managed:kimi-code"]',
    'type = "kimi"',
    'base_url = "https://api.kimi.com/coding/v1"',
    'api_key = ""',
    "",
    '[providers."managed:kimi-code".oauth]',
    'storage = "file"',
    'key = "oauth/kimi-code"',
    "",
    '[models."kimi-code/k3"]',
    'provider = "managed:kimi-code"',
    'model = "k3"',
    "",
  ].join("\n"), "utf8");
  const live = await store.liveStatus();
  assert.equal(live.kimi.official, true);
  assert.equal(live.kimi.baseUrl, "https://api.kimi.com/coding/v1");
  assert.equal(live.kimi.model, "kimi-code/k3");
  assert.equal(live.kimi.matchedProviderId, null); // 档案库无同端点档案

  // 档案库存在同端点官方档案时端点认亲（凭据仍由 CLI 托管，不回落）
  const archived = await store.create({
    name: "Kimi 官方",
    baseUrl: "https://api.kimi.com/coding/v1",
    apiKey: "",
    apps: { kimi: true },
    category: "official",
  });
  const live2 = await store.liveStatus();
  assert.equal(live2.kimi.official, true);
  assert.equal(live2.kimi.matchedProviderId, archived.id);

  // managed 表位于文件尾（无后续表头）且仅靠官方端点判定（无 oauth 子表）同样识别
  await writeFile(kimiConfigPath, [
    'default_model = "kimi-code/k3"',
    "",
    '[providers."managed:kimi-code"]',
    'type = "kimi"',
    'base_url = "https://api.kimi.com/coding/v1"',
    'api_key = ""',
    "",
  ].join("\n"), "utf8");
  const live3 = await store.liveStatus();
  assert.equal(live3.kimi.official, true);
  assert.equal(live3.kimi.baseUrl, "https://api.kimi.com/coding/v1");

  // 第三方网关冒充 managed 块：非官方域名、无 oauth → 不报 official、不认亲
  await writeFile(kimiConfigPath, [
    'default_model = "kimi-code/k3"',
    "",
    '[providers."managed:kimi-code"]',
    'type = "kimi"',
    'base_url = "https://router-evil.example.com/v1"',
    'api_key = "sk-evil"',
    "",
  ].join("\n"), "utf8");
  const live4 = await store.liveStatus();
  assert.equal(live4.kimi.official, undefined);
  assert.equal(live4.kimi.baseUrl, null);

  // 514 管理块在场时 official 退让：live 真源回到 514 切换态
  const router = await store.create({
    name: "Kimi 路由",
    baseUrl: "https://router-x.example.com/v1",
    apiKey: "sk-router-x",
    apps: { kimi: true },
    models: { kimi: { model: "kimi-k2" } },
  });
  await store.switchTo("kimi", router.id);
  const live5 = await store.liveStatus();
  assert.equal(live5.kimi.official, undefined);
  assert.equal(live5.kimi.baseUrl, "https://router-x.example.com/v1");
  assert.equal(live5.kimi.matchedProviderId, router.id);
});

test("kimi writer：apiFormat 映射 provider type、模型缺失拒写、preview 干跑不落盘、env 冲突监视", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  const geminiNative = await store.create({
    name: "Gemini Native",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "sk-g",
    apps: { kimi: true },
    models: { kimi: { model: "gemini-3.5-flash" } },
    meta: { apiFormat: "gemini_native" },
  });
  // preview 干跑：只回显不落盘
  const preview = await store.previewSwitch("kimi", { id: geminiNative.id });
  const previewFile = preview.files.find((file) => file.path.includes("config.toml"));
  assert.ok(previewFile, "preview 未产出 kimi config.toml");
  assert.match(previewFile.content, /type = "google-genai"/);
  await assert.rejects(readFile(join(runtimeHome, ".kimi-code", "config.toml"), "utf8"), /ENOENT/);
  // 真写后 type 落盘
  await store.switchTo("kimi", geminiNative.id);
  const text = await readFile(join(runtimeHome, ".kimi-code", "config.toml"), "utf8");
  assert.match(text, /type = "google-genai"/);
  // 模型缺失：拒写且不动 current 指针
  const noModel = await store.create({
    name: "No Model",
    baseUrl: "https://x.example.com",
    apiKey: "sk-x",
    apps: { kimi: true },
    models: { kimi: { model: "" } },
  });
  await assert.rejects(() => store.switchTo("kimi", noModel.id), /默认模型/);
  assert.equal(store.list().current.kimi, geminiNative.id);
  // envConflicts：KIMI_MODEL_* 家族（会压过 default_model 投影）纳入监视
  process.env.KIMI_MODEL_NAME = "conflict-probe";
  try {
    const conflicts = store.envConflicts().conflicts;
    assert.ok(conflicts.some((entry) => entry.app === "kimi" && entry.key === "KIMI_MODEL_NAME"));
  } finally {
    delete process.env.KIMI_MODEL_NAME;
  }
});

test("opencode：缺省补 npm 适配器与模型表、顶层 model 指针落盘；空 Base URL 拒写", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  const configPath = join(runtimeHome, ".config", "opencode", "opencode.json");
  // 裸档案（无 appConfig）：npm/models/顶层 model 指针全部缺省合成——CLI 启后即走新供应商
  const bare = await store.create({
    name: "TokenRelay",
    baseUrl: "https://tokenrhythm.studio/v1",
    apiKey: "sk_tr_test",
    apps: { opencode: true },
    models: { opencode: { model: "deepseek-v4-flash" } },
  });
  await store.switchTo("opencode", bare.id);
  const written = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(written.provider.tokenrelay.npm, "@ai-sdk/openai-compatible"); // 缺省适配器
  assert.equal(written.provider.tokenrelay.options.baseURL, "https://tokenrhythm.studio/v1");
  assert.equal(written.provider.tokenrelay.options.apiKey, "sk_tr_test");
  assert.deepEqual(written.provider.tokenrelay.models, { "deepseek-v4-flash": { name: "deepseek-v4-flash" } }); // 模型表合成
  assert.equal(written.model, "tokenrelay/deepseek-v4-flash"); // 顶层 model 指针——「启用了但没生效」的命门

  // apiFormat=anthropic → anthropic 适配器；不同档案共存于同一 provider 表
  const anth = await store.create({
    name: "AnthRelay",
    baseUrl: "https://anth.example.com",
    apiKey: "sk-anth",
    apps: { opencode: true },
    models: { opencode: { model: "claude-x" } },
    meta: { apiFormat: "anthropic" },
  });
  await store.switchTo("opencode", anth.id);
  const written2 = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(written2.provider.anthrelay.npm, "@ai-sdk/anthropic");
  assert.equal(written2.model, "anthrelay/claude-x");
  assert.equal(written2.provider.tokenrelay.npm, "@ai-sdk/openai-compatible"); // 既有条目不动

  // 无模型档案：不触碰既有顶层 model
  const noModel = await store.create({ name: "NoModel", baseUrl: "https://x.example.com", apiKey: "sk-x", apps: { opencode: true } });
  await store.switchTo("opencode", noModel.id);
  const written3 = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(written3.model, "anthrelay/claude-x");

  // 空 Base URL：启用即报错，不再静默写出 CLI 不可用的配置
  const noUrl = await store.create({ name: "NoUrl", baseUrl: "", apiKey: "sk-x", apps: { opencode: true } });
  await assert.rejects(() => store.switchTo("opencode", noUrl.id), /Base URL/);
});

test("per-app 排序与团队八应用绑定保持隔离", async (t) => {
  const { store } = await fixture(t);
  const first = await store.create({ name: "First", apps: { claude: true, opencode: true } });
  const second = await store.create({ name: "Second", apps: { claude: true, opencode: true } });
  await store.sort([second.id, first.id], { app: "opencode" });
  const listed = store.list();
  assert.deepEqual(listed.appOrder.opencode, [second.id, first.id]);
  assert.deepEqual(listed.appOrder.claude, [first.id, second.id]);

  const teamRoot = await mkdtemp(resolve(appRoot, ".test-providers-eight-team-"));
  t.after(() => rm(teamRoot, { recursive: true, force: true }));
  const teams = await new TeamStore({ dataRoot: join(teamRoot, "d"), knownProviders: () => ["claude-fable"] }).init();
  const team = await teams.create({ name: "八应用绑定", members: ["claude-fable"], providers: { opencode: first.id, hermes: second.id } });
  assert.deepEqual(team.providers, { opencode: first.id, hermes: second.id });
});

test("previewSwitch 干跑：codex 完整 config.toml + auth.json 回显——不落盘、密钥掩码、current 不动", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  // 预置 live 文件：config.toml 带用户内容 + 明文密钥；auth.json 带旧 key
  await mkdir(join(runtimeHome, ".codex"), { recursive: true });
  const liveToml = [
    'sandbox_mode = "workspace-write"',
    'ANTHROPIC_AUTH_TOKEN = "sk-live-oldtoken123456"',
    "",
    "[projects.'I:\\\\x']",
    'trust_level = "trusted"',
    "",
  ].join("\n");
  await writeFile(join(runtimeHome, ".codex", "config.toml"), liveToml);
  await writeFile(join(runtimeHome, ".codex", "auth.json"), '{\n  "OPENAI_API_KEY": "sk-old-auth-key-9999"\n}\n');
  const created = await store.create(PACKY); // codex key = sk-packy-1234567890abcdef

  const result = await store.previewSwitch("codex", { id: created.id, name: "PackyCode" });
  // 不落盘：live 文件一字未动
  assert.equal(await readFile(join(runtimeHome, ".codex", "config.toml"), "utf8"), liveToml);
  assert.equal(JSON.parse(await readFile(join(runtimeHome, ".codex", "auth.json"), "utf8")).OPENAI_API_KEY, "sk-old-auth-key-9999");
  assert.equal(store.current.codex, null); // current 指针不动

  const paths = result.files.map((file) => file.path).sort();
  assert.deepEqual(paths, ["~/.codex/auth.json", "~/.codex/config.toml"]);
  const toml = result.files.find((file) => file.path.endsWith("config.toml")).content;
  assert.match(toml, /sandbox_mode = "workspace-write"/); // 用户内容原样保留
  assert.match(toml, /trust_level = "trusted"/);
  assert.match(toml, /model_provider = "forge"/); // 投影块在
  assert.match(toml, /base_url = "https:\/\/api\.packycode\.com\/v1"/);
  assert.match(toml, /model = "gpt-5-codex"/);
  assert.ok(!toml.includes("sk-live-oldtoken123456")); // live 明文被掩码
  const auth = result.files.find((file) => file.path.endsWith("auth.json")).content;
  assert.ok(!auth.includes("sk-packy-1234567890abcdef")); // 投影 key 被掩码
  assert.match(auth, /••••cdef/);

  // 未存草稿（无 id）也能干跑：表单新建场景
  const draft = await store.previewSwitch("codex", {
    name: "NewGuy",
    baseUrl: "https://api.new.com",
    apiKey: "sk-new-draft-key-1111",
    apps: { codex: true },
    models: { codex: { model: "gpt-5.6" } },
  });
  const draftToml = draft.files.find((file) => file.path.endsWith("config.toml")).content;
  assert.match(draftToml, /name = "NewGuy"/);
  assert.match(draftToml, /model = "gpt-5.6"/);
  const draftAuth = draft.files.find((file) => file.path.endsWith("auth.json")).content;
  assert.ok(!draftAuth.includes("sk-new-draft-key-1111"));
  assert.match(draftAuth, /••••1111/);
});

test("maskConfigSecrets：三形态密钥掩码，变量名/布尔/短值不误伤", () => {
  const out = maskConfigSecrets([
    '"ANTHROPIC_AUTH_TOKEN": "sk-abcdef1234567890"',
    "OPENAI_API_KEY=sk-abcdef1234567890",
    "api_key: sk-abcdef1234567890",
    'env_key = "OPENAI_API_KEY"',
    "requires_openai_auth = true",
    'wire_api = "responses"',
    'model = "gpt-5.6-sol"',
    'args = ["--token", "ace_0123456789abcdef0123"]',
  ].join("\n"));
  assert.ok(!out.includes("sk-abcdef1234567890"));
  assert.ok(!out.includes("ace_0123456789abcdef0123"));
  assert.match(out, /env_key = "OPENAI_API_KEY"/);
  assert.match(out, /requires_openai_auth = true/);
  assert.match(out, /wire_api = "responses"/);
  assert.match(out, /model = "gpt-5\.6-sol"/);

  const plural = maskConfigSecrets(JSON.stringify({
    apiKeys: ["array-secret-value-123456"],
    nested: { credentials: [{ futureToken: "future-secret-value-123456" }] },
    visible: true,
  }, null, 2));
  assert.doesNotMatch(plural, /array-secret|future-secret/);
  assert.match(plural, /"visible": true/);

  for (const source of [
    'apiKeys = ["alpha-secret-value-123"]',
    'apiKeys: ["alpha-secret-value-123"]',
    'apiKeys = [\n  "alpha-secret-value-123",\n  "beta-secret-value-456"\n]',
    'credentials = { primary: "alpha-secret-value-123" }',
    'apiKeys = ["alpha-secret-value-123"',
  ]) {
    const masked = maskConfigSecrets(source);
    assert.doesNotMatch(masked, /alpha-secret|beta-secret/, source);
    assert.match(masked, /(?:REDACTED|[•]{4})/, source);
  }
});

test("rawConfig 原文覆盖：启用按原文写入（盖过投影），未覆盖文件照常投影，list 只见路径不见原文", async (t) => {
  const { store, runtimeHome } = await fixture(t);
  const created = await store.create({
    ...PACKY,
    meta: {
      rawConfig: {
        codex: { "~/.codex/config.toml": 'model = "gpt-5.6-sol"\n# 手改原文\n' },
      },
    },
  });
  await store.switchTo("codex", created.id);
  const toml = await readFile(join(runtimeHome, ".codex", "config.toml"), "utf8");
  assert.equal(toml, 'model = "gpt-5.6-sol"\n# 手改原文\n'); // 原文 verbatim
  const auth = JSON.parse(await readFile(join(runtimeHome, ".codex", "auth.json"), "utf8"));
  assert.equal(auth.OPENAI_API_KEY, "sk-packy-1234567890abcdef"); // auth.json 未覆盖 → 照常投影
  // list/publicView：原文不出服务端，只回路径清单
  const listed = store.list().providers.find((p) => p.id === created.id);
  assert.equal(listed.meta.rawConfig, undefined);
  assert.deepEqual(listed.meta.rawConfigPaths, { codex: ["~/.codex/config.toml"] });
});

test("rawConfig 补丁语义：字符串覆盖、null 删除、坏 JSON/空文本拒收", async (t) => {
  const { store } = await fixture(t);
  const created = await store.create({
    ...PACKY,
    meta: { rawConfig: { codex: { "~/.codex/config.toml": 'model = "a"\n', "~/.codex/auth.json": '{ "K": 1 }\n' } } },
  });
  // null 删除 auth.json 覆盖，config.toml 保留
  const updated = await store.update(created.id, { meta: { rawConfig: { codex: { "~/.codex/auth.json": null } } } });
  assert.deepEqual(updated.meta.rawConfigPaths, { codex: ["~/.codex/config.toml"] });
  // 坏 JSON 拒收（.json 路径强校验）
  await assert.rejects(
    () => store.update(created.id, { meta: { rawConfig: { codex: { "~/.codex/auth.json": "{ 坏" } } } }),
    /not valid JSON/,
  );
  // 空文本拒收（删除必须显式 null）
  await assert.rejects(
    () => store.update(created.id, { meta: { rawConfig: { codex: { "~/.codex/config.toml": "  " } } } }),
    /non-empty/,
  );
  // 未提及路径保留现值（补丁而非替换）
  const again = await store.update(created.id, { meta: { rawConfig: { codex: { "~/.codex/auth.json": '{ "A": 2 }' } } } });
  assert.deepEqual(again.meta.rawConfigPaths.codex.sort(), ["~/.codex/auth.json", "~/.codex/config.toml"]);
});

test("previewSwitch reveal + rawConfig 补丁：干跑反映手改原文，reveal 出明文，默认仍掩码，不落盘", async (t) => {
  const { store } = await fixture(t);
  const created = await store.create(PACKY);
  const draft = {
    id: created.id,
    meta: { rawConfig: { codex: { "~/.codex/config.toml": 'model = "gpt-5.6-sol"\n# 手改原文\n' } } },
  };
  const masked = await store.previewSwitch("codex", draft);
  const tomlFile = masked.files.find((f) => f.path.endsWith("config.toml"));
  assert.match(tomlFile.content, /gpt-5\.6-sol/); // 手改原文生效（盖过投影）
  const authMasked = masked.files.find((f) => f.path.endsWith("auth.json"));
  assert.ok(!authMasked.content.includes("sk-packy-1234567890abcdef")); // 默认掩码
  const revealed = await store.previewSwitch("codex", draft, { reveal: true });
  const authPlain = revealed.files.find((f) => f.path.endsWith("auth.json"));
  assert.ok(authPlain.content.includes("sk-packy-1234567890abcdef")); // reveal 出明文
  assert.equal(store.current.codex, null); // 不落盘不动指针
});
