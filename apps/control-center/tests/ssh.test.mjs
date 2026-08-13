import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, createHmac } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createSshService } from "../src/ssh.mjs";
import { discoverSshHosts, expandIdentityPath, matchConfigEntry, parseSshConfig } from "../src/ssh/discover.mjs";
import { fingerprintOfKeyBlob, matchKnownHost, parseKnownHosts } from "../src/ssh/known-hosts.mjs";

/** fake ssh2 Client：事件发射 + exec/sftp 行为脚本化，不连真网。 */
function fakeClientFactory(behavior = {}) {
  const created = [];
  const factory = (config, onHostKey) => {
    const client = new EventEmitter();
    client.config = config;
    client.execCalls = [];
    client.execStreams = [];
    client.connect = (connectConfig) => {
      client.connectConfig = connectConfig;
      if (onHostKey && behavior.fingerprint) onHostKey(behavior.fingerprint);
      setImmediate(() => {
        if (behavior.connectError) {
          client.emit("error", new Error(behavior.connectError));
          // 真实 ssh2 认证回退链会多次 emit('error')（agent 初始化失败→继续→最终失败）；
          // 第二次到来时 once 监听已消耗——无监听器即 EventEmitter throw 杀进程（LO「闪退」根因）
          setImmediate(() => client.emit("error", new Error(`${behavior.connectError} (fallback chain)`)));
        } else {
          client.emit("ready");
        }
      });
    };
    client.end = () => { client.ended = true; };
    client.exec = (command, callback) => {
      client.execCalls.push(command);
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      stream.close = () => { stream.closed = true; };
      stream.destroy = () => { stream.destroyed = true; };
      client.execStreams.push(stream);
      callback(null, stream);
      if (behavior.execNeverCloses) return;
      setImmediate(() => {
        stream.emit("data", Buffer.from(behavior.stdout ?? `ok:${command}`));
        stream.emit("close", behavior.exitCode ?? 0);
      });
    };
    client.sftp = (callback) => {
      const listing = behavior.listing ?? [{ filename: "a.txt", attrs: { size: 5, isDirectory: () => false, mtime: 1 } }];
      callback(null, {
        readdir: (path, cb) => cb(null, listing),
        realpath: (path, cb) => {
          const resolved = behavior.realpaths?.[path] ?? path;
          if (resolved instanceof Error) cb(resolved);
          else cb(null, resolved);
        },
        createReadStream: () => {
          const stream = new EventEmitter();
          setImmediate(() => {
            stream.emit("data", Buffer.from(behavior.fileContent ?? "hello"));
            stream.emit("end");
          });
          return stream;
        },
        createWriteStream: (path, options) => {
          client.lastWrite = { path, options };
          const stream = new EventEmitter();
          stream.end = () => setImmediate(() => stream.emit("close"));
          return stream;
        },
      });
    };
    created.push(client);
    return client;
  };
  factory.created = created;
  return factory;
}

