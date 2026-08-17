/**
 * 安全诊断：侧栏不再挂模型路由；门闩可授权/撤销；策略从 permissions 真源派生。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const publicRoot = resolve(import.meta.dirname, "../public");

test("security view owns live posture, grant/revoke and honest gate summary", async () => {
  const [index, app, api] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "api.js"), "utf8"),
  ]);
  const securityStart = index.indexOf('id="view-security"');
  const observabilityStart = index.indexOf('id="view-observability"');
  const securityView = index.slice(securityStart, observabilityStart);

  assert.match(securityView, /id="security-posture"/);
  assert.match(securityView, /id="remote-gates-summary"/);
  assert.doesNotMatch(securityView, />blocked</);
  assert.match(app, /function policiesFromPermissions\(/);
  assert.match(app, /function mutateRemoteGate\(/);
  assert.match(app, /data-gate-grant/);
  assert.match(app, /data-gate-revoke/);
  assert.match(app, /confirmAction\(/);
  assert.match(app, /API\.remoteGateGrant/);
  assert.match(app, /API\.remoteGates/);
  assert.match(app, /API\.approvals, API\.leases, API\.remoteGates/);
  assert.match(api, /remoteGates: "\/api\/security\/remote-gates"/);
  assert.match(api, /remoteGateGrant: "\/api\/security\/remote-gates\/grant"/);
  assert.match(api, /remoteGateRevoke: "\/api\/security\/remote-gates\/revoke"/);
});

test("policiesFromPermissions keeps mode flags and fail-closed approval contract", async () => {
  const app = await readFile(resolve(publicRoot, "app.js"), "utf8");
  const block = app.slice(app.indexOf("function policiesFromPermissions"), app.indexOf("function extractBootstrapData"));
  assert.match(block, /defaultMode/);
  assert.match(block, /approvalRequired/);
  assert.match(block, /超时默认拒绝/);
  assert.match(block, /不外发明文、不落盘/);
  assert.match(block, /exposeValues/);
});
