// cc-switch 完全迁移第二波单测：provider-net（测速/可达性/用量沙箱/深链接/模型测试）
// + providers.mjs 扩展面（meta 校验/排序/failover/导入导出/commonConfig/env 冲突）。
// 网络用例一律打 127.0.0.1 本地 server（loopback 豁免 HTTPS 闸），零外网依赖。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkReachability,
  parseDeeplink,
  queryProviderUsage,
  queryUsageScript,
  testEndpoints,
  testModelRequest,
  USAGE_TEMPLATES,
} from "../src/provider-net.mjs";
import { ProviderStore, claudeEnvProjection, geminiEnvProjection, proxyUrlOf } from "../src/providers.mjs";

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withStore(run, { runtimeHome = true } = {}) {
  const dataRoot = await mkdtemp(join(tmpdir(), "forge-providers-"));
  const home = runtimeHome ? await mkdtemp(join(tmpdir(), "forge-runtime-")) : null;
  const store = await new ProviderStore({ dataRoot, runtimeHome: home ?? undefined }).init();
  try {
    await run(store, home, dataRoot);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
    if (home) await rm(home, { recursive: true, force: true });
  }
}

const baseInput = (over = {}) => ({
  name: "Relay",
  baseUrl: "https://relay.example.com",
  apiKey: "sk-test-key",
  apps: { claude: true, codex: true, gemini: false },
  ...over,
});

// ── testEndpoints（speedtest.rs 复刻面）──────────────────────────────────
test("testEndpoints: 并发测速返回 latency/status，无效与空 URL 如实报错", async () => {
  await withServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  }, async (base) => {
    const results = await testEndpoints([base, "", "not a url", "ftp://x"], 5);
    assert.equal(results.length, 4);
    assert.equal(results[0].status, 200);
    assert.ok(typeof results[0].latency === "number" && results[0].latency >= 0);
    assert.equal(results[1].error, "URL 不能为空");
    assert.match(results[2].error, /URL 无效/);
    assert.match(results[3].error, /仅支持/);
  });
});

test("testEndpoints: 连接失败如实回报（不吞错误）", async () => {
  const results = await testEndpoints(["http://127.0.0.1:1"], 3);
  assert.equal(results[0].latency, null);
  assert.match(results[0].error, /连接失败|请求超时/);
});

// ── checkReachability（stream_check.rs 复刻面）────────────────────────────
test("checkReachability: 任意 HTTP 状态都算可达（含 404/403）", async () => {
  await withServer((req, res) => {
    res.writeHead(req.url === "/forbidden" ? 403 : 404);
    res.end();
  }, async (base) => {
    const notFound = await checkReachability(base, {});
    assert.equal(notFound.success, true);
    assert.equal(notFound.httpStatus, 404);
    assert.equal(notFound.status, "operational");
    const forbidden = await checkReachability(`${base}/forbidden`, {});
    assert.equal(forbidden.success, true);
    assert.equal(forbidden.httpStatus, 403);
  });
});

test("checkReachability: 超过降级阈值判 degraded；连接拒绝 failed 不重试", async () => {
  await withServer(async (req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    res.writeHead(200);
    res.end();
  }, async (base) => {
    const result = await checkReachability(base, { degradedThresholdMs: 50 });
    assert.equal(result.success, true);
    assert.equal(result.status, "degraded");
  });
  const failed = await checkReachability("http://127.0.0.1:1", { maxRetries: 3 });
  assert.equal(failed.success, false);
  assert.equal(failed.status, "failed");
  assert.equal(failed.retryCount, 0); // 连接拒绝非超时类，不重试
});

test("checkReachability: 空 baseUrl 拒绝", async () => {
  await assert.rejects(() => checkReachability("", {}), /base_url 为空/);
});

// ── queryUsageScript（usage_script.rs 复刻面）─────────────────────────────
test("queryUsageScript: new-api 模板端到端（变量替换+extractor+字段校验）", async () => {
  await withServer((req, res) => {
    assert.equal(req.url, "/api/user/self");
    assert.equal(req.headers.authorization, "Bearer token-abc");
    assert.equal(req.headers["new-api-user"], "42");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: true, data: { group: "vip", quota: 1000000, used_quota: 500000 } }));
  }, async (base) => {
    const result = await queryUsageScript({
      code: USAGE_TEMPLATES["new-api"],
      baseUrl: base,
      accessToken: "token-abc",
      userId: "42",
      templateType: "new-api",
    });
    assert.equal(result.success, true);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].planName, "vip");
    assert.equal(result.data[0].remaining, 2);
    assert.equal(result.data[0].used, 1);
    assert.equal(result.data[0].total, 3);
    assert.equal(result.data[0].unit, "USD");
  });
});

