# basic-framework-boot

极简政企管理平台 Java 后端（Spring Boot 3.5 + JDK 17，3 模块架构）。

## 模块划分

- `basic-framework-core`：公共基类与技术层（Web/XSS/Jackson/Swagger、Security、原生 `@OperateLog` AOP、MyBatis-Plus 与部门数据权限、Redis 缓存、FastExcel）。
- `basic-framework-system`：系统核心业务（双平台认证与 SM2 密码传输、anji-plus 滑块验证码、用户/角色/菜单/部门 RBAC、字典、OAuth2 开放应用与令牌、登录/操作审计日志、极简阿里云短信、本地磁盘/阿里云 OSS 统一文件存储）。
- `basic-framework-server`：应用启动装配、环境配置、ArchUnit/Schema/OpenAPI 契约测试与生产 Dockerfile。

## 常用命令

```bash
# 运行全量质量门禁（单测 + H2 集成 + ArchUnit + Schema/RBAC + OpenAPI + JaCoCo + PMD）
mvn -B -ntp -Pquality-gate verify

# 接口变更后刷新前端 OpenAPI 快照
mvn -B -ntp -Pquality-gate verify -Dopenapi.update=true

# 本地启动服务（默认端口 48080，需先执行根目录 scripts/runtime/init_local_dev.py --apply）
mvn -B -pl basic-framework-server spring-boot:run

# 构建生产可执行 JAR
mvn -B -ntp clean package -DskipTests
```
