import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CcSwitchAuthService } from "../src/ccswitch/auth.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

function jwt(claims) {
  return `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.x`;
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose) => {
      server.close(resolveClose);
      server.closeAllConnections?.();
    }),
  };
}

async function fixture(t, configs) {
  const root = await mkdtemp(resolve(appRoot, ".test-ccswitch-auth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = join(root, "data");
  await mkdir(dataRoot, { recursive: true });
  const auth = await new CcSwitchAuthService({ dataRoot, providerConfigs: configs }).init();
  return { root, dataRoot, auth };
}

test("GitHub Copilot 设备流：多账号状态、模型/额度真实请求且 token 永不回显", async (t) => {
  const seen = [];
  const remote = await listen(async (request, response) => {
    seen.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
    if (request.url === "/device") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ device_code: "gh-device", user_code: "ABCD-EFGH", verification_uri: `${remote.origin}/verify`, expires_in: 900, interval: 1 }));
      return;
    }
    if (request.url === "/token") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ access_token: "github-secret-token", token_type: "bearer" }));
      return;
    }
    if (request.url === "/user") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: 42, login: "octocat", avatar_url: "https://example.com/avatar.png" }));
      return;
    }
    if (request.url === "/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "gpt-test", model_picker_enabled: true }] }));
      return;
    }
    if (request.url === "/quota") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ copilot_plan: "individual", quota_snapshots: {} }));
      return;
    }
    response.writeHead(404); response.end();
  });
  t.after(remote.close);
  const { auth, dataRoot } = await fixture(t, {
    github_copilot: {
      deviceUrl: `${remote.origin}/device`, tokenUrl: `${remote.origin}/token`, userUrl: `${remote.origin}/user`,
      copilotTokenUrl: null, modelsUrl: `${remote.origin}/models`, quotaUrl: `${remote.origin}/quota`,
    },
  });
  const flow = await auth.startLogin("github_copilot");
  assert.equal(flow.userCode, "ABCD-EFGH");
  const result = await auth.pollLogin("github_copilot", flow.deviceCode);
  assert.equal(result.status, "authenticated");
  assert.equal(result.account.login, "octocat");
  assert.equal(result.account.hasAccessToken, true);
  assert.equal(JSON.stringify(auth.statusAll()).includes("github-secret-token"), false);
  assert.equal((await auth.resource("github_copilot", "models")).payload.data[0].id, "gpt-test");
  assert.equal((await auth.resource("github_copilot", "quota")).payload.copilot_plan, "individual");
  assert.ok(seen.some((item) => item.url === "/models" && item.authorization === "Bearer github-secret-token"));
  const disk = await readFile(join(dataRoot, "ccswitch-auth.json"), "utf8");
  assert.ok(disk.includes("github-secret-token"), "credential stays in the private server-side store");
});

test("Codex OAuth 自定义两阶段设备流：pending、code exchange、账号头和资源回读", async (t) => {
  let pollCount = 0;
  const seen = [];
  const remote = await listen(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({ url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
    if (request.url === "/device") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ device_auth_id: "codex-device", user_code: "OPEN-AI", interval: 1, expires_in: 900 }));
      return;
    }
    if (request.url === "/poll") {
      pollCount += 1;
      if (pollCount === 1) { response.writeHead(403); response.end(); return; }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ authorization_code: "auth-code", code_verifier: "verifier" }));
      return;
    }
    if (request.url === "/token") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ access_token: jwt({ sub: "user-sub" }), id_token: jwt({ chatgpt_account_id: "acct-123", email: "lo@example.com" }), refresh_token: "refresh-secret", expires_in: 3600 }));
      return;
    }
    if (request.url.startsWith("/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [{ slug: "gpt-5.6" }] }));
      return;
    }
    if (request.url === "/quota") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ rate_limit: { primary_window: { used_percent: 12 } } }));
      return;
    }
    response.writeHead(404); response.end();
  });
  t.after(remote.close);
  const { auth } = await fixture(t, {
    codex_oauth: {
      deviceUrl: `${remote.origin}/device`, pollUrl: `${remote.origin}/poll`, tokenUrl: `${remote.origin}/token`,
      verificationUri: `${remote.origin}/verify`, redirectUri: `${remote.origin}/callback`, modelsUrl: `${remote.origin}/models`, quotaUrl: `${remote.origin}/quota`,
    },
  });
  const flow = await auth.startLogin("codex_oauth");
  const pending = await auth.pollLogin("codex_oauth", flow.deviceCode);
  assert.equal(pending.status, "pending");
  auth.pending.get(`codex_oauth:${flow.deviceCode}`).nextPollAt = 0;
  const loggedIn = await auth.pollLogin("codex_oauth", flow.deviceCode);
  assert.equal(loggedIn.account.id, "acct-123");
  assert.equal(loggedIn.account.login, "lo@example.com");
  assert.match(seen.find((item) => item.url === "/token").body, /grant_type=authorization_code/);
  await auth.resource("codex_oauth", "models");
  await auth.resource("codex_oauth", "quota");
  const resourceRequests = seen.filter((item) => item.url.startsWith("/models") || item.url === "/quota");
  assert.ok(resourceRequests.every((item) => item.headers["chatgpt-account-id"] === "acct-123"));
  assert.equal(resourceRequests.find((item) => item.url.startsWith("/models")).headers.originator, "cc-switch");
});

