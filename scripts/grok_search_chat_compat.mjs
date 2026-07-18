#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import {
  buildChildEnvironment,
  GROK_COMPAT_ENV,
  injectCitations,
  normalizeRequest,
} from "./grok_search_chat_compat_core.mjs";

const remoteBase = (process.env[GROK_COMPAT_ENV.apiUrl] || "").replace(/\/+$/, "");
const remoteKey = process.env[GROK_COMPAT_ENV.apiKey] || "";
const remoteModel = process.env[GROK_COMPAT_ENV.model] || "";

if (!remoteBase || !remoteKey || !remoteModel) {
  process.stderr.write(
    "grok compat: GROK_SEARCH_RS_COMPAT_API_URL/API_KEY/MODEL are required\n",
  );
  process.exit(1);
}

const localKey = `local-${randomBytes(24).toString("hex")}`;
const maxBodyBytes = 8 * 1024 * 1024;

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("request body exceeds limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
    return;
  }
  if (request.headers.authorization !== `Bearer ${localKey}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "unauthorized" } }));
    return;
  }
  try {
    const input = normalizeRequest(JSON.parse((await readBody(request)).toString("utf8")));
    const upstream = await fetch(`${remoteBase}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${remoteKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await upstream.text();
    let output = text;
    if (upstream.ok) {
      try {
        output = JSON.stringify(injectCitations(JSON.parse(text)));
      } catch {
        output = text;
      }
    }
    response.writeHead(upstream.status, { "content-type": "application/json" });
    response.end(output);
  } catch (error) {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: `compat bridge error: ${error.message}` } }));
  }
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    process.stderr.write("grok compat: failed to allocate loopback port\n");
    process.exit(1);
  }
  const childEnv = buildChildEnvironment(process.env, {
    localBase: `http://127.0.0.1:${address.port}/v1`,
    localKey,
    model: remoteModel,
  });

  const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "grok-search-rs"], {
    env: childEnv,
    stdio: "inherit",
    windowsHide: true,
  });

  const stop = () => {
    if (!child.killed) child.kill();
    server.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.once("error", (error) => {
    process.stderr.write(`grok compat: failed to start grok-search-rs: ${error.message}\n`);
    server.close(() => process.exit(1));
  });
  child.once("exit", (code, signal) => {
    server.close(() => {
      if (signal) process.kill(process.pid, signal);
      else process.exit(code ?? 1);
    });
  });
});
