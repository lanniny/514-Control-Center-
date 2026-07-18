import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ApprovalBroker } from "../src/approval-broker.mjs";
import { acquireInstanceLock } from "../src/instance-lock.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const eventStore = { emit: async () => {} };

test("permission denial matches the generated app-server response shape", async () => {
  const broker = new ApprovalBroker({ eventStore, ttlMs: 5_000 });
  const responsePromise = broker.request({ method: "item/permissions/requestApproval", params: { permissions: {} } });
  await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
  const [pending] = broker.list();
  assert.ok(pending);
  await broker.resolve(pending.id, { decision: "deny", actionSha256: pending.actionSha256 });
  const response = await responsePromise;
  assert.deepEqual(response, { permissions: {}, scope: "turn" });
  const schemaPath = resolve(appRoot, "..", "..", ".workflow/ultracode/agent-control-plane-v1/references/codex-app-server-0.144.2/PermissionsRequestApprovalResponse.json");
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  assert.equal(schema.required.includes("permissions"), true);
  assert.equal(schema.definitions.GrantedPermissionProfile.type, "object");
  assert.equal(Array.isArray(response.permissions), false);
});

test("unsupported server methods never enter the approval queue", async () => {
  const broker = new ApprovalBroker({ eventStore, ttlMs: 5_000 });
  await assert.rejects(() => broker.request({ method: "item/tool/requestUserInput", params: {} }), { code: "UNSUPPORTED_APPROVAL" });
  assert.deepEqual(broker.list(), []);
});

test("an approval is not released until its decision is durably audited", async () => {
  let failResolutionAudit = true;
  const broker = new ApprovalBroker({
    eventStore: {
      async emit(type) {
        if (type === "approval.resolved" && failResolutionAudit) throw new Error("audit disk unavailable");
      },
    },
    ttlMs: 5_000,
  });
  let released = false;
  const responsePromise = broker
    .request({ method: "item/fileChange/requestApproval", params: { path: "src/a.mjs" } })
    .then((value) => { released = true; return value; });
  await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
  const [pending] = broker.list();
  await assert.rejects(
    () => broker.resolve(pending.id, { decision: "approve", actionSha256: pending.actionSha256 }),
    { code: "APPROVAL_AUDIT_FAILED" },
  );
  assert.equal(released, false);
  assert.equal(broker.list()[0].status, "pending");

  failResolutionAudit = false;
  await broker.resolve(pending.id, { decision: "approve", actionSha256: pending.actionSha256 });
  assert.deepEqual(await responsePromise, { decision: "accept" });
});

test("instance lock is exclusive for a repository control root", async (t) => {
  const root = await mkdtemp(resolve(appRoot, ".test-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await acquireInstanceLock(root, { repoRoot: "C:/repo" });
  await assert.rejects(() => acquireInstanceLock(root, { repoRoot: "C:/repo" }), { code: "INSTANCE_ACTIVE" });
  await first.release();
  const second = await acquireInstanceLock(root, { repoRoot: "C:/repo" });
  await second.release();
});
