# 在 Java 工程根目录启动应用，使 application.yaml 能读取被忽略的 .env。
param([switch]$Build)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$javaRoot = Join-Path $repositoryRoot '后端代码/basic-framework-boot'
Set-Location -LiteralPath $javaRoot
if (-not (Test-Path -LiteralPath '.env')) {
    throw '缺少 Java .env，请按 .env.example 配置数据库、Redis 和 MinIO。'
}
if ($Build) {
    & mvn.cmd -q '-DskipTests' package
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
$jarFile = Join-Path $javaRoot 'basic-framework-server/target/basic-framework-server.jar'
if (-not (Test-Path -LiteralPath $jarFile)) {
    throw '缺少应用 Jar，请使用 -Build 或先执行 Maven 打包。'
}
& java '-Dfile.encoding=UTF-8' -jar $jarFile
exit $LASTEXITCODE
