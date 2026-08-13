/**
 * remote-graph 契约测试（v41 波五）：清单解析 / toml+json 浅提取 / graph 组装 / 真源读取 / 路由门闸。
 * 不连网：ssh service 用假件；路由用收集式假 router + 真 remote-gates（同 remote-ops 测试范式）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRemoteGraph,
  parseInventory,
  extractTomlProvider,
  extractJsonProvider,
  extractEnvProvider,
  extractYamlProvider,
  extractManagedProviderId,
} from "../src/ssh/remote-graph.mjs";
import { registerSshRoutes, setSshServiceForTest, setRemoteGraphForTest } from "../src/ssh/routes.mjs";
import { createRemoteGateService } from "../src/security/remote-gates.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const INVENTORY_FIXTURE = [
  `CAP64|skill|claude|${Buffer.from("foo-skill").toString("base64")}`,
  `CAP64|agent|claude|${Buffer.from("reviewer").toString("base64")}`,
  `CAP64|agent|codex|${Buffer.from("codex-reviewer.toml").toString("base64")}`,
  `CAP64|skill|codex|${Buffer.from("co-review").toString("base64")}`,
  `CAP64|prompt|codex|${Buffer.from("init").toString("base64")}`,
  `CAP64|weird|claude|${Buffer.from("nope").toString("base64")}`, // 未知 kind 忽略
  "SRC|claude-settings|yes|120|1700000000",
  "SRC|claude-global|no||",
  "SRC|codex-config|yes|200|1700000100",
  "SRC|kimi-config|yes|150|1700000200",
  "SRC|gemini-settings|no||",
  "SRC|codex-agents|yes|88|1700000300",
  "SRC|claude-memory|no||",
  `BAK64|codex-config|${Buffer.from("config.toml.514forge-backup-11111111-1111-4111-8111-111111111111").toString("base64")}|199|1700000400`,
  "SRC|unknown-id|yes|1|1", // 未知 id 忽略
  "garbage line",
].join("\n");

test("parseInventory: CAP/SRC/BAK 行协议解析，未知 kind/id/垃圾行忽略", () => {
  const { capabilities, sources, backups } = parseInventory(INVENTORY_FIXTURE);
  assert.equal(capabilities.length, 5);
  assert.deepEqual(capabilities[0], { kind: "skill", cli: "claude", name: "foo-skill" });
  assert.ok(!capabilities.some((cap) => cap.kind === "weird"));
  assert.equal(sources.length, 7);
  const settings = sources.find((entry) => entry.id === "claude-settings");
  assert.equal(settings.exists, true);
  assert.equal(settings.size, 120);
  assert.equal(settings.mtime, new Date(1700000000 * 1000).toISOString());
  const missing = sources.find((entry) => entry.id === "claude-global");
  assert.equal(missing.exists, false);
  assert.equal(missing.size, 0);
  assert.equal(missing.mtime, null);
  assert.ok(!sources.some((entry) => entry.id === "unknown-id"));
  assert.equal(backups.length, 1);
  assert.equal(backups[0].sourceId, "codex-config");
});

test("parseInventory: base64 文件名保留竖线/换行且拒绝伪造行", () => {
  const tricky = "name|with\nnewline";
  const { capabilities } = parseInventory([
    `CAP64|skill|claude|${Buffer.from(tricky).toString("base64")}`,
    "CAP|skill|claude|forged",
    "CAP64|skill|claude|not-base64!",
  ].join("\n"));
  assert.deepEqual(capabilities, [{ kind: "skill", cli: "claude", name: tricky }]);
});

test("extractTomlProvider: 只取顶层键；section 内键不认；mcp_servers 段名另出", () => {
  const { fields, mcpNames } = extractTomlProvider([
    'model = "gpt-5-codex"',
    'base_url = "https://api.openai.com" # comment',
    'wire_api = "responses"',
    'model_provider = "openai"',
    "",
    "[profiles.work]",
    'model = "should-not-leak"', // section 内同名键绝不覆盖顶层
    "",
    "[mcp_servers.docs]",
    'command = "x"',
    "[mcp_servers.\"web-search\"]",
    'url = "https://example.com"',
  ].join("\n"));
  assert.equal(fields.model, "gpt-5-codex");
  assert.equal(fields.baseUrl, "https://api.openai.com");
  assert.equal(fields.wireApi, "responses");
  assert.equal(fields.provider, "openai");
  assert.deepEqual(mcpNames, ["docs", "web-search"]);
});

test("extractJsonProvider: model / env.*_BASE_URL / mcpServers；坏 json 如实全空", () => {
  const { fields, mcpNames } = extractJsonProvider(JSON.stringify({
    model: "claude-opus-4-1",
    env: {
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      ANTHROPIC_AUTH_TOKEN: "sk-secret-should-not-extract", // token 键永不进 baseUrl
    },
    mcpServers: { fs: {}, web: {} },
  }));
  assert.equal(fields.model, "claude-opus-4-1");
  assert.equal(fields.baseUrl, "https://api.anthropic.com");
  assert.deepEqual(mcpNames.sort(), ["fs", "web"]);
  const bad = extractJsonProvider("{not json");
  assert.deepEqual(bad.fields, { model: null, baseUrl: null, wireApi: null, provider: null });
  assert.deepEqual(bad.mcpNames, []);
});

test("remote provider extractors cover managed TOML sections, Gemini env, OpenCode/OpenClaw and Hermes", () => {
  const codex = extractTomlProvider([
    'model_provider = "forge"',
    'model = "gpt-5.6-sol"',
    '[model_providers.forge]',
    'base_url = "https://codex.example/v1"',
    'wire_api = "responses"',
  ].join("\n"));
  assert.equal(codex.fields.baseUrl, "https://codex.example/v1");
  assert.equal(codex.fields.wireApi, "responses");
  const gemini = extractEnvProvider('GOOGLE_GEMINI_BASE_URL="https://gemini.example"\nGEMINI_MODEL=gemini-3.5-pro\nAPI_KEY=secret');
  assert.equal(gemini.fields.baseUrl, "https://gemini.example");
  assert.equal(gemini.fields.model, "gemini-3.5-pro");
  const opencode = extractJsonProvider('{model:"forge/gpt-5",provider:{forge:{options:{baseURL:"https://open.example/v1",apiKey:"secret"}}}}');
  assert.equal(opencode.fields.baseUrl, "https://open.example/v1");
  assert.equal(opencode.fields.provider, "forge");
  const openclaw = extractJsonProvider('{models:{providers:{forge:{baseUrl:"https://claw.example/v1",apiKey:"secret"}}}}');
  assert.equal(openclaw.fields.baseUrl, "https://claw.example/v1");
  const hermes = extractYamlProvider('model:\n  provider: forge\n  default: h-model\ncustom_providers:\n  - name: forge\n    base_url: https://hermes.example/v1\n    api_key: secret\n');
  assert.equal(hermes.fields.baseUrl, "https://hermes.example/v1");
  assert.equal(hermes.fields.model, "h-model");
});

test("extractManagedProviderId: Codex/Kimi/Gemini 与 Grok Build 只认各自完整唯一的 ProviderStore marker", () => {
  for (const cli of ["codex", "kimi", "gemini"]) {
    assert.equal(extractManagedProviderId([
      "user_setting = true",
      `# >>> 514-forge-provider (profile-${cli}) >>>`,
      "managed_setting = true",
      "# <<< 514-forge-provider <<<",
    ].join("\n"), cli), `profile-${cli}`);
  }
  assert.equal(extractManagedProviderId([
    "# >>> 514-forge-grokbuild-provider (profile-grok) >>>",
    "[models]",
    'default = "forge"',
    "# <<< 514-forge-grokbuild-provider <<<",
  ].join("\n"), "grokbuild"), "profile-grok");
  assert.equal(extractManagedProviderId([
    "# >>> 514-forge-provider (wrong-marker-family) >>>",
    "# <<< 514-forge-provider <<<",
  ].join("\n"), "grokbuild"), null);
  assert.equal(extractManagedProviderId("# >>> 514-forge-grokbuild-provider (wrong-marker-family) >>>\n# <<< 514-forge-grokbuild-provider <<<", "codex"), null);
});

test("extractManagedProviderId: 伪造、不完整、重复和缺失 marker 均不投影身份", () => {
  const cases = [
    "model = \"gpt-5\"",
    "prefix # >>> 514-forge-provider (profile-a) >>>\n# <<< 514-forge-provider <<<",
    "# >>> 514-forge-provider (profile-a) >>>\nmodel = \"gpt-5\"",
    "# <<< 514-forge-provider <<<",
    "# >>> 514-forge-provider () >>>\n# <<< 514-forge-provider <<<",
    "# >>> 514-forge-provider ( profile-a) >>>\n# <<< 514-forge-provider <<<",
    "# >>> 514-forge-provider (profile-a) >>> forged\n# <<< 514-forge-provider <<<",
    "# >>> 514-forge-provider (profile-a) >>>\n# >>> 514-forge-provider (profile-b) >>>\n# <<< 514-forge-provider <<<",
    "# >>> 514-forge-provider (profile-a) >>>\n# <<< 514-forge-provider <<<\n# >>> 514-forge-provider (profile-b) >>>\n# <<< 514-forge-provider <<<",
    "# >>> 514-forge-provider (token=abcdefghijklmnop) >>>\n# <<< 514-forge-provider <<<",
  ];
  for (const content of cases) assert.equal(extractManagedProviderId(content, "codex"), null);
  assert.equal(extractManagedProviderId("# >>> 514-forge-provider (profile-a) >>>\n# <<< 514-forge-provider <<<", "claude"), null);
});

function fakeSshGraph({ reads = {}, execImpl, updateCalls = [], pathChecks = [], resolvedPathChecks = [], readCalls = [] } = {}) {
  return {
    exec: execImpl ?? (async (id, { command }) => {
      if (command.includes("$HOME")) return { code: 0, stdout: "/root", stderr: "" };
      return { code: 0, stdout: INVENTORY_FIXTURE, stderr: "" };
    }),
    async update(id, fields) { updateCalls.push({ id, fields }); return { id, ...fields }; },
    assertSftpPathPublic(id, path) { pathChecks.push({ id, path }); },
    async assertSftpResolvedPathPublic(id, path) { resolvedPathChecks.push({ id, path }); return path; },
    async sftpRead(id, path) {
      readCalls.push({ kind: "scrubbed", id, path });
      if (!(path in reads)) throw Object.assign(new Error(`sftp missing: ${path}`), { code: "SFTP_FAILED" });
      return { content: reads[path], truncated: false };
    },
    async sftpReadRaw(id, path) {
      readCalls.push({ kind: "raw", id, path });
      if (!(path in reads)) throw Object.assign(new Error(`sftp missing: ${path}`), { code: "SFTP_FAILED" });
      return { content: reads[path], truncated: false };
    },
  };
}

const READS = {
  "/root/.claude/settings.json": JSON.stringify({
    model: "claude-opus-4-1",
    env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" },
    mcpServers: { fs: {} },
  }),
  "/root/.codex/config.toml": 'model = "gpt-5-codex"\nwire_api = "responses"\n[mcp_servers.docs]\ncommand = "x"\n',
  "/root/.kimi-code/config.toml": 'model = "kimi-code/k3-256k"\napi_key = "sk-1234567890abcdef1234567890abcdef"\nbase_url = "https://api.kimi.com/coding/v1"\n',
};

test("remoteGraph.graph: 组装 home/providers/capabilities/mcp/sources；api_key 永不进 provider 字段", async () => {
  const updateCalls = [];
  const ssh = fakeSshGraph({ reads: READS, updateCalls });
  const graph = await createRemoteGraph(ssh).graph("h1");
  assert.equal(graph.home, "/root");
  assert.equal(updateCalls.length, 1); // 实测 home 回写台账（SFTP 围栏认这个家）
  assert.equal(graph.providers.length, 9);
  const claude = graph.providers.find((row) => row.cli === "claude" && row.file === ".claude/settings.json");
  assert.equal(claude.sourceId, "claude-settings");
  assert.equal(claude.exists, true);
  assert.equal(claude.model, "claude-opus-4-1");
  assert.equal(claude.baseUrl, "https://api.anthropic.com");
  const global = graph.providers.find((row) => row.file === ".claude.json");
  assert.equal(global.exists, false);
  assert.equal(global.model, null);
  const codex = graph.providers.find((row) => row.cli === "codex");
  assert.equal(codex.model, "gpt-5-codex");
  assert.equal(codex.wireApi, "responses");
  const kimi = graph.providers.find((row) => row.cli === "kimi");
  assert.equal(kimi.model, "kimi-code/k3-256k");
  assert.equal(kimi.baseUrl, "https://api.kimi.com/coding/v1");
  // api_key 字面量绝不出现在任何 provider 行（提取清单只认 model/base_url 等，且 safeField 兜底打码）
  assert.ok(!JSON.stringify(graph.providers).includes("sk-1234567890abcdef"));
  assert.equal(graph.capabilities.length, 5);
  assert.equal(graph.mcp.length, 2); // claude fs + codex docs
  assert.deepEqual(graph.mcp.map((entry) => entry.name).sort(), ["docs", "fs"]);
  assert.equal(graph.sources.length, 7);
  assert.equal(graph.backups.length, 1);
  assert.match(graph.backups[0].remote, /\/root\/\.codex\/config\.toml\.514forge-backup-/);
  // 清单非零退出：如实 REMOTE_GRAPH_FAILED
  const failing = createRemoteGraph(fakeSshGraph({
    execImpl: async (id, { command }) => command.includes("$HOME")
      ? { code: 0, stdout: "/root", stderr: "" }
      : { code: 2, stdout: "", stderr: "boom" },
  }));
  await assert.rejects(() => failing.graph("h1"), { code: "REMOTE_GRAPH_FAILED" });
});

test("remoteGraph.graph projects providerId from raw managed markers for Codex/Kimi/Grok/Gemini", async () => {
  const inventory = [
    "SRC|codex-config|yes|200|1700000100",
    "SRC|kimi-config|yes|200|1700000100",
    "SRC|grok-config|yes|200|1700000100",
    "SRC|gemini-env|yes|200|1700000100",
  ].join("\n");
  const reads = {
    "/root/.codex/config.toml": '# >>> 514-forge-provider (profile-codex) >>>\n[model_providers.forge]\nbase_url = "https://codex.example/v1"\n# <<< 514-forge-provider <<<\n',
    "/root/.kimi-code/config.toml": '# >>> 514-forge-provider (profile-kimi) >>>\n[providers."514cc:kimi"]\nbase_url = "https://kimi.example/v1"\n# <<< 514-forge-provider <<<\n',
    "/root/.grok/config.toml": '# >>> 514-forge-grokbuild-provider (profile-grok) >>>\n[model.forge]\nbase_url = "https://grok.example/v1"\n# <<< 514-forge-grokbuild-provider <<<\n',
    "/root/.gemini/.env": '# >>> 514-forge-provider (profile-gemini) >>>\nGOOGLE_GEMINI_BASE_URL=https://gemini.example\n# <<< 514-forge-provider <<<\n',
  };
  const readCalls = [];
  const graph = await createRemoteGraph(fakeSshGraph({
    reads,
    readCalls,
    execImpl: async (id, { command }) => command.includes("$HOME")
      ? { code: 0, stdout: "/root", stderr: "" }
      : { code: 0, stdout: inventory, stderr: "" },
  })).graph("h1");

  assert.equal(graph.providers.find((row) => row.cli === "codex").providerId, "profile-codex");
  assert.equal(graph.providers.find((row) => row.cli === "kimi").providerId, "profile-kimi");
  assert.equal(graph.providers.find((row) => row.cli === "grokbuild").providerId, "profile-grok");
  assert.equal(graph.providers.find((row) => row.cli === "gemini").providerId, "profile-gemini");
  assert.deepEqual(readCalls.map((call) => call.kind), ["raw", "raw", "raw", "raw"]);
});

test("remoteGraph.graph never promotes endpoint equality or malformed markers to providerId", async () => {
  const inventory = [
    "SRC|codex-config|yes|200|1700000100",
    "SRC|kimi-config|yes|200|1700000100",
    "SRC|grok-config|yes|200|1700000100",
    "SRC|gemini-env|yes|200|1700000100",
  ].join("\n");
  const sameEndpoint = "https://same.example/v1";
  const reads = {
    "/root/.codex/config.toml": `# >>> 514-forge-provider (profile-a) >>>\nbase_url = "${sameEndpoint}"\n`,
    "/root/.kimi-code/config.toml": `# >>> 514-forge-provider (profile-a) >>> forged\nbase_url = "${sameEndpoint}"\n# <<< 514-forge-provider <<<\n`,
    "/root/.grok/config.toml": `# >>> 514-forge-provider (profile-a) >>>\nbase_url = "${sameEndpoint}"\n# <<< 514-forge-provider <<<\n`,
    "/root/.gemini/.env": `GOOGLE_GEMINI_BASE_URL=${sameEndpoint}\n`,
  };
  const graph = await createRemoteGraph(fakeSshGraph({
    reads,
    execImpl: async (id, { command }) => command.includes("$HOME")
      ? { code: 0, stdout: "/root", stderr: "" }
      : { code: 0, stdout: inventory, stderr: "" },
  })).graph("h1");

  for (const cli of ["codex", "kimi", "grokbuild", "gemini"]) {
    const row = graph.providers.find((entry) => entry.cli === cli);
    assert.equal(row.baseUrl, sameEndpoint);
    assert.equal(row.providerId, null);
  }
});

test("remoteGraph.graph redacts assignment and URL-userinfo secrets from provider and MCP fields", async () => {
  const longPassword = "p".repeat(190);
  const reads = {
    "/root/.claude/settings.json": JSON.stringify({
      model: "password=abcdefghijklmnop",
      env: { ANTHROPIC_BASE_URL: `https://user:${longPassword}@example.com/v1` },
      mcpServers: { "token=abcdefghijklmnop": {} },
    }),
  };
  const graph = await createRemoteGraph(fakeSshGraph({ reads })).graph("h1");
  const serialized = JSON.stringify(graph);
  assert.equal(serialized.includes("abcdefghijklmnop"), false);
  assert.equal(serialized.includes(longPassword.slice(0, 40)), false);
  assert.match(serialized, /REDACTED/);
});

test("remoteGraph inventory fails honestly when base64 is unavailable", async () => {
  const commands = [];
  const ops = createRemoteGraph(fakeSshGraph({
    execImpl: async (id, { command }) => {
      commands.push(command);
      if (command.includes("$HOME")) return { code: 0, stdout: "/root", stderr: "" };
      return { code: 79, stdout: "", stderr: "base64 is required for remote inventory" };
    },
  }));
  await assert.rejects(() => ops.graph("h1"), { code: "REMOTE_GRAPH_FAILED", httpStatus: 502 });
  assert.match(commands.at(-1), /command -v base64/);
});

test("remoteGraph.readSource: 未知 id 400；SFTP_FAILED 如实 exists:false；命中回内容", async () => {
  const ops = createRemoteGraph(fakeSshGraph({ reads: READS }));
  await assert.rejects(() => ops.readSource("h1", "nope"), { code: "GRAPH_SOURCE_UNKNOWN" });
  const missing = await ops.readSource("h1", "claude-memory"); // fixture 里 sftpRead 未命中 → SFTP_FAILED
  assert.equal(missing.exists, false);
  assert.equal(missing.content, "");
  const hit = await ops.readSource("h1", "codex-config");
  assert.equal(hit.exists, true);
  assert.equal(hit.remote, "/root/.codex/config.toml");
  assert.match(hit.content, /gpt-5-codex/);
});

test("remoteGraph.readSource derives content and digest from one raw read and hard-hides credential containers", async () => {
  const reads = {
    "/root/.codex/config.toml": 'model = "new-version"\ntoken = "opaque-value"\n',
    "/root/.codex/auth.json": '{"session":"opaque-session-value-7f2c9e1a4d6b"}',
  };
  const readCalls = [];
  const ops = createRemoteGraph(fakeSshGraph({ reads, readCalls }));

  const config = await ops.readSource("h1", "codex-config");
  assert.match(config.content, /new-version/);
  assert.ok(!config.content.includes("opaque-value"));
  assert.equal(config.digest, createHash("sha256").update(reads["/root/.codex/config.toml"]).digest("hex"));
  assert.deepEqual(readCalls.filter((call) => call.path.endsWith("config.toml")).map((call) => call.kind), ["raw"]);

  const auth = await ops.readSource("h1", "codex-auth");
  assert.equal(auth.content, "");
  assert.equal(auth.contentHidden, true);
  assert.equal(auth.sensitive, true);
  assert.equal(auth.editable, false);
  assert.equal(auth.digest, null);
  assert.ok(!JSON.stringify(auth).includes("opaque-session-value"));
});

test("remoteGraph source editor: fixed Markdown sources use digest CAS, backup and atomic publish", async () => {
  const reads = new Map([["/root/.codex/AGENTS.md", "before\n"]]);
  const commands = [];
  const writes = [];
  const ssh = {
    async exec(id, { command }) {
      commands.push(command);
      if (command.includes("$HOME")) return { code: 0, stdout: "/root", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    async update() {},
    assertSftpPathPublic() {},
    async sftpRead(id, path) {
      if (!reads.has(path)) throw Object.assign(new Error("missing"), { code: "SFTP_FAILED" });
      return { content: reads.get(path), truncated: false };
    },
    async sftpReadRaw(id, path) {
      if (!reads.has(path)) throw Object.assign(new Error("missing"), { code: "SFTP_FAILED" });
      return { content: reads.get(path), truncated: false };
    },
    async sftpWrite(id, path, content, options) { writes.push({ id, path, content, options }); },
  };
  const ops = createRemoteGraph(ssh);
  const opened = await ops.readSource("h1", "codex-agents");
  assert.equal(opened.editable, true);
  assert.match(opened.digest, /^[a-f0-9]{64}$/);

  const result = await ops.writeSource("h1", "codex-agents", "after\n", opened.digest);
  assert.equal(result.created, false);
  assert.equal(result.bytes, 6);
  assert.match(result.backup, /\.514forge-backup-/);
  assert.equal(writes.length, 1);
  assert.match(writes[0].path, /\.514forge-[\w-]+\.tmp$/);
  assert.deepEqual(writes[0].options, { mode: 0o600, flags: "wx" });
  const publish = commands.find((command) => command.includes("mv -f --"));
  assert.match(publish, /sha256sum/);
  assert.match(publish, /shasum -a 256/);
  assert.match(publish, /staged=/);
  assert.match(publish, new RegExp(createHash("sha256").update("after\n").digest("hex")));
  assert.match(publish, /cp -p --/);
  assert.match(publish, /chmod 600/);
  assert.match(publish, /mv -f --/);
  const remote = "/root/.codex/AGENTS.md";
  const lockDigest = createHash("sha256").update(remote).digest("hex");
  assert.ok(commands.some((command) => command.includes("umask 077") && command.includes(`/root/.514forge-locks/${lockDigest}`)));
  assert.ok(commands.some((command) => command.startsWith("set -u") && command.includes("rmdir --") && command.includes(lockDigest)));

  await assert.rejects(() => ops.writeSource("h1", "codex-agents", "stale\n", "0".repeat(64)), { code: "GRAPH_SOURCE_CONFLICT" });
  await assert.rejects(() => ops.writeSource("h1", "codex-config", "x", "missing"), { code: "GRAPH_SOURCE_READ_ONLY" });
  await assert.rejects(() => ops.writeSource("h1", "codex-agents", "api_key=sk-secret-1234567890abcdef\n", opened.digest), { code: "GRAPH_SOURCE_SENSITIVE" });
});

test("remoteGraph source editor rejects a staged upload digest mismatch", async () => {
  const commands = [];
  const ssh = {
    async exec(id, { command }) {
      commands.push(command);
      if (command.includes("$HOME")) return { code: 0, stdout: "/root", stderr: "" };
      if (command.includes("mv -f --")) return { code: 76, stdout: "", stderr: "staged mismatch" };
      return { code: 0, stdout: "", stderr: "" };
    },
    async update() {},
    assertSftpPathPublic() {},
    async assertSftpResolvedPathPublic(id, path) { return path; },
    async sftpReadRaw() { return { content: "before\n", truncated: false }; },
    async sftpWrite() {},
  };
  const ops = createRemoteGraph(ssh);
  const opened = await ops.readSource("h1", "codex-agents");
  await assert.rejects(() => ops.writeSource("h1", "codex-agents", "after\n", opened.digest), {
    code: "GRAPH_SOURCE_STAGING_MISMATCH",
    httpStatus: 502,
  });
  assert.ok(commands.some((command) => command.startsWith("rm -f --") && command.includes(".tmp")));
});

test("remoteGraph source editor publishes through the canonical parent while preserving the final path component", async () => {
  const commands = [];
  const canonicalRemote = "/root/config/codex/AGENTS.md";
  const ssh = {
    async exec(id, { command }) {
      commands.push(command);
      if (command.includes("$HOME")) return { code: 0, stdout: "/root", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    async update() {},
    assertSftpPathPublic() {},
    async assertSftpResolvedPathPublic(id, path) {
      if (path === "/root/.codex") return "/root/config/codex";
      return path;
    },
    async sftpReadRaw(id, path) {
      assert.equal(path, canonicalRemote);
      return { content: "before\n", truncated: false };
    },
    async sftpWrite(id, path) { assert.ok(path.startsWith(`${canonicalRemote}.514forge-`)); },
  };
  const ops = createRemoteGraph(ssh);
  const opened = await ops.readSource("h1", "codex-agents");
  assert.equal(opened.remote, canonicalRemote);
  const result = await ops.writeSource("h1", "codex-agents", "after\n", opened.digest);
  assert.equal(result.remote, canonicalRemote);
  assert.ok(commands.some((command) => command.includes(`mv -f --`) && command.includes(`'${canonicalRemote}'`)));
});

test("remoteGraph source editor reports publish-time CAS conflicts and cleans the temp file", async () => {
  const commands = [];
  const ssh = {
    async exec(id, { command }) {
      commands.push(command);
      if (command.includes("$HOME")) return { code: 0, stdout: "/root", stderr: "" };
      if (command.includes("mv -f --")) return { code: 73, stdout: "", stderr: "changed" };
      return { code: 0, stdout: "", stderr: "" };
    },
    async update() {},
    assertSftpPathPublic() {},
    async sftpRead() { return { content: "before\n", truncated: false }; },
    async sftpReadRaw() { return { content: "before\n", truncated: false }; },
    async sftpWrite() {},
  };
  const ops = createRemoteGraph(ssh);
  const opened = await ops.readSource("h1", "codex-agents");
  await assert.rejects(() => ops.writeSource("h1", "codex-agents", "after\n", opened.digest), { code: "GRAPH_SOURCE_CONFLICT", httpStatus: 409 });
  assert.ok(commands.some((command) => command.startsWith("rm -f --") && command.includes(".tmp")));
});

test("remoteGraph source editor reports structured recovery state after SSH timeout", async () => {
  const commands = [];
  const ssh = {
    async exec(id, { command }) {
      commands.push(command);
      if (command.includes("$HOME")) return { code: 0, stdout: "/root", stderr: "" };
      if (command.includes("mv -f --")) throw Object.assign(new Error("timeout"), { code: "SSH_EXEC_TIMEOUT", httpStatus: 504 });
      return { code: 0, stdout: "", stderr: "" };
    },
    async update() {},
    assertSftpPathPublic() {},
    async sftpReadRaw() { return { content: "before\n", truncated: false }; },
    async sftpWrite() {},
  };
  const ops = createRemoteGraph(ssh);
  const opened = await ops.readSource("h1", "codex-agents");
  const error = await ops.writeSource("h1", "codex-agents", "after\n", opened.digest).catch((caught) => caught);
  assert.equal(error.code, "GRAPH_SOURCE_COMMIT_UNKNOWN");
  assert.equal(error.httpStatus, 503);
  assert.equal(error.recoveryRequired, true);
  assert.equal(error.retryable, false);
  assert.match(error.transactionId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(error.applied, []);
  assert.equal(error.uncertain.length, 1);
  assert.equal(error.uncertain[0].remote, "/root/.codex/AGENTS.md");
  assert.equal(error.uncertain[0].bytes, 6);
  assert.deepEqual(error.backups, [{ remote: "/root/.codex/AGENTS.md", backup: error.uncertain[0].backup }]);
  assert.equal(error.locks.length, 1);
  assert.equal(commands.some((command) => command.startsWith("rm -f --") && command.includes(".tmp")), false);
  assert.equal(commands.filter((command) => command.startsWith("set -u") && !command.includes("umask 077")).length, 0);
});

test("remoteGraph source editor rejects a concurrent writer before staging and releases the winning lock", async () => {
  const remote = "/root/.codex/AGENTS.md";
  const reads = new Map([[remote, "before\n"]]);
  const locks = new Set();
  const writes = [];
  const publishEntered = deferred();
  const allowPublish = deferred();
  let paused = false;
  const ssh = {
    async update() {},
    assertSftpPathPublic() {},
    async sftpReadRaw(id, path) {
      if (!reads.has(path)) throw Object.assign(new Error("missing"), { code: "SFTP_FAILED" });
      return { content: reads.get(path), truncated: false };
    },
    async sftpWrite(id, path, content, options) { writes.push({ path, content, options }); },
    async exec(id, { command }) {
      if (command.includes("$HOME")) return { code: 0, stdout: "/root", stderr: "" };
      if (command.includes("umask 077") && command.includes("mkdir --")) {
        const lock = command.match(/mkdir -- '([^']+)'/)?.[1];
        if (locks.has(lock)) return { code: 72, stdout: "", stderr: "locked" };
        locks.add(lock);
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command.startsWith("set -u") && command.includes("rmdir --")) {
        const lock = command.match(/rmdir -- '([^']+)'/)?.[1];
        locks.delete(lock);
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command.includes("staged=") && command.includes("mv -f --")) {
        if (!paused) {
          paused = true;
          publishEntered.resolve();
          await allowPublish.promise;
        }
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const ops = createRemoteGraph(ssh);
  const opened = await ops.readSource("h1", "codex-agents");
  const first = ops.writeSource("h1", "codex-agents", "first\n", opened.digest);
  await publishEntered.promise;

  const secondError = await ops.writeSource("h1", "codex-agents", "second\n", opened.digest).catch((caught) => caught);
  assert.equal(secondError.code, "REMOTE_CONFLICT");
  assert.equal(secondError.httpStatus, 409);
  assert.equal(writes.length, 1, "the conflicting graph write must not create a temp file");
  assert.equal(locks.size, 1);

  allowPublish.resolve();
  await first;
  assert.equal(locks.size, 0);
});

test("remoteGraph project scope: 项目配置/能力/MCP/真源叠加主机图谱，路径先过 SFTP 围栏", async () => {
  const projectPath = "/srv/new-api";
  const sourceLines = [
    "SRC|claude-settings|no||",
    "SRC|claude-global|no||",
    "SRC|codex-config|yes|200|1700000100",
    "SRC|kimi-config|no||",
    "SRC|gemini-settings|no||",
    "SRC|codex-agents|no||",
    "SRC|claude-memory|no||",
    "SRC|project-claude-settings|yes|80|1700000200",
    "SRC|project-claude-local-settings|no||",
    "SRC|project-codex-config|yes|90|1700000300",
    "SRC|project-mcp|yes|70|1700000400",
    "SRC|project-agents|yes|60|1700000500",
    "SRC|project-claude|no||",
    "SRC|project-rules|no||",
    "SRC|project-context|no||",
    "SRC|project-decisions|no||",
    "SRC|project-module|no||",
  ];
  const inventory = [
    `CAP64|skill|claude|${Buffer.from("global-skill").toString("base64")}`,
    `CAP64|project|skill|claude|${Buffer.from("project-skill").toString("base64")}`,
    `CAP64|project|agent|claude|${Buffer.from("project-reviewer").toString("base64")}`,
    ...sourceLines,
  ].join("\n");
  const reads = {
    "/root/.codex/config.toml": 'model = "global-model"\n',
    [`${projectPath}/.claude/settings.json`]: JSON.stringify({ model: "project-claude" }),
    [`${projectPath}/.codex/config.toml`]: 'model = "project-codex"\n[mcp_servers.project_docs]\ncommand = "x"\n',
    [`${projectPath}/.mcp.json`]: JSON.stringify({ mcpServers: { project_fs: {} } }),
    [`${projectPath}/AGENTS.md`]: "project instructions",
  };
  const pathChecks = [];
  const resolvedPathChecks = [];
  const commands = [];
  const ssh = fakeSshGraph({
    reads,
    pathChecks,
    resolvedPathChecks,
    execImpl: async (id, { command }) => {
      commands.push(command);
      return command.includes("$HOME")
        ? { code: 0, stdout: "/root", stderr: "" }
        : { code: 0, stdout: inventory, stderr: "" };
    },
  });
  const ops = createRemoteGraph(ssh);
  const graph = await ops.graph("h1", { projectPath });

  assert.deepEqual(graph.project, { path: projectPath });
  assert.deepEqual(pathChecks, [{ id: "h1", path: projectPath }]);
  assert.deepEqual(resolvedPathChecks, [{ id: "h1", path: "/root" }, { id: "h1", path: projectPath }]);
  assert.ok(commands.some((command) => command.includes("'/srv/new-api/.claude/skills'")));
  assert.ok(commands.some((command) => command.includes("'/srv/new-api/.codex/agents'")));
  assert.ok(commands.some((command) => command.includes("'/srv/new-api/.codex/skills'")));
  assert.equal(graph.providers.length, 12); // 主机 9 + 项目覆盖 3
  assert.equal(graph.providers.find((row) => row.file === ".codex/config.toml" && row.scope === "project")?.model, "project-codex");
  assert.equal(graph.providers.find((row) => row.file === ".codex/config.toml" && row.scope === "project")?.sourceId, "project-codex-config");
  assert.deepEqual(
    graph.capabilities.filter((cap) => cap.scope === "project").map((cap) => cap.name).sort(),
    ["project-reviewer", "project-skill"],
  );
  assert.deepEqual(graph.mcp.filter((entry) => entry.scope === "project").map((entry) => entry.name).sort(), ["project_docs", "project_fs"]);
  assert.equal(graph.sources.find((file) => file.id === "project-agents")?.remote, `${projectPath}/AGENTS.md`);
  assert.equal(graph.sources.find((file) => file.id === "project-agents")?.projectRelative, "AGENTS.md");

  const source = await ops.readSource("h1", "project-agents", { projectPath });
  assert.equal(source.remote, `${projectPath}/AGENTS.md`);
  assert.equal(source.content, "project instructions");
  await assert.rejects(() => ops.readSource("h1", "project-agents"), { code: "GRAPH_SOURCE_UNKNOWN" });
});

test("ssh routes: graph/graph-source 双门闸（ssh 默认 + sftp 叠加）与参数传递", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-graph-routes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const remoteGates = await createRemoteGateService({ dataRoot: dir }).init();
  const calls = [];
  let recoveryMode = false;
  setSshServiceForTest({ list: () => [], _initPromise: Promise.resolve() });
  setRemoteGraphForTest({
    async graph(id) { calls.push(["graph", id]); return { home: "/root", providers: [], capabilities: [], mcp: [], sources: [] }; },
    async readSource(id, file) { calls.push(["source", id, file]); return { id: file, exists: true, content: "x", truncated: false }; },
    async writeSource(id, file, content, digest, options) {
      calls.push(["write-source", id, file, content, digest]);
      if (recoveryMode) {
        throw Object.assign(new Error("manual recovery required; automated retry is blocked"), {
          code: "GRAPH_SOURCE_COMMIT_UNKNOWN",
          httpStatus: 503,
          recoveryRequired: true,
          // 事务身份由服务端生成：fixture 必须回传收到的 transactionId，否则恢复台账的
          // 身份校验（recovery-ledger.mjs registeredEvidence）会先以 502 拒绝这份证据。
          transactionId: options?.transactionId,
          applied: [],
          uncertain: [{ remote: "/root/.codex/AGENTS.md", backup: "/backup" }],
          backups: [{ remote: "/root/.codex/AGENTS.md", backup: "/backup" }],
          locks: ["/root/.514forge-locks/hash"],
        });
      }
      return { id: file, remote: "/root/.codex/AGENTS.md", bytes: content.length, digest: "new", backup: "/backup" };
    },
  });
  t.after(() => { setSshServiceForTest(null); setRemoteGraphForTest(null); });

  const routes = [];
  const router = {
    get: (prefix, handler) => routes.push({ method: "GET", prefix, handler }),
    post: (prefix, handler) => routes.push({ method: "POST", prefix, handler }),
    delete: (prefix, handler) => routes.push({ method: "DELETE", prefix, handler }),
  };
  let nextBody = {};
  const ctx = {
    state: { dataRoot: dir, eventStore: null },
    remoteGates,
    json(response, status, payload) { response.status = status; response.payload = payload; },
    async body() { return nextBody; },
  };
  registerSshRoutes(router, ctx);
  const dispatch = async (method, path) => {
    const url = new URL(path, "http://localhost");
    for (const route of routes) {
      if (route.method !== method || !url.pathname.startsWith(route.prefix)) continue;
      const response = {};
      if (await route.handler({}, response, url, ctx)) return response;
    }
    return null;
  };

  // 门闸未授权：graph / graph/source 全 501
  let response = await dispatch("GET", "/api/ssh/hosts/h1/graph");
  assert.equal(response.status, 501);
  assert.equal(response.payload.code, "REMOTE_GATE_BLOCKED");
  response = await dispatch("GET", "/api/ssh/hosts/h1/graph/source?file=codex-config");
  assert.equal(response.status, 501);

  // 只授权 ssh：sftp 叠加闸仍挡（读远端文件=env-sync 同款先例）
  await remoteGates.grant("ssh", { source: "test" });
  response = await dispatch("GET", "/api/ssh/hosts/h1/graph");
  assert.equal(response.status, 501);

  await remoteGates.grant("sftp", { source: "test" });
  response = await dispatch("GET", "/api/ssh/hosts/h1/graph");
  assert.equal(response.status, 200);
  assert.equal(response.payload.home, "/root");
  assert.deepEqual(calls.at(-1), ["graph", "h1"]);
  response = await dispatch("GET", "/api/ssh/hosts/h1/graph/source?file=codex-config");
  assert.equal(response.status, 200);
  assert.equal(response.payload.id, "codex-config");
  assert.deepEqual(calls.at(-1), ["source", "h1", "codex-config"]);
  nextBody = { file: "codex-agents", content: "updated", digest: "old" };
  response = await dispatch("POST", "/api/ssh/hosts/h1/graph/source");
  assert.equal(response.status, 200);
  assert.equal(response.payload.backup, "/backup");
  assert.deepEqual(calls.at(-1), ["write-source", "h1", "codex-agents", "updated", "old"]);
  recoveryMode = true;
  response = await dispatch("POST", "/api/ssh/hosts/h1/graph/source");
  assert.equal(response.status, 503);
  assert.match(response.payload.transactionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(response.payload.recoveryRequired, true);
  assert.equal(response.payload.retryable, false);
  assert.deepEqual(response.payload.uncertain, [{ remote: "/root/.codex/AGENTS.md", backup: "/backup" }]);
  assert.deepEqual(response.payload.locks, ["/root/.514forge-locks/hash"]);
});

test("ssh routes: graph/backup read and restore sit behind ssh+sftp and pass through source id and backup name", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-remote-backup-routes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const remoteGates = await createRemoteGateService({ dataRoot: dir }).init();
  const calls = [];
  setSshServiceForTest({ list: () => [], _initPromise: Promise.resolve() });
  setRemoteGraphForTest({
    async readBackup(id, file, name) {
      calls.push(["read-backup", id, file, name]);
      return { id: file, name, content: "old\n", digest: "d0", restorable: true };
    },
    async restoreBackup(id, file, name, digest, options) {
      calls.push(["restore-backup", id, file, name, digest, typeof options?.transactionId]);
      return { id: file, remote: "/root/.codex/AGENTS.md", bytes: 4, digest: "d1", backup: "/bak", restoredFrom: name };
    },
  });
  t.after(() => { setSshServiceForTest(null); setRemoteGraphForTest(null); });

  const routes = [];
  const router = {
    get: (prefix, handler) => routes.push({ method: "GET", prefix, handler }),
    post: (prefix, handler) => routes.push({ method: "POST", prefix, handler }),
    delete: (prefix, handler) => routes.push({ method: "DELETE", prefix, handler }),
  };
  let nextBody = {};
  const ctx = {
    state: { dataRoot: dir, eventStore: null },
    remoteGates,
    json(response, status, payload) { response.status = status; response.payload = payload; },
    async body() { return nextBody; },
  };
  registerSshRoutes(router, ctx);
  const dispatch = async (method, path) => {
    const url = new URL(path, "http://localhost");
    for (const route of routes) {
      if (route.method !== method || !url.pathname.startsWith(route.prefix)) continue;
      const response = {};
      if (await route.handler({}, response, url, ctx)) return response;
    }
    return null;
  };
  const backupPath = "/api/ssh/hosts/h1/graph/backup?file=codex-agents&name=AGENTS.md.514forge-backup-2f8c1d90";

  let response = await dispatch("GET", backupPath);
  assert.equal(response.status, 501);
  assert.equal(response.payload.code, "REMOTE_GATE_BLOCKED");
  await remoteGates.grant("ssh", { source: "test" });
  response = await dispatch("GET", backupPath); // 读远端文件叠加 sftp 闸，只授权 ssh 仍挡
  assert.equal(response.status, 501);
  await remoteGates.grant("sftp", { source: "test" });
  response = await dispatch("GET", backupPath);
  assert.equal(response.status, 200);
  assert.equal(response.payload.name, "AGENTS.md.514forge-backup-2f8c1d90");
  assert.deepEqual(calls.at(-1), ["read-backup", "h1", "codex-agents", "AGENTS.md.514forge-backup-2f8c1d90"]);

  nextBody = { file: "codex-agents", name: "AGENTS.md.514forge-backup-2f8c1d90", digest: "d0" };
  response = await dispatch("POST", "/api/ssh/hosts/h1/graph/backup/restore");
  assert.equal(response.status, 200);
  assert.equal(response.payload.restoredFrom, "AGENTS.md.514forge-backup-2f8c1d90");
  // 恢复登记为 graph 事务：transactionId 由服务端生成，客户端提交的只有备份名与当前 digest
  assert.deepEqual(calls.at(-1), ["restore-backup", "h1", "codex-agents", "AGENTS.md.514forge-backup-2f8c1d90", "d0", "string"]);
});

/* ===== 远端真源安全网：脱敏漂移只读 + 备份读取绑定 + 恢复走原文 ===== */

