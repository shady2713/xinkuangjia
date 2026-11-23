# 在 Java 工程根目录启动应用，使 application.yaml 能读取被忽略的 .env。
param([switch]$Build)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$javaRoot = Join-Path $repositoryRoot '后端代码/basic-framework-boot'
Set-Location -LiteralPath $javaRoot
$envFile = Join-Path $javaRoot '.env'
$profileGuidance = "Add the line SPRING_PROFILES_ACTIVE=local to $envFile (older env files may lack it; keep all other values unchanged), or set the explicit override for this session: `$env:SPRING_PROFILES_ACTIVE = 'local'"
if (-not (Test-Path -LiteralPath '.env')) {
    throw ('缺少 Java .env，请先运行 init_local_dev.py --apply 或按 .env.example 配置数据库与 Redis。' + ' ' + $profileGuidance)
}
$processProfile = [Environment]::GetEnvironmentVariable('SPRING_PROFILES_ACTIVE', 'Process')
if (-not [string]::IsNullOrEmpty($processProfile)) {
    $selectedProfile = $processProfile.Trim()
    $profileSource = 'the process environment variable SPRING_PROFILES_ACTIVE'
} else {
    $selectedProfile = $null
    $profileSource = $envFile
    foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
        if ($line -cmatch '^\s*SPRING_PROFILES_ACTIVE\s*[=:]\s*(.*?)\s*$') {
            $selectedProfile = $Matches[1]
        }
    }
}
if ($null -eq $selectedProfile) {
    throw "SPRING_PROFILES_ACTIVE is not set in $profileSource, so the application would start with the prod defaults. $profileGuidance"
}
if ($selectedProfile -cne 'local') {
    throw "This local launcher requires SPRING_PROFILES_ACTIVE=local, Check $profileSource. $profileGuidance"
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
& java '-Dfile.encoding=UTF-8' -jar $jarFile '--spring.profiles.active=local'
exit $LASTEXITCODE
