#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  buildChildEnvironment,
  extractUrls,
  GROK_COMPAT_ENV,
  injectCitations,
  normalizeRequest,
} from "./grok_search_chat_compat_core.mjs";

const childEnv = buildChildEnvironment(
  {
    KEEP_ME: "yes",
    [GROK_COMPAT_ENV.apiUrl]: "https://remote.example/v1",
    [GROK_COMPAT_ENV.apiKey]: "remote-secret",
    [GROK_COMPAT_ENV.model]: "remote-model",
    GROK_SEARCH_API_KEY: "legacy-secret",
    OPENAI_COMPATIBLE_API_KEY: "stale-secret",
    grok_search_rs_compat_api_key: "mixed-case-remote-secret",
    openai_compatible_api_url: "https://stale.example/v1",
    Grok_Search_Model: "mixed-case-legacy-model",
  },
  {
    localBase: "http://127.0.0.1:43123/v1",
    localKey: "local-secret",
    model: "grok-test",
  },
);
assert.equal(childEnv.KEEP_ME, "yes");
assert.equal(childEnv.OPENAI_COMPATIBLE_API_URL, "http://127.0.0.1:43123/v1");
assert.equal(childEnv.OPENAI_COMPATIBLE_API_KEY, "local-secret");
assert.equal(childEnv.OPENAI_COMPATIBLE_MODEL, "grok-test");
assert.equal(childEnv.GROK_SEARCH_WEB_SEARCH, "false");
assert.equal(GROK_COMPAT_ENV.apiKey in childEnv, false);
assert.equal("GROK_SEARCH_API_KEY" in childEnv, false);
assert.equal(Object.values(childEnv).includes("remote-secret"), false);
assert.equal(Object.values(childEnv).includes("mixed-case-remote-secret"), false);
assert.equal(Object.values(childEnv).includes("https://stale.example/v1"), false);
assert.equal(Object.values(childEnv).includes("mixed-case-legacy-model"), false);

assert.deepEqual(extractUrls("Source: https://github.com/openai/codex)."), [
  "https://github.com/openai/codex",
]);
assert.deepEqual(extractUrls("Source: github.com/openai/codex。"), [
  "https://github.com/openai/codex",
]);
assert.deepEqual(
  extractUrls([{ type: "text", text: "See openai.com/codex" }]),
  ["https://openai.com/codex"],
);

const request = {
  messages: [{ role: "system", content: "Prefer primary sources." }],
  tools: [
    { type: "web_search" },
    { type: "web_search_preview" },
    { type: "function", function: { name: "keep_me" } },
  ],
  web_search_options: {},
  search_parameters: { mode: "auto" },
};
normalizeRequest(request);
normalizeRequest(request);
assert.deepEqual(request.tools, [
  { type: "function", function: { name: "keep_me" } },
]);
assert.equal("web_search_options" in request, false);
assert.equal("search_parameters" in request, false);
assert.equal(
  request.messages[0].content.match(/full absolute URL/g)?.length,
  1,
);

const response = {
  choices: [
    {
      message: {
        role: "assistant",
        content: "Official source: github.com/openai/codex",
      },
    },
  ],
};
injectCitations(response);
assert.deepEqual(response.choices[0].message.citations, [
  "https://github.com/openai/codex",
]);

const existing = {
  choices: [
    {
      message: {
        content: "See https://example.com/new",
        citations: ["https://example.com/original"],
      },
    },
  ],
};
injectCitations(existing);
assert.deepEqual(existing.choices[0].message.citations, [
  "https://example.com/original",
]);

console.log("grok chat compatibility tests passed");
