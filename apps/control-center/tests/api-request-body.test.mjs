import test from "node:test";
import assert from "node:assert/strict";

// LO 2026-08-08「终端输入不了任何东西」的根因：request() 内部会 JSON.stringify(body)，
// 而多处调用方自己又 stringify 了一次。服务端 JSON.parse 拿到的是字符串字面量而非对象，
// 取字段全是 undefined —— PTY 每次都写入空串，请求照样返回 200，表现为"打不出字"。
// 这里用真实的 fetch 桩验证行为，而不是断言源码文本。

async function withStubbedFetch(run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("request() serializes an object body exactly once", async () => {
  const { request } = await import("../public/api.js");
  await withStubbedFetch(async (calls) => {
    await request("/api/pty/abc/input", { method: "POST", body: { data: "e" } });
    const parsed = JSON.parse(calls[0].init.body);
    assert.equal(typeof parsed, "object", "对象 body 必须解析回对象");
    assert.equal(parsed.data, "e");
  });
});

test("request() passes an already-serialized string body through untouched", async () => {
  const { request } = await import("../public/api.js");
  await withStubbedFetch(async (calls) => {
    await request("/api/pty/abc/input", { method: "POST", body: JSON.stringify({ data: "e" }) });
    const parsed = JSON.parse(calls[0].init.body);
    // 双重序列化时这里会解析出字符串 '{"data":"e"}'，服务端取 .data 就是 undefined
    assert.equal(typeof parsed, "object", "已序列化的 body 被重复包了一层");
    assert.equal(parsed.data, "e");
  });
});

test("request() keeps JSON content-type for both body shapes", async () => {
  const { request } = await import("../public/api.js");
  await withStubbedFetch(async (calls) => {
    await request("/api/x", { method: "POST", body: { a: 1 } });
    await request("/api/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    for (const call of calls) {
      assert.equal(call.init.headers.get("Content-Type"), "application/json");
    }
  });
});

test("request() rejects an external URL before attaching the bearer token", async () => {
  const { request, setAccessToken } = await import("../public/api.js");
  setAccessToken("review-secret");
  try {
    await withStubbedFetch(async (calls) => {
      await assert.rejects(
        () => request("https://attacker.invalid/collect"),
        /同源|相对路径/,
      );
      assert.equal(calls.length, 0, "外部地址不得进入 fetch，更不能收到 Authorization");
    });
  } finally {
    setAccessToken("");
  }
});
