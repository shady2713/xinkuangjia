# 从脚本位置定位前端工作区，避免依赖开发者机器的绝对路径。
$ErrorActionPreference = 'Stop'
$frontendRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $frontendRoot
& pnpm.cmd dev:ele
exit $LASTEXITCODE
