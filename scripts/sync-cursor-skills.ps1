# 514cc Cursor Skills 符号链接同步
# 用法: .\scripts\sync-cursor-skills.ps1

$ErrorActionPreference = "Stop"
$base = Split-Path $PSScriptRoot -Parent
$skillsDir = Join-Path $base ".cursor\skills"
New-Item -ItemType Directory -Path $skillsDir -Force | Out-Null

$map = @{
    "auto-pilot"       = "skills\orchestration\auto-pilot"
    "enhance"          = "skills\orchestration\enhance"
    "party-mode"       = "skills\orchestration\party-mode"
    "codex-reviewer"   = "skills\review\codex-reviewer"
    "adversarial"      = "skills\review\adversarial"
    "grok-researcher"= "skills\research\grok-researcher"
    "web-intel"        = "skills\research\web-intel"
    "embedded-expert"  = "skills\domain\embedded-expert"
    "spec-architect"   = "skills\domain\spec-architect"
    "meta-reviewer"    = "skills\meta\meta-reviewer"
    "help"             = "skills\meta\help"
    "init"             = "skills\utility\init"
    "status"           = "skills\utility\status"
    "archive"          = "skills\utility\archive"
}

$coAliases = @{
    "co-auto"     = "auto-pilot"
    "co-enhance"  = "enhance"
    "co-review"   = "codex-reviewer"
    "co-research" = "grok-researcher"
    "co-init"     = "init"
    "co-status"   = "status"
    "co-archive"  = "archive"
}

foreach ($name in $map.Keys) {
    $link = Join-Path $skillsDir $name
    $target = Join-Path $base $map[$name]
    if (-not (Test-Path $target)) { Write-Warning "missing target: $target"; continue }
    if (Test-Path $link) { Remove-Item $link -Force -Recurse -ErrorAction SilentlyContinue }
    New-Item -ItemType Junction -Path $link -Target $target -Force | Out-Null
    Write-Host "linked: $name"
}

foreach ($coName in $coAliases.Keys) {
    $link = Join-Path $skillsDir $coName
    $targetName = $coAliases[$coName]
    $target = Join-Path $skillsDir $targetName
    if (-not (Test-Path $target)) { Write-Warning "missing alias target: $target"; continue }
    if (Test-Path $link) { Remove-Item $link -Force -Recurse -ErrorAction SilentlyContinue }
    New-Item -ItemType Junction -Path $link -Target $target -Force | Out-Null
    Write-Host "alias: $coName -> $targetName"
}

Write-Host "Done. Total: $((Get-ChildItem $skillsDir -Directory).Count) skills"