test("queryUsageScript: general 模板（/user/balance + Bearer apiKey）", async () => {
  await withServer((req, res) => {
    assert.equal(req.url, "/user/balance");
    assert.equal(req.headers.authorization, "Bearer sk-live");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ is_active: true, balance: 12.5 }));
  }, async (base) => {
    const result = await queryUsageScript({ code: USAGE_TEMPLATES.general, baseUrl: base, apiKey: "sk-live", templateType: "general" });
    assert.equal(result.success, true);
    assert.equal(result.data[0].remaining, 12.5);
  });
});

test("queryUsageScript: 非 custom 模板强制 HTTPS（非 loopback http 拒绝）", async () => {
  await assert.rejects(
    () => queryUsageScript({ code: USAGE_TEMPLATES.general, baseUrl: "http://api.example.com", templateType: "general" }),
    (error) => error.code === "USAGE_HTTPS_REQUIRED",
  );
});

test("queryUsageScript: 非 custom 模板跨域拒绝（同源闸）；custom 放行", async () => {
  const crossScript = `({
    request: { url: "http://127.0.0.1:9/other", method: "GET", headers: {} },
    extractor: function(response) { return { remaining: 1, unit: "USD" }; }
  })`;
  await assert.rejects(
    () => queryUsageScript({ code: crossScript, baseUrl: "http://127.0.0.1:8", templateType: "general" }),
    (error) => error.code === "USAGE_PORT_MISMATCH" || error.code === "USAGE_HOST_MISMATCH",
  );
  // custom 跳过同源检查（请求本身会失败——放行的是校验层而非网络层）
  await assert.rejects(
    () => queryUsageScript({ code: crossScript, baseUrl: "http://127.0.0.1:8", templateType: "custom", timeout: 2 }),
    (error) => error.code === "USAGE_REQUEST_FAILED",
  );
});

test("queryUsageScript: Worker 建立后的请求校验失败也会回收线程", async () => {
  const before = process._getActiveHandles().filter((handle) => handle?.constructor?.name === "MessagePort").length;
  for (const code of [
    `({ request: null, extractor: function() { return {}; } })`,
    `({ request: { url: "", method: "GET" }, extractor: function() { return {}; } })`,
    `({ request: { url: "http://127.0.0.1/x", method: "INVALID" }, extractor: function() { return {}; } })`,
  ]) {
    await assert.rejects(() => queryUsageScript({ code, templateType: "custom" }));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  const after = process._getActiveHandles().filter((handle) => handle?.constructor?.name === "MessagePort").length;
  assert.equal(after, before, "usage script validation must not leave Worker MessagePort handles");
});

test("queryUsageScript: 非 2xx 折叠 HTTP 状态+预览；非法方法拒绝；结果类型校验", async () => {
  await withServer((req, res) => {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "slow down" }));
  }, async (base) => {
    await assert.rejects(
      () => queryUsageScript({ code: USAGE_TEMPLATES.general, baseUrl: base, templateType: "general" }),
      (error) => error.code === "USAGE_HTTP_ERROR" && /HTTP 429/.test(error.message),
    );
  });
  const badMethod = `({ request: { url: "http://127.0.0.1/x", method: "FOO", headers: {} }, extractor: function(r) { return {}; } })`;
  await assert.rejects(
    () => queryUsageScript({ code: badMethod, templateType: "custom" }),
    (error) => error.code === "USAGE_METHOD_INVALID",
  );
  await withServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  }, async (base) => {
    const badResult = `({ request: { url: "${base}/", method: "GET", headers: {} }, extractor: function(r) { return { remaining: "a lot" }; } })`;
    await assert.rejects(
      () => queryUsageScript({ code: badResult, templateType: "custom" }),
      (error) => error.code === "USAGE_RESULT_INVALID",
    );
  });
});

