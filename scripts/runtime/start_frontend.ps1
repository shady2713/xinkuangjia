# 从仓库入口启动管理前端，实际端口由应用开发配置决定。
$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$frontendRoot = Join-Path $repositoryRoot '前端代码/basic-framework-admin'
Set-Location -LiteralPath $frontendRoot
& pnpm.cmd dev:ele
exit $LASTEXITCODE