test("remoteGraph.readSource keeps a scrub-rewritten source read-only so [REDACTED] can never be saved back", async () => {
  // `token: short` 只有 5 字符：findSecretCandidates 的 12 字符门槛放行，scrubAssignments 照改。
  // 只按判敏结果开放编辑时，保存就把 [REDACTED] 写回远端真源——这条断言是该窄缝的机械基线。
  const raw = "# 说明\ntoken: short\n正文\n";
  const drifted = await createRemoteGraph(fakeSshGraph({ reads: { "/root/.codex/AGENTS.md": raw } })).readSource("h1", "codex-agents");
  assert.equal(drifted.sensitive, false); // 判敏放行——窄缝成立的前提
  assert.ok(drifted.content.includes("[REDACTED]"));
  assert.notEqual(drifted.content, raw);
  assert.equal(drifted.redacted, true);
  assert.equal(drifted.editable, false);

  // 收紧不是一刀切：原文未被改写的同类文档仍然可编辑，差异预览的基线因此等于远端字节。
  const clean = await createRemoteGraph(fakeSshGraph({ reads: { "/root/.codex/AGENTS.md": "# 纯文档\n正文\n" } })).readSource("h1", "codex-agents");
  assert.equal(clean.redacted, false);
  assert.equal(clean.editable, true);
  assert.equal(clean.content, "# 纯文档\n正文\n");
});