test("queryUsageScript: extractor 不能沿宿主响应对象逃逸，且死循环受 timeout 终止", async () => {
  await withServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  }, async (base) => {
    const escape = `({
      request: { url: "${base}/", method: "GET", headers: {} },
      extractor: function(response) {
        return { extra: response.constructor.constructor("return process")().version };
      }
    })`;
    await assert.rejects(
      () => queryUsageScript({ code: escape, templateType: "custom" }),
      (error) => error.code === "USAGE_EXTRACTOR_FAILED" && /Code generation from strings disallowed/.test(error.message),
    );

    const spin = `({
      request: { url: "${base}/", method: "GET", headers: {} },
      extractor: function() { while (true) {} }
    })`;
    await assert.rejects(
      () => queryUsageScript({ code: spin, templateType: "custom" }),
      (error) => error.code === "USAGE_EXTRACTOR_FAILED" && /timed out/.test(error.message),
    );

    const microtaskSpin = `({
      request: { url: "${base}/", method: "GET", headers: {} },
      extractor: function() {
        Promise.resolve().then(function() { while (true) {} });
        return { remaining: 1 };
      }
    })`;
    await assert.rejects(
      () => queryUsageScript({ code: microtaskSpin, templateType: "custom" }),
      (error) => error.code === "USAGE_EXTRACTOR_FAILED" && /timed out/.test(error.message),
    );
  });
});

test("queryProviderUsage: script 显式凭据优先，回落 provider 主配置；未启用如实报错", async () => {
  await withServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ is_active: true, balance: 7 }));
  }, async (base) => {
    const provider = {
      baseUrl: base,
      apiKey: "sk-main",
      meta: { usageScript: { enabled: true, code: USAGE_TEMPLATES.general, templateType: "general", timeout: 5 } },
    };
    const result = await queryProviderUsage(provider);
    assert.equal(result.success, true);
    assert.equal(result.data[0].remaining, 7);
    const disabled = await queryProviderUsage({ ...provider, meta: { usageScript: { enabled: false, code: "x" } } });
    assert.equal(disabled.success, false);
    assert.match(disabled.error, /未启用/);
  });
});

// ── parseDeeplink（parser.rs provider 分支复刻面）─────────────────────────
test("parseDeeplink: 完整 provider 深链接（多端点+用量脚本+模型）", () => {
  const url = "ccswitch://v1/import?resource=provider&app=claude&name=MyRelay"
    + "&homepage=https://relay.example.com&endpoint=https://a.example.com,https://b.example.com"
    + "&apiKey=sk-deep&model=claude-sonnet-4&haikuModel=claude-haiku&notes=hi"
    + "&usageEnabled=true&usageScript=" + encodeURIComponent("({request:{url:'{{baseUrl}}/x',method:'GET',headers:{}},extractor:function(r){return {remaining:1,unit:'USD'}}})")
    + "&usageUserId=9&usageAutoInterval=60";
  const parsed = parseDeeplink(url);
  assert.equal(parsed.name, "MyRelay");
  assert.equal(parsed.baseUrl, "https://a.example.com");
  assert.equal(parsed.apiKey, "sk-deep");
  assert.deepEqual(parsed.apps, { claude: true, codex: false, gemini: false });
  assert.equal(parsed.meta.customEndpoints.length, 1);
  assert.equal(parsed.meta.customEndpoints[0].url, "https://b.example.com");
  assert.equal(parsed.meta.usageScript.enabled, true);
  assert.equal(parsed.meta.usageScript.userId, "9");
  assert.equal(parsed.meta.usageScript.autoQueryInterval, 60);
  assert.equal(parsed.models.claude.model, "claude-sonnet-4");
  assert.equal(parsed.models.claude.haikuModel, "claude-haiku");
});

test("parseDeeplink: 无效 scheme/version/resource/app 逐一拒绝", () => {
  assert.throws(() => parseDeeplink("https://v1/import?resource=provider&app=claude&name=x"), /scheme/);
  assert.throws(() => parseDeeplink("ccswitch://v2/import?resource=provider&app=claude&name=x"), /version/);
  assert.throws(() => parseDeeplink("ccswitch://v1/import?resource=mcp&app=claude&name=x"), /resource type/);
  assert.throws(() => parseDeeplink("ccswitch://v1/import?resource=provider&app=grok&name=x"), /app type/);
  assert.throws(() => parseDeeplink("ccswitch://v1/import?resource=provider&app=claude"), /name/);
});

// ── testModelRequest（真实小请求面）───────────────────────────────────────
test("testModelRequest: claude 格式 200=可用，401=鉴权失败如实报", async () => {
  await withServer((req, res) => {
    if (req.headers["x-api-key"] !== "sk-good") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid key" } }));
      return;
    }
    assert.equal(req.url, "/v1/messages");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_1" }));
  }, async (base) => {
    const provider = { baseUrl: base, apiKey: "sk-good", models: { claude: { model: "claude-haiku-4" } }, meta: {} };
    const ok = await testModelRequest(provider, "claude");
    assert.equal(ok.success, true);
    const bad = await testModelRequest({ ...provider, apiKey: "sk-bad" }, "claude");
    assert.equal(bad.success, false);
    assert.equal(bad.httpStatus, 401);
  });
});