test("xAI OIDC discovery 设备流：发现端点、JWT 身份和模型列表", async (t) => {
  const remote = await listen(async (request, response) => {
    if (request.url === "/.well-known/openid-configuration") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ issuer: remote.origin, device_authorization_endpoint: `${remote.origin}/device`, token_endpoint: `${remote.origin}/token` }));
      return;
    }
    if (request.url === "/device") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ device_code: "xai-device", user_code: "XAI-CODE", verification_uri: `${remote.origin}/verify`, interval: 1, expires_in: 600 }));
      return;
    }
    if (request.url === "/token") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ access_token: jwt({ sub: "xai-1", preferred_username: "lo-xai" }), refresh_token: "xai-refresh", expires_in: 3600 }));
      return;
    }
    if (request.url === "/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "grok-4" }] }));
      return;
    }
    response.writeHead(404); response.end();
  });
  t.after(remote.close);
  const { auth } = await fixture(t, { xai_oauth: { discoveryUrl: `${remote.origin}/.well-known/openid-configuration`, modelsUrl: `${remote.origin}/models` } });
  const flow = await auth.startLogin("xai_oauth");
  const loggedIn = await auth.pollLogin("xai_oauth", flow.deviceCode);
  assert.equal(loggedIn.account.id, "xai-1");
  assert.equal((await auth.resource("xai_oauth", "models")).payload.data[0].id, "grok-4");
  await assert.rejects(() => auth.resource("xai_oauth", "quota"), (error) => error.code === "AUTH_RESOURCE_UNAVAILABLE");
});

test("账户删除/注销确认门与损坏存储冻结", async (t) => {
  const remote = await listen(async (request, response) => {
    if (request.url === "/device") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ device_code: "d", user_code: "u", verification_uri: `${remote.origin}/v`, expires_in: 60, interval: 1 })); return; }
    if (request.url === "/token") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ access_token: "token" })); return; }
    if (request.url === "/user") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ id: 7, login: "seven" })); return; }
    response.writeHead(404); response.end();
  });
  t.after(remote.close);
  const { auth, dataRoot } = await fixture(t, { github_copilot: { deviceUrl: `${remote.origin}/device`, tokenUrl: `${remote.origin}/token`, userUrl: `${remote.origin}/user` } });
  const flow = await auth.startLogin("github_copilot");
  await auth.pollLogin("github_copilot", flow.deviceCode);
  assert.throws(() => auth.removeAccount("github_copilot", "7"), (error) => error.code === "CONFIRMATION_REQUIRED");
  await auth.removeAccount("github_copilot", "7", { confirmed: true });
  assert.equal(auth.status("github_copilot").authenticated, false);
  assert.throws(() => auth.logout("github_copilot"), (error) => error.code === "CONFIRMATION_REQUIRED");

  const path = join(dataRoot, "ccswitch-auth.json");
  await writeFile(path, "{broken", "utf8");
  const blocked = await new CcSwitchAuthService({ dataRoot }).init();
  assert.equal(blocked.statusAll().storeStatus.state, "blocked");
  await assert.rejects(() => blocked.importState({ version: 1, providers: {} }), (error) => error.httpStatus === 503);
  assert.equal(await readFile(path, "utf8"), "{broken");
});
