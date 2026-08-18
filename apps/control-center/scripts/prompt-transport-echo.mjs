#!/usr/bin/env node

import { createHash } from "node:crypto";

function digest(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const stdinMode = process.argv.includes("--stdin");
const echoFlag = process.argv.indexOf("--echo");
const text = stdinMode
  ? await readStdin()
  : (echoFlag >= 0 ? String(process.argv[echoFlag + 1] ?? "") : "");

process.stdout.write(`${JSON.stringify({
  echo: text,
  digest: digest(text),
  byteLength: Buffer.byteLength(text, "utf8"),
  codePointCount: [...text].length,
})}\n`);