async function fixture(t, behavior = {}) {
  const dir = await mkdtemp(join(tmpdir(), "514cc-ssh-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const clientFactory = fakeClientFactory(behavior);
  // 密封：默认 identityProvider 会读真实 ~/.ssh，测试一律注入空提供器
  const service = await createSshService({ dataRoot: dir, clientFactory, identityProvider: async () => null }).init();
  t.after(() => service.close());
  return { dir, service, clientFactory };
}

test("ssh: host CRUD keeps secrets off the API and on disk separately", async (t) => {
  const { dir, service } = await fixture(t);
  const host = await service.create({ name: "盒", host: "10.0.0.8", user: "lo", auth: { password: "p@ss" } });
  assert.equal(host.hasSecret, true);
  assert.equal(host.authRef, "***");
  assert.ok(!("password" in host));

  const hostsOnDisk = JSON.parse(await readFile(join(dir, "ssh-hosts.json"), "utf8"));
  assert.ok(!JSON.stringify(hostsOnDisk).includes("p@ss"));
  const secretsOnDisk = JSON.parse(await readFile(join(dir, "ssh-secrets.json"), "utf8"));
  assert.ok(JSON.stringify(secretsOnDisk).includes("p@ss"));

  assert.equal(service.list().length, 1);
  assert.equal(await service.remove(host.id), true);
  const after = JSON.parse(await readFile(join(dir, "ssh-secrets.json"), "utf8"));
  assert.equal(after.secrets.length, 0);
});

test("ssh: fingerprint three-state — unconfirmed, trusted, changed", async (t) => {
  const { service } = await fixture(t, { fingerprint: "SHA256:AAA" });
  const host = await service.create({ host: "10.0.0.9", user: "lo" });
  // 未信任：带指纹连接 → UNCONFIRMED
  await assert.rejects(
    () => service.exec(host.id, { command: "uptime", hostKeyFingerprint: "SHA256:AAA" }),
    { code: "SSH_HOSTKEY_UNCONFIRMED" },
  );
  // 信任后放行
  await service.trust(host.id, "SHA256:AAA");
  const result = await service.exec(host.id, { command: "uptime", hostKeyFingerprint: "SHA256:AAA" });
  assert.equal(result.code, 0);
  // 指纹变更：拒绝
  await assert.rejects(
    () => service.exec(host.id, { command: "uptime", hostKeyFingerprint: "SHA256:BBB" }),
    { code: "SSH_HOSTKEY_CHANGED" },
  );
});

test("ssh: exec caps timeout and output flows through redaction", async (t) => {
  const { service } = await fixture(t, { fingerprint: "SHA256:X", stdout: "token=abc123secret" });
  const host = await service.create({ host: "h", user: "u" });
  await service.trust(host.id, "SHA256:X");
  const result = await service.exec(host.id, { command: "env", hostKeyFingerprint: "SHA256:X" });
  assert.equal(result.code, 0);
  assert.ok(!result.stdout.includes("abc123secret"), "secret-looking assignment scrubbed");
});

test("ssh: connection pool reuses a live client within idle window", async (t) => {
  const { service, clientFactory } = await fixture(t, { fingerprint: "SHA256:P" });
  const host = await service.create({ host: "h", user: "u" });
  await service.trust(host.id, "SHA256:P");
  const first = await service.exec(host.id, { command: "a", hostKeyFingerprint: "SHA256:P" });
  const second = await service.exec(host.id, { command: "b", hostKeyFingerprint: "SHA256:P" });
  assert.equal(first.code, 0);
  assert.equal(second.code, 0);
  assert.equal(clientFactory.created.length, 1, "second exec reused pooled client");
});

test("ssh: sftp path boundary refuses escape before any remote call", async (t) => {
  const { service, clientFactory } = await fixture(t, { fingerprint: "SHA256:S" });
  const host = await service.create({ host: "h", user: "u", rootAllowlist: ["/srv/data"] });
  await service.trust(host.id, "SHA256:S");
  await assert.rejects(
    () => service.sftpList(host.id, "/etc", { hostKeyFingerprint: "SHA256:S" }),
    { code: "SFTP_PATH_BOUNDARY" },
  );
  await assert.rejects(
    () => service.sftpRead(host.id, "/srv/data/../../etc/passwd", { hostKeyFingerprint: "SHA256:S" }),
    { code: "SFTP_PATH_BOUNDARY" },
  );
  const items = await service.sftpList(host.id, "/srv/data", { hostKeyFingerprint: "SHA256:S" });
  assert.equal(items[0].name, "a.txt");
  const file = await service.sftpRead(host.id, "/srv/data/a.txt", { hostKeyFingerprint: "SHA256:S" });
  assert.equal(file.content, "hello");
  const write = await service.sftpWrite(host.id, "/srv/data/b.txt", "内容", { hostKeyFingerprint: "SHA256:S" });
  assert.equal(write.ok, true);
  assert.deepEqual(clientFactory.created[0].lastWrite.options, { flags: "w", mode: 0o600 });
});

test("ssh: exec timeout closes the channel and drops the pooled connection", async (t) => {
  const { service, clientFactory } = await fixture(t, { fingerprint: "SHA256:TIMEOUT", execNeverCloses: true });
  const host = await service.create({ host: "10.0.0.41", user: "lo" });
  await service.trust(host.id, "SHA256:TIMEOUT");

  await assert.rejects(
    () => service.exec(host.id, { command: "sleep forever", hostKeyFingerprint: "SHA256:TIMEOUT", timeoutMs: 1 }),
    { code: "SSH_EXEC_TIMEOUT", httpStatus: 504 },
  );
  const client = clientFactory.created[0];
  assert.equal(client.execStreams[0].closed, true);
  assert.equal(client.execStreams[0].destroyed, true);
  assert.equal(client.ended, true);
  assert.equal(service._state.pool.has(host.id), false);
});

test("ssh: sftp canonical boundary rejects a symlink target outside the allowlist", async (t) => {
  const { service } = await fixture(t, {
    fingerprint: "SHA256:LINK",
    realpaths: {
      "/srv/data": "/srv/data",
      "/srv/data/link": "/etc/passwd",
    },
  });
  const host = await service.create({ host: "h", user: "u", rootAllowlist: ["/srv/data"] });
  await service.trust(host.id, "SHA256:LINK");

  await assert.rejects(
    () => service.sftpRead(host.id, "/srv/data/link", { hostKeyFingerprint: "SHA256:LINK" }),
    { code: "SFTP_PATH_BOUNDARY", httpStatus: 403 },
  );
  await assert.rejects(
    () => service.sftpReadRaw(host.id, "/srv/data/link", { hostKeyFingerprint: "SHA256:LINK" }),
    { code: "SFTP_PATH_BOUNDARY", httpStatus: 403 },
  );
});

test("ssh discover: parser captures Host blocks per OpenSSH semantics", () => {
  const parsed = parseSshConfig(`
# 注释行跳过
Host *
  ServerAliveInterval 30

Host cubie-radxa extra-alias
  HostName 192.168.171.215
  User lo
  Port 2222
  IdentityFile ~/.ssh/id_ed25519

Host=equals-form
  hostname=10.0.0.1
  user=eq

Host quoted
  HostName "10.0.0.2"
  Port "2223"

Match user root
  HostName should-not-appear

Host noprops

Host first-wins
  HostName 1.1.1.1
  HostName 2.2.2.2
`);
  const byAlias = new Map(parsed.map((entry) => [entry.alias, entry]));
  assert.equal(byAlias.has("*"), false, "通配 Host 块必须跳过");
  assert.equal(byAlias.has("should-not-appear"), false, "Match 块内容不得入列");
  const cubie = byAlias.get("cubie-radxa");
  assert.deepEqual(cubie, {
    alias: "cubie-radxa",
    aliases: ["cubie-radxa", "extra-alias"],
    host: "192.168.171.215",
    user: "lo",
    port: 2222,
    identityFile: "~/.ssh/id_ed25519",
  });
  assert.deepEqual(byAlias.get("equals-form"), { alias: "equals-form", aliases: ["equals-form"], host: "10.0.0.1", user: "eq", port: 22, identityFile: null });
  assert.equal(byAlias.get("quoted").host, "10.0.0.2", "引号值必须去引号");
  assert.equal(byAlias.get("quoted").port, 2223);
  assert.equal(byAlias.get("noprops").host, "noprops", "HostName 缺失回退 alias");
  assert.equal(byAlias.get("noprops").user, null, "User 缺失返回 null 由调用方兜底");
  assert.equal(byAlias.get("first-wins").host, "1.1.1.1", "同名关键字先出现者生效");
});

test("ssh discover: missing config is a normal empty state, real file parses", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-ssh-discover-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const missing = await discoverSshHosts({ configPath: join(dir, "no-such-config") });
  assert.deepEqual(missing.hosts, []);
  assert.equal(missing.source, null);

  const configPath = join(dir, "config");
  await writeFile(configPath, "Host daili\n  HostName 154.219.123.15\n  User root\n", "utf8");
  const found = await discoverSshHosts({ configPath });
  assert.equal(found.source, configPath);
  assert.deepEqual(found.hosts, [{ alias: "daili", aliases: ["daili"], host: "154.219.123.15", user: "root", port: 22, identityFile: null, knownFingerprint: null }]);
});

test("ssh: enabled toggle persists, refuses connect while off, re-enables", async (t) => {
  const { dir, service } = await fixture(t, { fingerprint: "SHA256:E" });
  const host = await service.create({ host: "10.0.0.7", user: "lo" });
  assert.equal(host.enabled, true, "登记默认启用");

  const off = await service.setEnabled(host.id, false);
  assert.equal(off.enabled, false);
  // 停用即拒连（先于指纹判定，明确语义优先）
  await assert.rejects(
    () => service.exec(host.id, { command: "uptime", hostKeyFingerprint: "SHA256:E" }),
    { code: "SSH_HOST_DISABLED" },
  );
  await assert.rejects(() => service.testConnection(host.id), { code: "SSH_HOST_DISABLED" });

  // 持久化：新实例同 dataRoot 仍停用；旧台账无 enabled 字段视为启用
  const revived = await createSshService({ dataRoot: dir, clientFactory: fakeClientFactory({ fingerprint: "SHA256:E" }) }).init();
  t.after(() => revived.close());
  assert.equal(revived.list().find((entry) => entry.id === host.id).enabled, false);

  const on = await service.setEnabled(host.id, true);
  assert.equal(on.enabled, true);
  await service.trust(host.id, "SHA256:E");
  const result = await service.exec(host.id, { command: "uptime", hostKeyFingerprint: "SHA256:E" });
  assert.equal(result.code, 0, "重新启用后恢复可连");

  const createdOff = await service.create({ host: "10.0.0.8", user: "lo", enabled: false });
  assert.equal(createdOff.enabled, false, "create 支持登记即停用");
});

/* —— known_hosts 信任继承 + 一键指纹（2026-08-11「为什么还需要确认指纹」波）—— */

function fakeKeyBlob(label) {
  return Buffer.from(`fake-key-blob:${label}`).toString("base64");
}

function expectedFingerprint(label) {
  return `SHA256:${createHash("sha256").update(Buffer.from(`fake-key-blob:${label}`)).digest("base64").replace(/=+$/, "")}`;
}

test("known_hosts: parser honors globs, negation, bracket ports, hashed entries, markers", () => {
  const ed = fakeKeyBlob("ed");
  const rsa = fakeKeyBlob("rsa");
  const hashedHost = "10.0.0.9";
  const salt = Buffer.from("12345678901234567890");
  const hmac = createHmac("sha1", salt).update(hashedHost).digest("base64");
  const entries = parseKnownHosts(`
# comment
10.0.0.1 ssh-ed25519 ${ed}
[10.0.0.2]:2222 ssh-rsa ${rsa}
*.example.com ssh-ed25519 ${ed}
*.prod.com,!bad.prod.com ssh-ed25519 ${ed}
|1|${salt.toString("base64")}|${hmac} ssh-ed25519 ${ed}
@cert-authority ca.example.com ssh-ed25519 ${ed}
garbage-line-without-key
`);

  assert.equal(matchKnownHost(entries, "10.0.0.1", 22), expectedFingerprint("ed"));
  assert.equal(matchKnownHost(entries, "10.0.0.1", 2222), null, "非标端口只匹配括号形式");
  assert.equal(matchKnownHost(entries, "10.0.0.2", 2222), expectedFingerprint("rsa"));
  assert.equal(matchKnownHost(entries, "10.0.0.2", 22), null);
  assert.equal(matchKnownHost(entries, "box.example.com", 22), expectedFingerprint("ed"), "glob 命中");
  assert.equal(matchKnownHost(entries, "example.org", 22), null);
  assert.equal(matchKnownHost(entries, "ok.prod.com", 22), expectedFingerprint("ed"));
  assert.equal(matchKnownHost(entries, "bad.prod.com", 22), null, "! 否定优先");
  assert.equal(matchKnownHost(entries, hashedHost, 22), expectedFingerprint("ed"), "|1| 哈希模式命中");
  assert.equal(matchKnownHost(entries, "10.0.0.10", 22), null, "哈希模式不误伤");
  assert.equal(matchKnownHost(entries, "ca.example.com", 22), expectedFingerprint("ed"), "@ 标记行仍可取 key");
});

test("known_hosts: fingerprint format is SHA256 base64 without padding; ed25519 preferred", () => {
  const fingerprint = fingerprintOfKeyBlob(fakeKeyBlob("fmt"));
  assert.match(fingerprint, /^SHA256:[A-Za-z0-9+/]+$/);
  assert.ok(!fingerprint.endsWith("="));
  const entries = parseKnownHosts([
    `multi.example.com ssh-rsa ${fakeKeyBlob("r")}`,
    `multi.example.com ssh-ed25519 ${fakeKeyBlob("e")}`,
  ].join("\n"));
  assert.equal(matchKnownHost(entries, "multi.example.com", 22), expectedFingerprint("e"), "多 key 命中取 ed25519 优先");
});

test("ssh discover: entries inherit knownFingerprint from known_hosts", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-ssh-kh-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, "config");
  const knownHostsPath = join(dir, "known_hosts");
  await writeFile(configPath, [
    "Host lanniny-45",
    "  HostName 45.205.25.155",
    "  Port 51451",
    "  User lanniny",
    "Host plain",
    "  HostName 10.1.1.1",
    "  User lo",
    "",
  ].join("\n"), "utf8");
  await writeFile(knownHostsPath, [
    `[45.205.25.155]:51451 ssh-ed25519 ${fakeKeyBlob("ln")}`,
    `10.2.2.2 ssh-ed25519 ${fakeKeyBlob("other")}`,
    "",
  ].join("\n"), "utf8");

  const result = await discoverSshHosts({ configPath, knownHostsPath });
  const byAlias = new Map(result.hosts.map((entry) => [entry.alias, entry]));
  assert.equal(byAlias.get("lanniny-45").knownFingerprint, expectedFingerprint("ln"), "括号端口条目继承命中");
  assert.equal(byAlias.get("plain").knownFingerprint, null, "无命中如实为 null");

  const missing = await discoverSshHosts({ configPath, knownHostsPath: join(dir, "absent") });
  assert.equal(missing.hosts.every((entry) => entry.knownFingerprint === null), true, "known_hosts 缺失静默降级");
});

