import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const qaScript = fileURLToPath(new URL("../scripts/qa-ui.mjs", import.meta.url));

test("qa-ui rejects an unknown suite before launching a browser", () => {
  const result = spawnSync(process.execPath, [qaScript, "http://127.0.0.1:1", "--suite=histroy"], {
    encoding: "utf8",
    windowsHide: true,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown QA suite: histroy/);
});
