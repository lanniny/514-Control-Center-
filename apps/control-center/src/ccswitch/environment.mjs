import { spawn } from "node:child_process";

const OUTPUT_LIMIT = 1024 * 1024;

export const CCSWITCH_ENVIRONMENT_WATCH = Object.freeze([
  { app: "claude", name: "ANTHROPIC_AUTH_TOKEN" },
  { app: "claude", name: "ANTHROPIC_API_KEY" },
  { app: "claude", name: "ANTHROPIC_BASE_URL" },
  { app: "claude", name: "ANTHROPIC_MODEL" },
  { app: "codex", name: "OPENAI_API_KEY" },
  { app: "gemini", name: "GEMINI_API_KEY" },
  { app: "gemini", name: "GOOGLE_GEMINI_BASE_URL" },
  { app: "gemini", name: "GEMINI_MODEL" },
]);

function runPowerShell(script, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > OUTPUT_LIMIT) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr) > OUTPUT_LIMIT) child.kill();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(Object.assign(new Error(`PowerShell environment operation failed (${code}): ${stderr.trim().slice(-500)}`), { code: "ENV_PLATFORM_OPERATION_FAILED", httpStatus: 502 }));
    });
  });
}

function cleanItem(item) {
  const name = String(item?.name ?? "");
  const scope = String(item?.scope ?? "Process");
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) throw Object.assign(new Error(`invalid environment variable name: ${name}`), { code: "VALIDATION_FAILED" });
  if (!["Process", "User", "Machine"].includes(scope)) throw Object.assign(new Error(`invalid environment scope: ${scope}`), { code: "VALIDATION_FAILED" });
  return { ...item, name, scope };
}

export function createEnvironmentAdapter({ platform = process.platform, runner = runPowerShell } = {}) {
  return {
    async inspect(watched = CCSWITCH_ENVIRONMENT_WATCH) {
      const byName = new Map(watched.map((item) => [item.name, item.app]));
      const items = [];
      for (const [name, app] of byName) {
        if (process.env[name] !== undefined) items.push({ app, name, value: process.env[name], scope: "Process", source: "process.env" });
      }
      if (platform !== "win32") return items;

      const script = [
        "$ErrorActionPreference = 'Stop'",
        "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
        "$names = @((ConvertFrom-Json $env:CCSWITCH_ENV_NAMES))",
        "$items = @()",
        "foreach ($scope in @('User','Machine')) { foreach ($name in $names) {",
        "  $target = [EnvironmentVariableTarget]([Enum]::Parse([EnvironmentVariableTarget], $scope))",
        "  $value = [Environment]::GetEnvironmentVariable([string]$name, $target)",
        "  if ($null -ne $value) { $items += [pscustomobject]@{ name=[string]$name; value=[string]$value; scope=$scope } }",
        "} }",
        "ConvertTo-Json -Compress -InputObject @($items)",
      ].join("; ");
      const output = await runner(script, { CCSWITCH_ENV_NAMES: JSON.stringify([...byName.keys()]) });
      const persistent = output ? JSON.parse(output) : [];
      for (const item of Array.isArray(persistent) ? persistent : [persistent]) {
        if (!byName.has(item.name)) continue;
        items.push({ app: byName.get(item.name), name: item.name, value: item.value, scope: item.scope, source: `Windows ${item.scope} environment` });
      }
      return items;
    },

    async remove(rawItem) {
      const item = cleanItem(rawItem);
      const previous = item.value ?? (item.scope === "Process" ? process.env[item.name] : undefined);
      if (item.scope === "Process") {
        delete process.env[item.name];
        return previous;
      }
      if (platform !== "win32") throw Object.assign(new Error(`persistent ${item.scope} environment is unsupported on ${platform}`), { code: "ENV_SCOPE_UNSUPPORTED" });
      const script = [
        "$ErrorActionPreference = 'Stop'",
        "$scope = [EnvironmentVariableTarget]([Enum]::Parse([EnvironmentVariableTarget], $env:CCSWITCH_ENV_SCOPE))",
        "[Environment]::SetEnvironmentVariable($env:CCSWITCH_ENV_NAME, $null, $scope)",
        "if ($null -ne [Environment]::GetEnvironmentVariable($env:CCSWITCH_ENV_NAME, $scope)) { throw 'environment deletion verification failed' }",
      ].join("; ");
      await runner(script, { CCSWITCH_ENV_NAME: item.name, CCSWITCH_ENV_SCOPE: item.scope });
      return previous;
    },

    async set(rawItem) {
      const item = cleanItem(rawItem);
      const value = String(item.value ?? "");
      if (item.scope === "Process") {
        process.env[item.name] = value;
        return;
      }
      if (platform !== "win32") throw Object.assign(new Error(`persistent ${item.scope} environment is unsupported on ${platform}`), { code: "ENV_SCOPE_UNSUPPORTED" });
      const script = [
        "$ErrorActionPreference = 'Stop'",
        "$scope = [EnvironmentVariableTarget]([Enum]::Parse([EnvironmentVariableTarget], $env:CCSWITCH_ENV_SCOPE))",
        "[Environment]::SetEnvironmentVariable($env:CCSWITCH_ENV_NAME, $env:CCSWITCH_ENV_VALUE, $scope)",
        "$actual = [Environment]::GetEnvironmentVariable($env:CCSWITCH_ENV_NAME, $scope)",
        "if ($actual -cne $env:CCSWITCH_ENV_VALUE) { throw 'environment restore verification failed' }",
      ].join("; ");
      await runner(script, {
        CCSWITCH_ENV_NAME: item.name,
        CCSWITCH_ENV_SCOPE: item.scope,
        CCSWITCH_ENV_VALUE: value,
      });
    },
  };
}
