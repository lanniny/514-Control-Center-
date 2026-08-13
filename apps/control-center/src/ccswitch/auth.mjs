import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const AUTH_PROVIDERS = Object.freeze(["github_copilot", "codex_oauth", "xai_oauth"]);
const LOOPBACKS = new Set(["localhost", "127.0.0.1", "::1"]);
const MAX_RESPONSE_BYTES = 1024 * 1024;

const DEFAULT_CONFIGS = Object.freeze({
  github_copilot: {
    type: "device",
    clientId: "Iv1.b507a08c87ecfe98",
    scope: "read:user",
    deviceUrl: "https://github.com/login/device/code",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userUrl: "https://api.github.com/user",
    copilotTokenUrl: "https://api.github.com/copilot_internal/v2/token",
    modelsUrl: "https://api.githubcopilot.com/models",
    quotaUrl: "https://api.github.com/copilot_internal/user",
  },
  codex_oauth: {
    type: "codex-device",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    deviceUrl: "https://auth.openai.com/api/accounts/deviceauth/usercode",
    pollUrl: "https://auth.openai.com/api/accounts/deviceauth/token",
    tokenUrl: "https://auth.openai.com/oauth/token",
    verificationUri: "https://auth.openai.com/codex/device",
    redirectUri: "https://auth.openai.com/deviceauth/callback",
    modelsUrl: "https://chatgpt.com/backend-api/codex/models?client_version=3.18.0",
    quotaUrl: "https://chatgpt.com/backend-api/wham/usage",
  },
  xai_oauth: {
    type: "oidc-device",
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
    scope: "openid profile email offline_access grok-cli:access api:access",
    discoveryUrl: "https://auth.x.ai/.well-known/openid-configuration",
    modelsUrl: "https://api.x.ai/v1/models",
    quotaUrl: null,
  },
});

function fail(message, code = "AUTH_ERROR", httpStatus = 400) {
  throw Object.assign(new Error(message), { code, httpStatus });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return new Date().toISOString();
}

function providerName(value) {
  const provider = String(value ?? "").trim();
  if (!AUTH_PROVIDERS.includes(provider)) fail(`unsupported auth provider: ${provider}`, "AUTH_PROVIDER_UNSUPPORTED");
  return provider;
}

function assertUrl(value, label) {
  let url;
  try { url = new URL(String(value)); } catch { fail(`${label} is not a valid URL`, "AUTH_CONFIG_INVALID"); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACKS.has(url.hostname))) fail(`${label} must use https`, "AUTH_URL_FORBIDDEN", 403);
  if (url.username || url.password) fail(`${label} must not embed credentials`, "AUTH_URL_FORBIDDEN", 403);
  return url.href;
}

function emptyState() {
  return {
    version: 1,
    providers: Object.fromEntries(AUTH_PROVIDERS.map((provider) => [provider, { accounts: {}, defaultAccountId: null }])),
  };
}

function normalizeState(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("ccswitch-auth.json must contain an object", "AUTH_STORE_CORRUPT", 503);
  if (Number(raw.version ?? 1) !== 1) fail(`unsupported auth store version: ${raw.version}`, "AUTH_STORE_VERSION", 503);
  for (const provider of AUTH_PROVIDERS) {
    const source = raw.providers?.[provider];
    if (!source || typeof source !== "object") continue;
    if (source.accounts && typeof source.accounts === "object" && !Array.isArray(source.accounts)) state.providers[provider].accounts = source.accounts;
    if (typeof source.defaultAccountId === "string" && state.providers[provider].accounts[source.defaultAccountId]) state.providers[provider].defaultAccountId = source.defaultAccountId;
  }
  return state;
}

