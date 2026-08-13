import test from "node:test";
import assert from "node:assert/strict";
import { defaultBillingProbe } from "../src/provider-net.mjs";

const billingFetch = ({ subscription, usage }) => async (url) => {
  const body = url.endsWith("/subscription") ? subscription : url.endsWith("/usage") ? usage : null;
  return new Response(body == null ? "not found" : JSON.stringify(body), { status: body == null ? 404 : 200 });
};

test("defaultBillingProbe: computes remaining from one-api billing endpoints（micu 实测形状：total_usage 为美分）", async () => {
  const result = await defaultBillingProbe(
    { baseUrl: "https://www.micuapi.ai/v1", apiKey: "sk-test" },
    billingFetch({
      subscription: { object: "billing_subscription", hard_limit_usd: 7954.159166 },
      usage: { object: "list", total_usage: 795432.669 },
    }),
  );
  assert.equal(result.success, true);
  const entry = result.data[0];
  assert.equal(entry.used, 7954.33);
  assert.equal(entry.total, 7954.159166);
  assert.equal(entry.remaining, 0, "用量超过硬顶时余额归零不为负");
  assert.equal(entry.extra, "额度已用尽");
});

test("defaultBillingProbe: hard limit ≥ 1e6 is reported as unlimited instead of fake precision（514 实测形状）", async () => {
  const result = await defaultBillingProbe(
    { baseUrl: "https://514claude.xyz/", apiKey: "sk-test" },
    billingFetch({
      subscription: { object: "billing_subscription", hard_limit_usd: 100000000 },
      usage: { object: "list", total_usage: 11164.8092 },
    }),
  );
  assert.equal(result.success, true);
  const entry = result.data[0];
  assert.equal(entry.remaining, null);
  assert.equal(entry.used, 111.65);
  assert.match(entry.extra, /额度无限/);
});

test("defaultBillingProbe: provider without billing endpoints folds to unsupported instead of throwing", async () => {
  const result = await defaultBillingProbe(
    { baseUrl: "https://tokenrhythm.studio/v1", apiKey: "sk-test" },
    billingFetch({ subscription: null, usage: null }),
  );
  assert.equal(result.success, false);
  assert.equal(result.code, "BALANCE_UNSUPPORTED");
  assert.match(result.error, /不支持余额查询/);
});

test("defaultBillingProbe: 401 surfaces as unauthorized", async () => {
  const result = await defaultBillingProbe(
    { baseUrl: "https://relay.example/v1", apiKey: "sk-bad" },
    async () => new Response("{}", { status: 401 }),
  );
  assert.equal(result.success, false);
  assert.equal(result.code, "BALANCE_UNAUTHORIZED");
});

test("defaultBillingProbe: missing credentials fail fast without touching the network", async () => {
  let called = false;
  const result = await defaultBillingProbe({ baseUrl: "https://relay.example" }, async () => {
    called = true;
    throw new Error("must not be called");
  });
  assert.equal(result.success, false);
  assert.equal(result.code, "BALANCE_UNSUPPORTED");
  assert.equal(called, false);
});

test("defaultBillingProbe: network failure folds to request-failed without leaking the api key", async () => {
  const result = await defaultBillingProbe(
    { baseUrl: "https://provider.invalid", apiKey: "sk-secret-value" },
    async () => { throw new Error("getaddrinfo ENOTFOUND provider.invalid"); },
  );
  assert.equal(result.success, false);
  assert.equal(result.code, "BALANCE_REQUEST_FAILED");
  assert.ok(!JSON.stringify(result).includes("sk-secret-value"));
});