test("ssh: captureFingerprint performs TOFU capture without granting trust", async (t) => {
  const { service } = await fixture(t, { fingerprint: "SHA256:CAPTURED" });
  const host = await service.create({ host: "10.0.0.11", user: "lo" });
  const captured = await service.captureFingerprint(host.id);
  assert.equal(captured.fingerprint, "SHA256:CAPTURED");
  // 捕获不等于信任：exec 仍须先确认
  await assert.rejects(
    () => service.exec(host.id, { command: "uptime", hostKeyFingerprint: "SHA256:CAPTURED" }),
    { code: "SSH_HOSTKEY_UNCONFIRMED" },
  );
  await service.trust(host.id, captured.fingerprint);
  const result = await service.exec(host.id, { command: "uptime", hostKeyFingerprint: "SHA256:CAPTURED" });
  assert.equal(result.code, 0);

  await service.setEnabled(host.id, false);
  await assert.rejects(() => service.captureFingerprint(host.id), { code: "SSH_HOST_DISABLED" });
});

test("ssh: real-mode hostVerifier is wired into connect config and enforces the ledger", async (t) => {
  const { service, clientFactory } = await fixture(t, { fingerprint: "SHA256:W" });
  const host = await service.create({ host: "10.0.0.12", user: "lo" });
  await service.trust(host.id, "SHA256:W");
  await service.exec(host.id, { command: "a", hostKeyFingerprint: "SHA256:W" });
  const connectConfig = clientFactory.created[0].connectConfig;
  assert.equal(connectConfig.hostHash, "sha256", "真实 ssh2 需要 hostHash 才有哈希回调");
  assert.equal(typeof connectConfig.hostVerifier, "function", "verifier 必须接进 connect 配置");
  assert.equal(connectConfig.hostVerifier("W"), true, "台账指纹一致放行");
  assert.equal(connectConfig.hostVerifier("WRONG"), false, "指纹变更拒绝（不抛出，交 ssh2 收尾）");
});

