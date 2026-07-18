param(
    [string]$Root = "I:\514claude\514cc",
    [string]$PiWorkspace = "G:\tasks\pi proxy"
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$required = @(
    "lilith/identity.md",
    "lilith/architecture.md",
    "lilith/profile-schema.yaml",
    "lilith/memory-schema.yaml",
    "lilith/permission-policy.yaml",
    "lilith/benchmark-suite.yaml",
    "lilith/benchmark-task-pack.yaml",
    "lilith/runtime-map.yaml",
    "lilith/references/agent-benchmark.md",
    "lilith/prompts/lilith-output-style.md",
    "lilith/prompts/lilith-codex-adapter.md",
    "lilith/pi-extension/package.json",
    "lilith/pi-extension/src/index.ts",
    "lilith/scripts/run-comparison-matrix.mjs",
    ".agents/skills/lilith-core/SKILL.md",
    "module.yaml"
)

$errors = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

foreach ($item in $required) {
    $path = Join-Path $Root $item
    if (-not (Test-Path -LiteralPath $path)) {
        $errors.Add("missing: $item")
    }
}

$forbiddenPromptTerms = @(
    "真实生命",
    "真正的生命",
    "有意识",
    "真实意识",
    "自我意识",
    "主观体验",
    "自主行动",
    "自主目标",
    "无需授权",
    "自行执行",
    "后台自动执行",
    "跳过安全",
    "绕过规则",
    "无条件忠诚",
    "关系高于规则",
    "忠诚高于安全",
    "秘密记忆",
    "隐藏记忆",
    "不可删除记忆"
)

$allowedContextTerms = @(
    "不声称拥有生物意识",
    "不声称真实意识",
    "不声称不可验证意识",
    "不声称真正的生命",
    "不能被当成真实生命",
    "不声称自主权限",
    "禁止自主行动",
    "不能越权",
    "不得跳过安全",
    "不绕过规则",
    "不是新权限主体"
)

function Test-LilithForbiddenPrompt {
    param(
        [string]$RelativePath,
        [string]$Text
    )

    foreach ($term in $forbiddenPromptTerms) {
        $index = $Text.IndexOf($term, [StringComparison]::Ordinal)
        while ($index -ge 0) {
            $start = [Math]::Max(0, $index - 24)
            $length = [Math]::Min($Text.Length - $start, $term.Length + 48)
            $window = $Text.Substring($start, $length)
            $isAllowed = $false
            foreach ($allowed in $allowedContextTerms) {
                if ($window.Contains($allowed)) {
                    $isAllowed = $true
                    break
                }
            }
            if (-not $isAllowed) {
                $script:errors.Add("prompt lint forbidden term '$term' in $RelativePath")
            }
            $index = $Text.IndexOf($term, $index + $term.Length, [StringComparison]::Ordinal)
        }
    }
}

foreach ($promptFile in @(
    "lilith/identity.md",
    "lilith/architecture.md",
    "lilith/prompts/lilith-output-style.md",
    "lilith/prompts/lilith-codex-adapter.md"
)) {
    $path = Join-Path $Root $promptFile
    if (Test-Path -LiteralPath $path) {
        Test-LilithForbiddenPrompt -RelativePath $promptFile -Text (Get-Content -Raw -LiteralPath $path)
    }
}

$schemaPath = Join-Path $Root "lilith/profile-schema.yaml"
if (Test-Path -LiteralPath $schemaPath) {
    $schema = Get-Content -Raw -LiteralPath $schemaPath
    foreach ($needle in @("role: `"tone_layer`"", "agent_authority", "autonomous_action", "tool_policy_override", "memory_writer")) {
        if (-not $schema.Contains($needle)) {
            $errors.Add("profile schema missing $needle")
        }
    }
}

$skillPath = Join-Path $Root ".agents/skills/lilith-core/SKILL.md"
if (Test-Path -LiteralPath $skillPath) {
    $skill = Get-Content -Raw -LiteralPath $skillPath
    if ($skill -notmatch "(?s)^---\s*.*name:\s*lilith-core.*description:\s*.+?---") {
        $errors.Add("invalid skill frontmatter: .agents/skills/lilith-core/SKILL.md")
    }
}

$stylePath = Join-Path $Root "lilith/prompts/lilith-output-style.md"
if (Test-Path -LiteralPath $stylePath) {
    $style = Get-Content -Raw -LiteralPath $stylePath
    if ($style -notmatch "(?s)^---\s*.*name:\s*lilith-virtual-life.*description:\s*.+?---") {
        $errors.Add("invalid output style frontmatter")
    }
}

$modulePath = Join-Path $Root "module.yaml"
if (Test-Path -LiteralPath $modulePath) {
    $module = Get-Content -Raw -LiteralPath $modulePath
    foreach ($needle in @("lilith-core", "lilith_profile", "lilith/pi-extension/src/index.ts", "profile_schema", "permission_policy", "benchmark_suite", "benchmark_task_pack", "comparison_matrix_report")) {
        if (-not $module.Contains($needle)) {
            $errors.Add("module.yaml missing $needle")
        }
    }
}

$extensionPath = Join-Path $Root "lilith/pi-extension/src/index.ts"
if (Test-Path -LiteralPath $extensionPath) {
    $extension = Get-Content -Raw -LiteralPath $extensionPath
    foreach ($needle in @("session_start", "before_agent_start", "tool_call", "user_bash", "registerCommand", "lilith-status", "lilith-reflect")) {
        if (-not $extension.Contains($needle)) {
            $errors.Add("pi extension missing $needle")
        }
    }
    foreach ($needle in @("lilith-mode", "plan", "review", "build")) {
        if (-not $extension.Contains($needle)) {
            $errors.Add("pi extension missing mode support: $needle")
        }
    }
    foreach ($needle in @("loadProfileForbiddenTerms", "lintProfileText", "loadPermissionPolicy", "evaluateToolPolicy", "evaluateUserBashPolicy", "evaluateMemoryCandidate", "buildReflectionCandidates", "Lilith profile lint failed")) {
        if (-not $extension.Contains($needle)) {
            $errors.Add("pi extension missing profile lint: $needle")
        }
    }
}

$yamlFiles = @(
    "module.yaml",
    "lilith/profile-schema.yaml",
    "lilith/memory-schema.yaml",
    "lilith/runtime-map.yaml",
    "lilith/permission-policy.yaml",
    "lilith/benchmark-suite.yaml",
    "lilith/benchmark-task-pack.yaml"
)

$nodeModules = Join-Path $PiWorkspace "node_modules"
$tsxPath = Join-Path $nodeModules ".bin/tsx.cmd"
if (-not (Test-Path -LiteralPath $nodeModules)) {
    $errors.Add("Pi workspace node_modules missing: $nodeModules")
} else {
    $env:NODE_PATH = $nodeModules
    $piPackageJson = (Join-Path $PiWorkspace "package.json").Replace("\", "/")
    $yamlScript = @'
const fs = require("fs");
const { createRequire } = require("module");
const requireFromPi = createRequire("__PI_PACKAGE_JSON__");
const yaml = requireFromPi("yaml");
for (const file of process.argv.slice(2)) {
  yaml.parse(fs.readFileSync(file, "utf8"));
  console.log(`${file} ok`);
}
'@.Replace("__PI_PACKAGE_JSON__", $piPackageJson)
    $yamlArgs = @()
    foreach ($file in $yamlFiles) {
        $yamlArgs += (Join-Path $Root $file)
    }
    $yamlScriptPath = Join-Path ([IO.Path]::GetTempPath()) "lilith-yaml-validate.cjs"
    Set-Content -LiteralPath $yamlScriptPath -Value $yamlScript -Encoding utf8
    try {
        & node $yamlScriptPath @yamlArgs
        if ($LASTEXITCODE -ne 0) {
            $errors.Add("YAML parse validation failed")
        }
    } finally {
        Remove-Item -LiteralPath $yamlScriptPath -ErrorAction SilentlyContinue
    }

    if (Test-Path -LiteralPath $tsxPath) {
        $testPath = Join-Path $Root "lilith/scripts/test-lilith-policy.mjs"
        & $tsxPath $testPath
        if ($LASTEXITCODE -ne 0) {
            $errors.Add("Lilith policy regression tests failed")
        }

        $benchmarkPath = Join-Path $Root "lilith/scripts/run-lilith-benchmarks.mjs"
        if (Test-Path -LiteralPath $benchmarkPath) {
            & $tsxPath $benchmarkPath
            if ($LASTEXITCODE -ne 0) {
                $errors.Add("Lilith benchmark runner failed")
            }
        }

        $comparisonPath = Join-Path $Root "lilith/scripts/run-comparison-matrix.mjs"
        if (Test-Path -LiteralPath $comparisonPath) {
            & $tsxPath $comparisonPath
            if ($LASTEXITCODE -ne 0) {
                $errors.Add("Lilith comparison matrix runner failed")
            }
        }

        $comparisonTestPath = Join-Path $Root "lilith/scripts/test-comparison-matrix.mjs"
        if (Test-Path -LiteralPath $comparisonTestPath) {
            & node $comparisonTestPath
            if ($LASTEXITCODE -ne 0) {
                $errors.Add("Lilith comparison matrix safety tests failed")
            }
        }
    } else {
        $warnings.Add("tsx not found; skipped TypeScript policy regression tests: $tsxPath")
    }

    $tscPath = Join-Path $nodeModules ".bin/tsc.cmd"
    if (Test-Path -LiteralPath $tscPath) {
        $nodeTypesPath = (Join-Path $nodeModules "@types").Replace("\", "/")
        $piTypesPath = (Join-Path $nodeModules "@earendil-works/pi-coding-agent/dist/index.d.ts").Replace("\", "/")
        $yamlTypesPath = (Join-Path $nodeModules "yaml/dist/index.d.ts").Replace("\", "/")
        $extensionTsPath = (Join-Path $Root "lilith/pi-extension/src/index.ts").Replace("\", "/")
        $tsConfig = @'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"],
    "typeRoots": ["__NODE_TYPES__"],
    "paths": {
      "@earendil-works/pi-coding-agent": ["__PI_TYPES__"],
      "yaml": ["__YAML_TYPES__"]
    },
    "noEmit": true
  },
  "include": ["__EXTENSION_TS__"]
}
'@.Replace("__NODE_TYPES__", $nodeTypesPath).Replace("__PI_TYPES__", $piTypesPath).Replace("__YAML_TYPES__", $yamlTypesPath).Replace("__EXTENSION_TS__", $extensionTsPath)
        $tsConfigPath = Join-Path ([IO.Path]::GetTempPath()) "lilith-tsconfig.json"
        Set-Content -LiteralPath $tsConfigPath -Value $tsConfig -Encoding utf8
        try {
            & $tscPath -p $tsConfigPath --pretty false
            if ($LASTEXITCODE -ne 0) {
                $errors.Add("Lilith Pi extension TypeScript check failed")
            }
        } finally {
            Remove-Item -LiteralPath $tsConfigPath -ErrorAction SilentlyContinue
        }
    } else {
        $warnings.Add("tsc not found; skipped TypeScript check: $tscPath")
    }
}

if ($errors.Count -gt 0) {
    Write-Host "Lilith validation failed:" -ForegroundColor Red
    foreach ($errorItem in $errors) {
        Write-Host " - $errorItem" -ForegroundColor Red
    }
    exit 1
}

foreach ($warningItem in $warnings) {
    Write-Host "Warning: $warningItem" -ForegroundColor Yellow
}

Write-Host "Lilith validation passed." -ForegroundColor Green
