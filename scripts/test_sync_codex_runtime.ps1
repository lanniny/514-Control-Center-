param(
    [string]$RepoSource = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$syncScript = Join-Path $PSScriptRoot "sync-codex-runtime.ps1"
$mergeScript = Join-Path $PSScriptRoot "merge_codex_config.py"
$engine = (Get-Process -Id $PID).Path
$root = Join-Path ([IO.Path]::GetTempPath()) ("514cc-sync-test-" + [guid]::NewGuid().ToString("N"))

function Assert-True($condition, $message) {
    if (-not $condition) { throw $message }
}

function New-TestRepo($path) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
    Copy-Item -LiteralPath (Join-Path $RepoSource ".codex") -Destination (Join-Path $path ".codex") -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $RepoSource ".agents") -Destination (Join-Path $path ".agents") -Recurse -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $path "scripts") | Out-Null
    Copy-Item -LiteralPath $mergeScript -Destination (Join-Path $path "scripts\merge_codex_config.py") -Force
}

function New-TestHome($path, [string]$config) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
    [IO.File]::WriteAllText((Join-Path $path "AGENTS.md"), "sentinel-agents`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $path "config.toml"), $config, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $path "hooks.json"), "{}`n", [Text.UTF8Encoding]::new($false))
}

function Invoke-Sync($repo, $runtimeHome, [switch]$Apply) {
    $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $syncScript)
    if ($Apply) { $arguments += "-Apply" }
    $arguments += @("-Repo", $repo, "-CodexHomePath", $runtimeHome)
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = @(& $engine @arguments 2>&1)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    return @{ ExitCode = $exitCode; Output = $output }
}

try {
    # A missing source must abort before AGENTS/config/backups/runtime directories change.
    $missingRepo = Join-Path $root "missing-repo"
    $missingHome = Join-Path $root "missing-home"
    New-TestRepo $missingRepo
    New-TestHome $missingHome "model = `"sentinel`"`n"
    Remove-Item -LiteralPath (Join-Path $missingRepo ".codex\agents\meta-reviewer.toml") -Force
    $agentsHash = (Get-FileHash -LiteralPath (Join-Path $missingHome "AGENTS.md") -Algorithm SHA256).Hash
    $configHash = (Get-FileHash -LiteralPath (Join-Path $missingHome "config.toml") -Algorithm SHA256).Hash
    $missingResult = Invoke-Sync $missingRepo $missingHome -Apply
    Assert-True ($missingResult.ExitCode -ne 0) "Missing-source Apply unexpectedly succeeded."
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $missingHome "AGENTS.md") -Algorithm SHA256).Hash -eq $agentsHash) "AGENTS changed after missing-source preflight failure."
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $missingHome "config.toml") -Algorithm SHA256).Hash -eq $configHash) "Config changed after missing-source preflight failure."
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $missingHome "backups"))) "Backup/write phase started after missing-source failure."

    # A malformed managed block must be rejected before a drifting AGENTS block is written.
    $malformedRepo = Join-Path $root "malformed-repo"
    $malformedHome = Join-Path $root "malformed-home"
    New-TestRepo $malformedRepo
    New-TestHome $malformedHome "model = `"sentinel`"`n# >>> 514cc managed block`n"
    $agentsHash = (Get-FileHash -LiteralPath (Join-Path $malformedHome "AGENTS.md") -Algorithm SHA256).Hash
    $configHash = (Get-FileHash -LiteralPath (Join-Path $malformedHome "config.toml") -Algorithm SHA256).Hash
    $malformedResult = Invoke-Sync $malformedRepo $malformedHome -Apply
    Assert-True ($malformedResult.ExitCode -ne 0) "Malformed-config Apply unexpectedly succeeded."
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $malformedHome "AGENTS.md") -Algorithm SHA256).Hash -eq $agentsHash) "AGENTS changed before config preflight failed."
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $malformedHome "config.toml") -Algorithm SHA256).Hash -eq $configHash) "Malformed config changed during failed preflight."
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $malformedHome "backups"))) "Backup/write phase started after malformed-config failure."

    # A normal Apply must converge, and a second Apply must be byte-idempotent.
    $successRepo = Join-Path $root "success-repo"
    $successHome = Join-Path $root "success-home"
    New-TestRepo $successRepo
    New-TestHome $successHome "model = `"sentinel`"`n"
    $first = Invoke-Sync $successRepo $successHome -Apply
    Assert-True ($first.ExitCode -eq 0) ("First Apply failed: " + ($first.Output -join " | "))
    $check = Invoke-Sync $successRepo $successHome
    Assert-True ($check.ExitCode -eq 0) ("Check after Apply failed: " + ($check.Output -join " | "))
    $agentsHash = (Get-FileHash -LiteralPath (Join-Path $successHome "AGENTS.md") -Algorithm SHA256).Hash
    $configHash = (Get-FileHash -LiteralPath (Join-Path $successHome "config.toml") -Algorithm SHA256).Hash
    $second = Invoke-Sync $successRepo $successHome -Apply
    Assert-True ($second.ExitCode -eq 0) ("Second Apply failed: " + ($second.Output -join " | "))
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $successHome "AGENTS.md") -Algorithm SHA256).Hash -eq $agentsHash) "Second Apply changed AGENTS bytes."
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $successHome "config.toml") -Algorithm SHA256).Hash -eq $configHash) "Second Apply changed config bytes."

    Write-Host "sync-codex-runtime preflight and idempotence tests passed"
} finally {
    if (Test-Path -LiteralPath $root) {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}