test("testModelRequest: codex baseUrl 补 /v1（codexBaseUrl 口径）", async () => {
  await withServer((req, res) => {
    assert.equal(req.url, "/v1/chat/completions");
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  }, async (base) => {
    const provider = { baseUrl: base, apiKey: "sk", models: { codex: { model: "gpt-5" } }, meta: {} };
    const result = await testModelRequest(provider, "codex");
    assert.equal(result.success, true);
  });
});

// ── providers.mjs 扩展面（meta/排序/failover/导入导出/commonConfig）────────
test("meta 校验：customEndpoints normalize+去重；proxy enabled 无 host 拒绝；敏感字段掩码", async () => {
  await withStore(async (store) => {
    const created = await store.create(baseInput({
      meta: {
        customEndpoints: [
          { url: "https://a.example.com/" },
          { url: "https://a.example.com" }, // normalize 后重复 → 去重
          { url: "https://b.example.com" },
        ],
        usageScript: { enabled: true, code: USAGE_TEMPLATES.general, templateType: "general", apiKey: "sk-usage", accessToken: "tok-1" },
        proxyConfig: { enabled: false, host: "127.0.0.1", port: 7890, password: "pw" },
        proxyOverrides: { body: { accessToken: "ANTHROPIC_API_KEY" } },
        costMultiplier: 1.5,
        limitDailyUsd: 10,
        apiKeyField: "ANTHROPIC_API_KEY",
      },
    }));
    assert.equal(created.meta.customEndpoints.length, 2);
    assert.equal(created.meta.customEndpoints[0].url, "https://a.example.com");
    // 敏感字段掩码：永不出服务端
    assert.equal(created.meta.usageScript.apiKey, undefined);
    assert.equal(created.meta.usageScript.hasApiKey, true);
    assert.equal(created.meta.usageScript.accessToken, undefined);
    assert.equal(created.meta.proxyConfig.password, undefined);
    assert.equal(created.meta.proxyConfig.hasPassword, true);
    assert.equal(created.meta.apiKeyField, "ANTHROPIC_API_KEY");
    assert.equal(created.meta.proxyOverrides.body.accessToken, "[REDACTED]", "bare env-like text is safe only in the typed apiKeyField reference");
    // update 留空=保留（usage apiKey 不提交则原值留存）
    const updated = await store.update(created.id, baseInput({ meta: { usageScript: { enabled: true, code: "x", templateType: "custom" } } }));
    assert.equal(updated.meta.usageScript.hasApiKey, true);
    await assert.rejects(
      () => store.create(baseInput({ meta: { proxyConfig: { enabled: true } } })),
      /proxy host is required/,
    );
  });
});

test("apiKeyField 与 proxyConfig 投影：claude env 写 ANTHROPIC_API_KEY + HTTPS_PROXY", async () => {
  await withStore(async (store) => {
    const provider = await store.create(baseInput({
      meta: {
        apiKeyField: "ANTHROPIC_API_KEY",
        proxyConfig: { enabled: true, proxyType: "http", host: "127.0.0.1", port: 7890, username: "u", password: "p w" },
      },
    }));
    const raw = store.get(provider.id);
    const env = claudeEnvProjection(raw);
    assert.equal(env.ANTHROPIC_API_KEY, "sk-test-key");
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.equal(env.HTTPS_PROXY, `http://u:${encodeURIComponent("p w")}@127.0.0.1:7890`);
    assert.equal(proxyUrlOf(null), "");
    assert.equal(proxyUrlOf({ enabled: false, host: "x" }), "");
    const geminiEnv = geminiEnvProjection(raw);
    assert.equal(geminiEnv.HTTPS_PROXY, env.HTTPS_PROXY);
  });
});

test("sort：按 orderedIds 重写 sortIndex，未提及排末尾，list 按序返回", async () => {
  await withStore(async (store) => {
    const a = await store.create(baseInput({ name: "A" }));
    const b = await store.create(baseInput({ name: "B" }));
    const c = await store.create(baseInput({ name: "C" }));
    assert.deepEqual(store.list().providers.map((p) => p.name), ["A", "B", "C"]);
    await store.sort([c.id, a.id]);
    assert.deepEqual(store.list().providers.map((p) => p.name), ["C", "A", "B"]);
    assert.equal(b.id ? true : true, true);
  });
});