test("remoteGraph.readBackup binds the backup name to the source and refuses forged, traversing or symlinked names", async () => {
  const backup = "AGENTS.md.514forge-backup-2f8c1d90";
  const reads = {
    "/root/.codex/AGENTS.md": "current\n",
    [`/root/.codex/${backup}`]: "# 旧版\ntoken: short\n",
  };
  const pathChecks = [];
  const execCommands = [];
  const ops = createRemoteGraph(fakeSshGraph({
    reads,
    pathChecks,
    execImpl: async (id, { command }) => {
      execCommands.push(command);
      if (command.includes("$HOME")) return { code: 0, stdout: "/root", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  }));

  const read = await ops.readBackup("h1", "codex-agents", backup);
  assert.equal(read.remote, `/root/.codex/${backup}`);
  assert.equal(read.digest, createHash("sha256").update(reads[`/root/.codex/${backup}`]).digest("hex"));
  assert.ok(read.content.includes("[REDACTED]")); // HTTP 面只见脱敏投影
  assert.ok(!read.content.includes("short"));
  assert.equal(read.redacted, true);
  assert.equal(read.restorable, true); // 脱敏漂移不阻止恢复——写回的是服务端原文
  assert.ok(pathChecks.some((entry) => entry.path === `/root/.codex/${backup}`)); // SFTP 围栏实测覆盖备份路径
  assert.ok(execCommands.some((command) => command.includes("test ! -L")));

  for (const name of [
    "AGENTS.md.514forge-backup-../../.ssh/id_rsa",
    "CLAUDE.md.514forge-backup-2f8c1d90", // 别的真源的备份名
    "AGENTS.md.514forge-backup-", // 空 token
    "AGENTS.md.bak",
    "",
  ]) {
    await assert.rejects(() => ops.readBackup("h1", "codex-agents", name), { code: "GRAPH_BACKUP_UNKNOWN" }, `should reject ${name}`);
  }
  await assert.rejects(() => ops.readBackup("h1", "codex-auth", "auth.json.514forge-backup-2f8c1d90"), { code: "GRAPH_BACKUP_HIDDEN" });

  const missing = createRemoteGraph(fakeSshGraph({
    reads,
    execImpl: async (id, { command }) => (command.includes("$HOME")
      ? { code: 0, stdout: "/root", stderr: "" }
      : { code: 71, stdout: "", stderr: "" }),
  }));
  await assert.rejects(() => missing.readBackup("h1", "codex-agents", backup), { code: "GRAPH_BACKUP_MISSING" });

  const linked = createRemoteGraph(fakeSshGraph({
    reads,
    execImpl: async (id, { command }) => (command.includes("$HOME")
      ? { code: 0, stdout: "/root", stderr: "" }
      : { code: 74, stdout: "", stderr: "" }),
  }));
  await assert.rejects(() => linked.readBackup("h1", "codex-agents", backup), { code: "GRAPH_BACKUP_SYMLINK" });
});

test("remoteGraph.restoreBackup republishes the server-side raw bytes through the writeSource transaction", async () => {
  const backup = "AGENTS.md.514forge-backup-2f8c1d90";
  // 备份原文含 scrub 会改写的片段：如果恢复写的是脱敏投影，远端就会被 [REDACTED] 覆盖。
  const backupRaw = "# 旧版\ntoken: short\n";
  const reads = new Map([
    ["/root/.codex/AGENTS.md", "current\n"],
    [`/root/.codex/${backup}`, backupRaw],
  ]);
  const writes = [];
  let truncated = false;
  const ssh = {
    async exec(id, { command }) {
      if (command.includes("$HOME")) return { code: 0, stdout: "/root", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    async update() {},
    assertSftpPathPublic() {},
    async sftpRead(id, path) {
      if (!reads.has(path)) throw Object.assign(new Error("missing"), { code: "SFTP_FAILED" });
      return { content: reads.get(path), truncated: false };
    },
    async sftpReadRaw(id, path) {
      if (!reads.has(path)) throw Object.assign(new Error("missing"), { code: "SFTP_FAILED" });
      return { content: reads.get(path), truncated: truncated && path.includes("514forge-backup") };
    },
    async sftpWrite(id, path, content, options) { writes.push({ path, content, options }); },
  };
  const ops = createRemoteGraph(ssh);
  const current = await ops.readSource("h1", "codex-agents");

  const result = await ops.restoreBackup("h1", "codex-agents", backup, current.digest);
  assert.equal(result.restoredFrom, backup);
  assert.equal(result.digest, createHash("sha256").update(backupRaw).digest("hex"));
  assert.match(result.backup, /\.514forge-backup-/); // 恢复前的内容同样留下备份 → 恢复可再回滚
  assert.equal(writes.length, 1);
  assert.equal(writes[0].content, backupRaw); // ← 写回的是原文，不是浏览器看到的脱敏投影
  assert.ok(!writes[0].content.includes("[REDACTED]"));
  assert.deepEqual(writes[0].options, { mode: 0o600, flags: "wx" });

  // digest 不符 = 远端在对比之后被改过：恢复必须以 409 拒绝，不覆盖外部改动
  await assert.rejects(() => ops.restoreBackup("h1", "codex-agents", backup, "0".repeat(64)), { code: "GRAPH_SOURCE_CONFLICT" });
  // 只读真源即使备份名合法、内容可读，也不能借恢复通道写入
  reads.set("/root/.codex/config.toml", 'model = "x"\n');
  reads.set("/root/.codex/config.toml.514forge-backup-2f8c1d90", 'model = "old"\n');
  await assert.rejects(
    () => ops.restoreBackup("h1", "codex-config", "config.toml.514forge-backup-2f8c1d90", createHash("sha256").update('model = "x"\n').digest("hex")),
    { code: "GRAPH_SOURCE_READ_ONLY" },
  );

  truncated = true;
  await assert.rejects(() => ops.restoreBackup("h1", "codex-agents", backup, current.digest), { code: "GRAPH_BACKUP_TRUNCATED" });
  truncated = false;

  reads.set(`/root/.codex/${backup}`, "api_key = sk-secret-1234567890abcdef\n");
  await assert.rejects(() => ops.restoreBackup("h1", "codex-agents", backup, current.digest), { code: "GRAPH_BACKUP_SENSITIVE" });
});
