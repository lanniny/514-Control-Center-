import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../");

test("消息收发局拥有真实团队 scoped API 与工作面挂载点", async () => {
  const [server, api, flow, app, html, css] = await Promise.all([
    readFile(resolve(root, "server.mjs"), "utf8"),
    readFile(resolve(root, "public/api.js"), "utf8"),
    readFile(resolve(root, "public/collab-flow.js"), "utf8"),
    readFile(resolve(root, "public/app.js"), "utf8"),
    readFile(resolve(root, "public/index.html"), "utf8"),
    readFile(resolve(root, "public/forge/team.css"), "utf8"),
  ]);
  assert.match(server, /teamInboxMatch/);
  assert.match(server, /collectTeamInbox/);
  assert.match(server, /state\.orchestrator\.bus\.readTail/);
  assert.match(api, /teamInbox: \(teamId\)/);
  assert.match(flow, /request\(API\.teamInbox\(team\.id\), \{ signal: controller\.signal \}\)/);
  assert.match(flow, /refreshController\?\.abort\(\)/);
  assert.match(flow, /signal: controller\.signal/);
  assert.match(flow, /renderInbox\(/);
  assert.match(flow, /setInboxStatus\(roots\.inbox, "加载中", "pending"\)/);
  assert.match(flow, /closest\?\.\("\.team-inbox-block, \.content-section"\)/);
  assert.match(flow, /if \(!root\?\.isConnected\) return/);
  assert.match(flow, /partial \? "warning" : "ok"/);
  assert.match(flow, /data-run-select/);
  const selectRun = app.slice(app.indexOf("async function selectRun"), app.indexOf("const NAV_MOBILE_QUERY"));
  assert.ok(selectRun.indexOf("await loadRuns()") < selectRun.indexOf("对应任务不存在或尚未同步"));
  assert.match(selectRun, /任务列表刷新失败/);
  assert.match(app, /if \(run\) void selectRun\(run\.dataset\.runSelect\)/);
  assert.match(html, /id="team-inbox-root"/);
  assert.match(html, /消息收发局/);
  assert.match(css, /\.team-inbox-row/);
});