/* —— 认证链 + 预认证指纹捕获（2026-08-11「获取指纹失败」波）—— */

test("ssh: captureFingerprint returns the host key even when authentication fails", async (t) => {
  const { service } = await fixture(t, { fingerprint: "SHA256:PREAUTH", connectError: "All configured authentication methods failed" });
  const host = await service.create({ host: "10.0.0.21", user: "lo" });
  const captured = await service.captureFingerprint(host.id);
  assert.equal(captured.fingerprint, "SHA256:PREAUTH", "主机键先于认证交换，认证失败不阻断捕获");
});

test("ssh: no-secret hosts authenticate via injected identityProvider and agent", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-ssh-idp-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const clientFactory = fakeClientFactory({ fingerprint: "SHA256:K" });
  const calls = [];
  const service = await createSshService({
    dataRoot: dir,
    clientFactory,
    identityProvider: async (entry) => { calls.push(entry.id); return "INJECTED-PRIVATE-KEY"; },
  }).init();
  t.after(() => service.close());
  const host = await service.create({ host: "10.0.0.22", user: "lo", identityFile: "~/.ssh/id_special" });
  await service.trust(host.id, "SHA256:K");
  await service.exec(host.id, { command: "a", hostKeyFingerprint: "SHA256:K" });
  const config = clientFactory.created[0].connectConfig;
  assert.equal(config.privateKey, "INJECTED-PRIVATE-KEY");
  assert.deepEqual(calls, [host.id]);
  assert.equal(service.list()[0].identityFile, "~/.ssh/id_special", "私钥只记路径");
  if (process.env.SSH_AUTH_SOCK) {
    assert.equal(config.agent, process.env.SSH_AUTH_SOCK);
  } else if (process.platform === "win32") {
    assert.equal(config.agent, "\\\\.\\pipe\\openssh-ssh-agent", "Windows 缺省走 OpenSSH agent 管道");
  }
});

