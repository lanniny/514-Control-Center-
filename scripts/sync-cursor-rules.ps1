#Requires -Version 5.1
# 514cc Cursor Rules 同步入口（委托 Python 脚本）
param([switch]$Apply)
$py = Join-Path $PSScriptRoot "sync-cursor-rules.py"
if (-not (Test-Path $py)) { Write-Error "Missing $py"; exit 1 }
python $py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