async function atomicWrite(target, content) {
  await mkdir(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  await writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
  await rename(temp, target);
}

function decodeJwt(token) {
  try {
    const payload = String(token).split(".")[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function publicAccount(provider, account, defaultAccountId) {
  return {
    id: account.id,
    provider,
    login: account.login,
    avatarUrl: account.avatarUrl ?? null,
    authenticatedAt: account.authenticatedAt,
    expiresAt: account.expiresAt ?? null,
    isDefault: account.id === defaultAccountId,
    requiresReauth: Boolean(account.requiresReauth),
    hasAccessToken: Boolean(account.accessToken),
    hasRefreshToken: Boolean(account.refreshToken),
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) fail("OAuth response exceeds 1 MiB", "AUTH_RESPONSE_TOO_LARGE", 502);
  try { return text ? JSON.parse(text) : {}; } catch { fail("OAuth response is not valid JSON", "AUTH_RESPONSE_INVALID", 502); }
}

export class CcSwitchAuthService {
  constructor({ dataRoot, fetchImpl = globalThis.fetch, providerConfigs = {} } = {}) {
    if (!dataRoot) fail("dataRoot is required", "AUTH_INIT_FAILED", 500);
    this.path = join(dataRoot, "ccswitch-auth.json");
    this.fetchImpl = fetchImpl;
    this.configs = Object.fromEntries(AUTH_PROVIDERS.map((provider) => [provider, { ...DEFAULT_CONFIGS[provider], ...(providerConfigs[provider] ?? {}) }]));
    this.state = emptyState();
    this.pending = new Map();
    this.storeStatus = { state: "missing", code: null, message: null };
    this.queue = Promise.resolve();
  }

  async init() {
    try {
      this.state = normalizeState(JSON.parse(await readFile(this.path, "utf8")));
      this.storeStatus = { state: "ready", code: null, message: null };
    } catch (error) {
      if (error?.code === "ENOENT") this.storeStatus = { state: "missing", code: null, message: null };
      else this.storeStatus = { state: "blocked", code: error?.code || "AUTH_STORE_UNREADABLE", message: String(error?.message || error).slice(0, 300) };
    }
    return this;
  }

  #assertWritable() {
    if (this.storeStatus.state === "blocked") fail(`CC-Switch auth store is blocked: ${this.storeStatus.message}`, this.storeStatus.code, 503);
  }

  #serialize(task) {
    const guarded = async () => { this.#assertWritable(); return task(); };
    const pending = this.queue.then(guarded, guarded);
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async #commit() {
    await atomicWrite(this.path, `${JSON.stringify(this.state, null, 2)}\n`);
    this.storeStatus = { state: "ready", code: null, message: null };
  }

  exportState() {
    return clone(this.state);
  }

  importState(raw) {
    const next = normalizeState(raw);
    return this.#serialize(async () => {
      this.state = next;
      await this.#commit();
      return this.statusAll();
    });
  }

  status(providerValue) {
    const provider = providerName(providerValue);
    const source = this.state.providers[provider];
    const accounts = Object.values(source.accounts).map((account) => publicAccount(provider, account, source.defaultAccountId));
    return { provider, authenticated: accounts.length > 0, defaultAccountId: source.defaultAccountId, accounts, pending: [...this.pending.values()].filter((item) => item.provider === provider).map((item) => ({ userCode: item.userCode, verificationUri: item.verificationUri, expiresAt: item.expiresAt, interval: item.interval })) };
  }

  statusAll() {
    return { providers: AUTH_PROVIDERS.map((provider) => this.status(provider)), storeStatus: { ...this.storeStatus } };
  }

  async #request(urlValue, init = {}) {
    const url = assertUrl(urlValue, "OAuth endpoint");
    let response;
    try { response = await this.fetchImpl(url, init); } catch (error) { fail(`OAuth request failed: ${error.message}`, "AUTH_NETWORK_FAILED", 502); }
    return response;
  }

  async #oidcEndpoints(config) {
    const response = await this.#request(config.discoveryUrl, { headers: { accept: "application/json" } });
    const document = await readJsonResponse(response);
    if (!response.ok) fail(`OIDC discovery returned HTTP ${response.status}`, "AUTH_DISCOVERY_FAILED", 502);
    return {
      deviceUrl: assertUrl(document.device_authorization_endpoint, "OIDC device authorization endpoint"),
      tokenUrl: assertUrl(document.token_endpoint, "OIDC token endpoint"),
    };
  }

  async startLogin(providerValue, options = {}) {
    const provider = providerName(providerValue);
    const config = { ...this.configs[provider] };
    if (options.endpoints && typeof options.endpoints === "object") {
      if (options.endpoints.deviceUrl) config.deviceUrl = assertUrl(options.endpoints.deviceUrl, "device endpoint");
      if (options.endpoints.pollUrl) config.pollUrl = assertUrl(options.endpoints.pollUrl, "poll endpoint");
      if (options.endpoints.tokenUrl) config.tokenUrl = assertUrl(options.endpoints.tokenUrl, "token endpoint");
      if (options.endpoints.discoveryUrl) config.discoveryUrl = assertUrl(options.endpoints.discoveryUrl, "discovery endpoint");
    }
    if (config.type === "oidc-device") Object.assign(config, await this.#oidcEndpoints(config));
    let response;
    if (config.type === "codex-device") {
      response = await this.#request(config.deviceUrl, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "user-agent": "514cc-ccswitch-auth" }, body: JSON.stringify({ client_id: config.clientId }) });
    } else {
      const form = new URLSearchParams({ client_id: config.clientId, scope: config.scope || "" });
      response = await this.#request(config.deviceUrl, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "514cc-ccswitch-auth" }, body: form });
    }
    const payload = await readJsonResponse(response);
    if (!response.ok) fail(`device authorization returned HTTP ${response.status}: ${payload.error_description || payload.error || "unknown error"}`, "AUTH_DEVICE_FAILED", 502);
    const deviceCode = String(payload.device_code ?? payload.device_auth_id ?? "");
    const userCode = String(payload.user_code ?? "");
    if (!deviceCode || !userCode) fail("device authorization response is missing codes", "AUTH_RESPONSE_INVALID", 502);
    const expiresIn = Math.max(1, Math.min(86_400, Number(payload.expires_in ?? 900) || 900));
    const interval = Math.max(1, Math.min(60, Number(payload.interval ?? 5) || 5));
    const pending = {
      provider,
      deviceCode,
      userCode,
      verificationUri: String(payload.verification_uri_complete ?? payload.verification_uri ?? config.verificationUri ?? ""),
      expiresAt: Date.now() + expiresIn * 1000,
      interval,
      nextPollAt: 0,
      config,
    };
    this.pending.set(`${provider}:${deviceCode}`, pending);
    return { provider, deviceCode, userCode, verificationUri: pending.verificationUri, expiresIn, interval };
  }

  async pollLogin(providerValue, deviceCodeValue) {
    const provider = providerName(providerValue);
    const deviceCode = String(deviceCodeValue ?? "");
    const key = `${provider}:${deviceCode}`;
    const pending = this.pending.get(key);
    if (!pending) fail("device login flow was not found", "AUTH_FLOW_NOT_FOUND", 404);
    if (pending.expiresAt <= Date.now()) {
      this.pending.delete(key);
      fail("device code expired", "AUTH_EXPIRED", 410);
    }
    if (pending.nextPollAt > Date.now()) return { status: "pending", retryAfterMs: pending.nextPollAt - Date.now() };
    pending.nextPollAt = Date.now() + pending.interval * 1000;
    const config = pending.config;
    let response;
    let payload;
    if (config.type === "codex-device") {
      response = await this.#request(config.pollUrl, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "user-agent": "514cc-ccswitch-auth" }, body: JSON.stringify({ device_auth_id: deviceCode, user_code: pending.userCode }) });
      if ([403, 404].includes(response.status)) return { status: "pending", retryAfterMs: pending.interval * 1000 };
      if (response.status === 410) { this.pending.delete(key); fail("device code expired", "AUTH_EXPIRED", 410); }
      payload = await readJsonResponse(response);
      if (!response.ok) fail(`device poll returned HTTP ${response.status}`, "AUTH_POLL_FAILED", 502);
      const tokenForm = new URLSearchParams({ grant_type: "authorization_code", code: String(payload.authorization_code ?? ""), redirect_uri: config.redirectUri, client_id: config.clientId, code_verifier: String(payload.code_verifier ?? "") });
      response = await this.#request(config.tokenUrl, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "514cc-ccswitch-auth" }, body: tokenForm });
      payload = await readJsonResponse(response);
    } else {
      const form = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: config.clientId, device_code: deviceCode });
      response = await this.#request(config.tokenUrl, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "514cc-ccswitch-auth" }, body: form });
      payload = await readJsonResponse(response);
    }
    const oauthError = String(payload.error ?? "");
    if (oauthError === "authorization_pending" || oauthError === "slow_down") {
      if (oauthError === "slow_down") pending.interval = Math.min(60, pending.interval + 5);
      return { status: "pending", retryAfterMs: pending.interval * 1000 };
    }
    if (oauthError === "access_denied") { this.pending.delete(key); fail("authorization was denied", "AUTH_DENIED", 403); }
    if (oauthError === "expired_token") { this.pending.delete(key); fail("device code expired", "AUTH_EXPIRED", 410); }
    if (!response.ok || !payload.access_token) fail(`token endpoint returned HTTP ${response.status}: ${payload.error_description || oauthError || "missing access token"}`, "AUTH_TOKEN_FAILED", 502);
    const identity = await this.#identity(provider, payload.access_token, payload.id_token, config);
    const account = {
      id: identity.id,
      login: identity.login,
      avatarUrl: identity.avatarUrl ?? null,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      tokenType: payload.token_type ?? "Bearer",
      expiresAt: payload.expires_in ? Date.now() + Number(payload.expires_in) * 1000 : null,
      authenticatedAt: now(),
      requiresReauth: false,
      metadata: identity.metadata ?? {},
    };
    await this.#serialize(async () => {
      const source = this.state.providers[provider];
      source.accounts[account.id] = account;
      if (!source.defaultAccountId) source.defaultAccountId = account.id;
      await this.#commit();
    });
    this.pending.delete(key);
    return { status: "authenticated", account: publicAccount(provider, account, this.state.providers[provider].defaultAccountId) };
  }

  async #identity(provider, accessToken, idToken, config) {
    if (provider === "github_copilot") {
      const response = await this.#request(config.userUrl, { headers: { accept: "application/json", authorization: `Bearer ${accessToken}`, "user-agent": "514cc-ccswitch-auth" } });
      const payload = await readJsonResponse(response);
      if (!response.ok || payload.id == null) fail("GitHub account lookup failed", "AUTH_IDENTITY_FAILED", 502);
      return { id: String(payload.id), login: String(payload.login ?? payload.id), avatarUrl: payload.avatar_url ?? null, metadata: { githubDomain: new URL(config.userUrl).hostname } };
    }
    const claims = { ...decodeJwt(accessToken), ...decodeJwt(idToken) };
    const openai = claims["https://api.openai.com/auth"] ?? {};
    const id = String(claims.chatgpt_account_id ?? openai.chatgpt_account_id ?? claims.sub ?? "");
    if (!id) fail("OAuth token contains no stable account id", "AUTH_IDENTITY_FAILED", 502);
    return { id, login: String(claims.email ?? claims.preferred_username ?? claims.name ?? id.slice(0, 12)), metadata: {} };
  }

  #account(provider, accountId = null) {
    const source = this.state.providers[provider];
    const id = String(accountId || source.defaultAccountId || "");
    const account = source.accounts[id];
    if (!account) fail(`auth account not found: ${id || "default"}`, "AUTH_ACCOUNT_NOT_FOUND", 404);
    return account;
  }

  async #validToken(provider, account) {
    if (!account.expiresAt || account.expiresAt - Date.now() > 60_000) return account.accessToken;
    if (!account.refreshToken) {
      account.requiresReauth = true;
      await this.#serialize(async () => this.#commit());
      fail("account requires reauthentication", "AUTH_REAUTH_REQUIRED", 401);
    }
    const config = this.configs[provider];
    let tokenUrl = config.tokenUrl;
    if (config.type === "oidc-device") tokenUrl = (await this.#oidcEndpoints(config)).tokenUrl;
    const form = new URLSearchParams({ grant_type: "refresh_token", client_id: config.clientId, refresh_token: account.refreshToken });
    const response = await this.#request(tokenUrl, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "514cc-ccswitch-auth" }, body: form });
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.access_token) {
      account.requiresReauth = true;
      await this.#serialize(async () => this.#commit());
      fail("refresh token was rejected", "AUTH_REAUTH_REQUIRED", 401);
    }
    account.accessToken = payload.access_token;
    account.refreshToken = payload.refresh_token || account.refreshToken;
    account.expiresAt = Date.now() + Number(payload.expires_in ?? 3600) * 1000;
    account.requiresReauth = false;
    await this.#serialize(async () => this.#commit());
    return account.accessToken;
  }

  setDefault(providerValue, accountIdValue) {
    const provider = providerName(providerValue);
    const id = String(accountIdValue ?? "");
    return this.#serialize(async () => {
      if (!this.state.providers[provider].accounts[id]) fail(`auth account not found: ${id}`, "AUTH_ACCOUNT_NOT_FOUND", 404);
      this.state.providers[provider].defaultAccountId = id;
      await this.#commit();
      return this.status(provider);
    });
  }

  removeAccount(providerValue, accountIdValue, { confirmed = false } = {}) {
    const provider = providerName(providerValue);
    if (confirmed !== true) fail("removing an OAuth account requires confirmed: true", "CONFIRMATION_REQUIRED", 409);
    const id = String(accountIdValue ?? "");
    return this.#serialize(async () => {
      const source = this.state.providers[provider];
      if (!source.accounts[id]) fail(`auth account not found: ${id}`, "AUTH_ACCOUNT_NOT_FOUND", 404);
      delete source.accounts[id];
      if (source.defaultAccountId === id) source.defaultAccountId = Object.keys(source.accounts)[0] ?? null;
      await this.#commit();
      return this.status(provider);
    });
  }

  logout(providerValue, { confirmed = false } = {}) {
    const provider = providerName(providerValue);
    if (confirmed !== true) fail("OAuth logout requires confirmed: true", "CONFIRMATION_REQUIRED", 409);
    return this.#serialize(async () => {
      this.state.providers[provider] = { accounts: {}, defaultAccountId: null };
      for (const key of [...this.pending.keys()]) if (key.startsWith(`${provider}:`)) this.pending.delete(key);
      await this.#commit();
      return this.status(provider);
    });
  }

  async #copilotToken(account, config) {
    if (!config.copilotTokenUrl) return this.#validToken("github_copilot", account);
    if (account.metadata?.copilotToken && Number(account.metadata.copilotExpiresAt) - Date.now() > 60_000) return account.metadata.copilotToken;
    const githubToken = await this.#validToken("github_copilot", account);
    const response = await this.#request(config.copilotTokenUrl, { headers: { accept: "application/json", authorization: `token ${githubToken}`, "user-agent": "514cc-ccswitch-auth" } });
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.token) fail("Copilot token exchange failed", "AUTH_RESOURCE_FAILED", 502);
    account.metadata = { ...(account.metadata ?? {}), copilotToken: payload.token, copilotExpiresAt: Number(payload.expires_at ?? 0) * 1000 || Date.now() + 20 * 60_000 };
    await this.#serialize(async () => this.#commit());
    return payload.token;
  }

  async resource(providerValue, kindValue, accountId = null) {
    const provider = providerName(providerValue);
    const kind = kindValue === "models" || kindValue === "quota" ? kindValue : fail("auth resource must be models or quota", "VALIDATION_FAILED");
    const config = this.configs[provider];
    const url = config[kind === "models" ? "modelsUrl" : "quotaUrl"];
    if (!url) fail(`${kind} is not available for ${provider}`, "AUTH_RESOURCE_UNAVAILABLE", 404);
    const account = this.#account(provider, accountId);
    let token = await this.#validToken(provider, account);
    const headers = { accept: "application/json", "user-agent": "514cc-ccswitch-auth" };
    if (provider === "github_copilot" && kind === "models") {
      token = await this.#copilotToken(account, config);
      headers.authorization = `Bearer ${token}`;
      headers["copilot-integration-id"] = "vscode-chat";
      headers["editor-version"] = "vscode/1.95.0";
      headers["editor-plugin-version"] = "copilot-chat/0.22.0";
    } else if (provider === "github_copilot") headers.authorization = `token ${token}`;
    else headers.authorization = `Bearer ${token}`;
    if (provider === "codex_oauth") {
      headers["chatgpt-account-id"] = account.id;
      if (kind === "models") headers.originator = "cc-switch";
    }
    const response = await this.#request(url, { headers });
    const payload = await readJsonResponse(response);
    if (!response.ok) fail(`${provider} ${kind} returned HTTP ${response.status}`, "AUTH_RESOURCE_FAILED", 502);
    return { provider, accountId: account.id, kind, payload };
  }
}

export const ccswitchAuthInternals = Object.freeze({ DEFAULT_CONFIGS, decodeJwt, normalizeState });