test("ssh: password-registered hosts never consult the identity chain", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "514cc-ssh-pw-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const clientFactory = fakeClientFactory({ fingerprint: "SHA256:P" });
  let consulted = false;
  const service = await createSshService({
    dataRoot: dir,
    clientFactory,
    identityProvider: async () => { consulted = true; return "SHOULD-NOT-BE-USED"; },
  }).init();
  t.after(() => service.close());
  const host = await service.create({ host: "10.0.0.23", user: "lo", auth: { password: "pw" } });
  await service.trust(host.id, "SHA256:P");
  await service.exec(host.id, { command: "a", hostKeyFingerprint: "SHA256:P" });
  const config = clientFactory.created[0].connectConfig;
  assert.equal(config.password, "pw");
  assert.equal(config.privateKey, undefined);
  assert.equal(config.agent, undefined);
  assert.equal(consulted, false, "有 secret 的主机不触碰密钥/agent 链");
});

test("ssh discover: IdentityFile captured as path only; expandIdentityPath honors ~ and % tokens", () => {
  const parsed = parseSshConfig("Host keyhost\n  HostName 10.3.3.3\n  User lo\n  IdentityFile ~/.ssh/id_special\nHost nokey\n  HostName 10.3.3.4\n");
  assert.equal(parsed.find((entry) => entry.alias === "keyhost").identityFile, "~/.ssh/id_special");
  assert.equal(parsed.find((entry) => entry.alias === "nokey").identityFile, null);

  const home = homedir();
  assert.equal(expandIdentityPath("~/.ssh/id_ed25519"), join(home, ".ssh", "id_ed25519"));
  assert.equal(expandIdentityPath("%d/keys/%h@%p", { host: "h1", port: 2222 }), `${home}/keys/h1@2222`);
  assert.equal(expandIdentityPath("/keys/%r-100%", { user: "lo" }), "/keys/lo-100%");
  assert.equal(expandIdentityPath("   "), null);
});