test("failover：队列校验/空队列开启补 P1/failoverNext 自动切换并写 live", async () => {
  await withStore(async (store, home) => {
    const p1 = await store.create(baseInput({ name: "P1" }));
    const p2 = await store.create(baseInput({ name: "P2", baseUrl: "https://p2.example.com" }));
    await assert.rejects(() => store.setFailover("claude", { queue: ["nope"] }), /not found/);
    // 开启且无队列 → current 补位 P1（cc-switch 语义）；先切出 current
    await store.switchTo("claude", p1.id);
    const state1 = await store.setFailover("claude", { autoFailover: true });
    assert.deepEqual(state1.queue.map((item) => item.providerId), [p1.id]);
    assert.equal(state1.autoFailover, true);
    // 手动队列 [P1, P2]，P1 失败 → failoverNext 切 P2 并写 live
    await store.setFailover("claude", { queue: [p1.id, p2.id] });
    const moved = await store.failoverNext("claude", p1.id);
    assert.equal(moved.switched, true);
    assert.equal(moved.to, p2.id);
    const settings = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
    assert.equal(settings.env.ANTHROPIC_BASE_URL, "https://p2.example.com");
    // 关闭 autoFailover → 不再转移
    await store.setFailover("claude", { autoFailover: false });
    const stayed = await store.failoverNext("claude", p2.id);
    assert.equal(stayed.switched, false);
    // 删除 provider 自动清出队列
    await store.remove(p1.id);
    assert.deepEqual(store.getFailover("claude").queue.map((item) => item.providerId), [p2.id]);
  });
});

test("export/import：默认掩码导出、includeSecrets 明文、merge 语义、replace 全量", async () => {
  await withStore(async (store) => {
    const created = await store.create(baseInput({ name: "Exp" }));
    await store.setFailover("claude", { queue: [created.id], autoFailover: true });
    const masked = store.exportProviders();
    assert.equal(masked.providers[0].apiKey, undefined);
    assert.equal(masked.providers[0].hasApiKey, true);
    const full = store.exportProviders({ includeSecrets: true });
    assert.equal(full.providers[0].apiKey, "sk-test-key");
    // merge 同 id = update；外来 id（备份来自别的机器）= added
    const sameId = await store.importProviders(full, { mode: "merge" });
    assert.equal(sameId.updated, 1);
    assert.equal(sameId.added, 0);
    const foreign = JSON.parse(JSON.stringify(full));
    foreign.providers[0].id = "provider-foreign";
    foreign.providers[0].name = "Foreign";
    const merged = await store.importProviders(foreign, { mode: "merge" });
    assert.equal(merged.added, 1);
    assert.equal(merged.total, 2);
    // replace：全量重建 + current/queue 还原
    const replaced = await store.importProviders(full, { mode: "replace" });
    assert.equal(replaced.added, 1);
    assert.equal(replaced.total, 1);
    assert.equal(store.list().providers[0].name, "Exp");
    assert.deepEqual(store.getFailover("claude").queue.map((item) => item.providerId), [created.id]);
  });
});

test("commonConfig：claude JSON 片段并入 settings 顶层；gemini KEY=VALUE 并入 .env；非法 JSON 拒绝", async () => {
  await withStore(async (store, home) => {
    assert.throws(() => store.setCommonConfig("claude", "[1,2]"), /JSON object/);
    await store.setCommonConfig("claude", JSON.stringify({ statusLine: { type: "command", command: "echo hi" }, model: "" }));
    await store.setCommonConfig("gemini", "CLI_THEME=Default\nFOO=bar");
    const provider = await store.create(baseInput({ apps: { claude: true, codex: false, gemini: true } }));
    await store.switchTo("claude", provider.id);
    const settings = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
    assert.deepEqual(settings.statusLine, { type: "command", command: "echo hi" });
    assert.equal(settings.env.ANTHROPIC_BASE_URL, "https://relay.example.com");
    await store.switchTo("gemini", provider.id);
    const envText = await readFile(join(home, ".gemini", ".env"), "utf8");
    assert.match(envText, /CLI_THEME=Default/);
    assert.match(envText, /GOOGLE_GEMINI_BASE_URL=https:\/\/relay\.example\.com/);
  });
});

test("envConflicts：进程环境变量撞车如实报告（掩码）", async () => {
  await withStore(async (store) => {
    process.env.ANTHROPIC_BASE_URL = "https://env-override.example.com";
    try {
      const { conflicts } = store.envConflicts();
      const hit = conflicts.find((item) => item.key === "ANTHROPIC_BASE_URL");
      assert.ok(hit);
      assert.equal(hit.app, "claude");
      assert.match(hit.valueMasked, /^••••/);
    } finally {
      delete process.env.ANTHROPIC_BASE_URL;
    }
  });
});