test("ssh: repeated 'error' events from the auth fallback chain never escape the process", async (t) => {
  // fake 现在双发 error（模拟 ssh2 认证回退链）；持久监听 + settled 闸必须兜住：
  // connect 路径如实拒绝、capture 路径已捕获即成功，两条路都不许有事件逃逸杀进程。
  const { service } = await fixture(t, { fingerprint: "SHA256:CHAIN", connectError: "All configured authentication methods failed" });
  const host = await service.create({ host: "10.0.0.31", user: "lo" });

  const captured = await service.captureFingerprint(host.id);
  assert.equal(captured.fingerprint, "SHA256:CHAIN", "首个 error 已带指纹即成功，后续 error 静默");

  await service.trust(host.id, "SHA256:CHAIN");
  await assert.rejects(
    () => service.exec(host.id, { command: "uptime", hostKeyFingerprint: "SHA256:CHAIN" }),
    { code: "SSH_CONNECT_FAILED" },
    "连接错误如实拒绝，第二个 error 不得逃逸",
  );
  // 双发错误的第二发在此刻已落到持久监听器上——测试能跑完即证明进程未死
});

/* —— sync-config 回同步（2026-08-11「不可达」波）—— */

test("ssh: update applies whitelisted fields; endpoint change forces re-TOFU", async (t) => {
  const { dir, service } = await fixture(t, { fingerprint: "SHA256:U" });
  const host = await service.create({ host: "10.0.0.41", user: "lo" });
  await service.trust(host.id, "SHA256:U");

  // 认证材料变更：指纹保留、字段落账、持久化
  const updated = await service.update(host.id, { user: "lanniny", identityFile: "C:/Users/16643/.ssh/ssh", name: "lanniny-45" });
  assert.equal(updated.user, "lanniny");
  assert.equal(updated.identityFile, "C:/Users/16643/.ssh/ssh");
  assert.equal(updated.name, "lanniny-45");
  assert.equal(updated.trusted, true, "user/identityFile 变更不动指纹");
  const onDisk = JSON.parse(await readFile(join(dir, "ssh-hosts.json"), "utf8"));
  assert.equal(onDisk.hosts[0].identityFile, "C:/Users/16643/.ssh/ssh");

  // 端点变更：旧指纹失效（重 TOFU）、旧字段空值不覆盖
  const moved = await service.update(host.id, { host: "45.205.25.155", port: 51451, name: "   " });
  assert.equal(moved.host, "45.205.25.155");
  assert.equal(moved.port, 51451);
  assert.equal(moved.name, "lanniny-45", "空白 name 不覆盖");
  assert.equal(moved.trusted, false, "端点变了必须重新确认指纹");
  await assert.rejects(
    () => service.exec(host.id, { command: "uptime", hostKeyFingerprint: "SHA256:U" }),
    { code: "SSH_HOSTKEY_UNCONFIRMED" },
  );
});

test("ssh discover: matchConfigEntry prefers alias, falls back to host+port, else null", () => {
  const hosts = [
    { alias: "alpha", host: "10.0.0.1", port: 22 },
    { alias: "beta", host: "10.0.0.2", port: 2222 },
  ];
  assert.equal(matchConfigEntry(hosts, { name: "beta", host: "9.9.9.9", port: 1 }).alias, "beta", "名称==alias 优先");
  assert.equal(matchConfigEntry(hosts, { name: "unknown", host: "10.0.0.2", port: 2222 }).alias, "beta", "端点回退");
  assert.equal(matchConfigEntry(hosts, { name: "unknown", host: "10.0.0.2", port: 22 }), null, "端口不同不算同端点");
  assert.equal(matchConfigEntry([], { name: "x" }), null);
});
