---
description: "说明 Java 后端的模块装配、接口分层、安全令牌、权限缓存和统一 MinIO 文件链路，供新增业务或排查后端行为时查阅。"
kind: package-reference
---

# Java 后端架构

## 摘要

Java 工程位于 `后端代码/basic-framework-boot`，编译目标 Java 17，采用 Spring Boot 3.5.16 与 Maven 多模块。server 将 system 与 infra 装配为一个应用，公共基础能力由 core Starter 提供。业务开发通过模块、Service 和 API/DTO 扩展，运行依赖 MySQL、Redis 和统一 MinIO。

## 目录

- [模块与依赖方向](#模块与依赖方向)
- [业务开发与接口边界](#业务开发与接口边界)
- [认证和权限](#认证和权限)
- [数据与缓存](#数据与缓存)
- [文件和调度](#文件和调度)
- [实现入口](#实现入口)
- [验证与限制](#验证与限制)

## 模块与依赖方向

业务模块依赖通用能力，server 依赖业务模块，core 保持业务无关。

| 模块 | 当前职责 |
| --- | --- |
| dependencies | BOM 与第三方、内部依赖版本 |
| core/common | 结果、分页、异常、工具与公共类型 |
| core Starter | Web、Security、MyBatis、Redis、Quartz、Excel、部门数据权限、IP |
| module-system | 用户、组织、角色菜单、字典、认证、OAuth2、短信与日志 |
| module-infra | 参数配置、统一文件存储、任务管理、任务日志及 API 日志 |
| server | 启动扫描、全局配置、可执行 JAR；不承载业务规则 |

启动类扫描配置的基础包 `com.basicframework` 下的 `server` 与 `module`；Starter 由 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` 装配。新模块不仅要有源码，还需进入聚合 POM 与 server 依赖（可使用 `scripts/scaffold/new_java_module.py` 一键注册并分配错误码号段，模块内标准 CRUD 骨架可使用 `scripts/scaffold/new_java_crud.py` 生成）。

版本以[根 POM](../../后端代码/basic-framework-boot/pom.xml)和[BOM](../../后端代码/basic-framework-boot/basic-framework-dependencies/pom.xml)为准：MyBatis 3.5.19、MyBatis-Plus 3.5.18.1、Redisson 3.52.0、Springdoc 2.8.17、Knife4j 4.5.0；MinIO 客户端使用 AWS SDK S3，BOM 为 2.57.12，不是 MinIO Java SDK。

## 业务开发与接口边界

Controller 负责协议与校验，Service 负责业务规则，Mapper 与客户端负责资源访问。跨模块依赖提供方 API，而不读取其内部 Mapper 或 DO。

| 层 | 模块内位置 | 应承担的工作 |
| --- | --- | --- |
| Controller、VO | `controller/admin` 或 `controller/app` | 路由、请求校验、授权、响应转换 |
| Service | `service` | 用例、状态变化、事务与资源编排 |
| Mapper、DO | `dal/mysql`、`dal/dataobject` | SQL、索引相关查询与持久化字段 |
| Redis DAO | `dal/redis` | 明确缓存键、期限与失效责任 |
| API、DTO | `api` | 稳定跨模块调用契约 |
| Convert | `convert` | VO、DTO、DO 转换；沿用相邻实现的工具 |
| Job | `job` | 实现调度入口，委托 Service 执行业务 |

Web Starter 按 Controller 包匹配自动加前缀：`controller.admin` 为 `/admin-api`，`controller.app` 为 `/app-api`。例如 Controller 声明 `/system/user`，管理请求实际访问 `/admin-api/system/user`；不要在 Controller 中再写一次前缀。常规接口返回 `CommonResult`，分页使用 `PageResult`，导出等接口按对应协议输出，不能机械套结果拆包。

传输序列化与错误码规范由公共组件统一约束：

- **JSON 与 Excel 传输契约**：`LocalDateTime` 统一序列化/反序列化为毫秒级时间戳（epoch-ms `number`）；超过 JavaScript 安全整数（`> 2^53 - 1`）的 `Long` 值自动序列化为 JSON 字符串，FastExcel 导出通过 `LongPlainStringWriteConverter` 转为纯数字文本防止科学计数法精度丢失。
- **模块错误码号段**：业务异常统一登记在 `ServiceErrorCodeRange` 与模块 `ErrorCodeConstants`（`system` 为 `1-002-000-000`，`infra` 为 `1-001-000-000`，新建业务模块从 `1-003-000-000` 起按百万步长分配），禁止直接抛出裸 `RuntimeException`。
- **链路追踪日志**：请求过滤链自动将链路标识写入 SLF4J MDC `traceId`（日志格式包含 `[%X{traceId:-}]`），便于跨 Controller、Service 与异常处理器检索同一请求日志。
- **OpenAPI 契约快照**：Controller 签名或 VO 字段变更后，通过 `OpenApiContractSnapshotTest`（携带 `-Dopenapi.update=true`）更新 `apps/web-ele/src/api/generated/openapi.json`，再运行前端 `pnpm api:gen` 同步 TypeScript 类型。

新查询应使用项目分页和查询基类；用户身份取认证上下文，不信任请求中的用户、部门或权限字段。部门数据权限仅作用于已登记规则和对应 SQL 路径，写操作（更新、删除、分配角色/状态）必须在 Service 层显式校验目标记录在当前登录者可访问的数据范围内，防止只拦截列表查询而漏放单条 ID 修改。

## 认证和权限

账号、令牌与操作权限由 system 提供；浏览器路由不是授权边界。

- 账号密码界面调用 `/system/auth/super-admin-login`；普通 `/login` 和短信 `/sms-login` 入口按业务管理平台校验账号平台类型。超级管理员（`super_admin`）拥有全局全量权限；业务管理员（`business_admin`）受所属平台与数据权限约束，严禁修改或接管 `super_admin` 角色及账号。
- `TokenAuthenticationFilter` 在 Security 过滤链中读取令牌，通过 OAuth2 Token API 校验并设置当前身份。匿名路径由 `@PermitAll`、Security 配置与 `FootgunRules.PERMIT_ALL_ALLOWLIST` 共同锁定，其余请求要求认证。
- 操作权限使用 `@PreAuthorize("@ss.hasPermission('域:资源:操作')")`，由权限服务计算角色和菜单关系；权限码须与 `system_menu` 及前端按钮一致（由 `SchemaDoRbacParityTest` 自动校验）。数据范围是另一层约束，不能用按钮权限代替。
- access/refresh Token 存入 MySQL，access Token 有 Redis 缓存。查询先读缓存，未命中读数据库并回填，校验检查有效期；刷新与撤销由令牌服务维护。不能只删除浏览器 Token 就声称服务端登录态已撤销。

图形验证码使用 Anji Captcha 和 Redis，服务端启用开关与前端显示开关须一致。默认 `CAPTCHA_AES_STATUS=false` 对应当前前端坐标协议，不能只在后端开启 AES 就认为双方兼容。

## 数据与缓存

MyBatis Starter 管理 MySQL 访问，Redis Starter 管理缓存。运行时配置见[服务器部署](../部署/部署说明.md#准备目录与配置)。

主库名为 `master`，配置使用 `DB_*`；从库使用 `DB_SLAVE_*`，未提供时回退主库。启用严格数据源匹配，写错数据源名不应按默认库悄悄运行。MyBatis-Plus 开启下划线到驼峰与逻辑删除约定：无业务唯一索引的普通表继承 `BaseDO`；含业务唯一键的表继承 `UniqueBaseDO`（附加 `deleted_tag bigint NOT NULL DEFAULT 0`，唯一索引建在 `(业务唯一列, deleted_tag)` 上），由 `SoftDeleteUniqueInnerInterceptor` 在逻辑删除时自动重写 `SET deleted = 1, deleted_tag = id`，保证同名记录删除后可安全重建且活跃记录严格唯一。`SchemaDoRbacParityTest` 在构建期自动核验全部 DO 与 `basic_framework.sql` 的表列对齐。

权限关系使用 `@Cacheable`、`@CacheEvict`；普通 Spring Redis Cache 默认 TTL 为一小时，不代表每个 Token、验证码和业务缓存都采用同一期限。更改权限应走对应 Service 失效流程；直接 SQL 修改不会触发缓存注解，联调时要明确刷新目标缓存或重新装配权限，不能无差别清空共享 Redis。

当前配置未接入 Flyway 迁移脚本或自动迁移入口。初始化 SQL 是导入资料，包含哪些重建语句须以实际文件为准；已有库升级需单独设计可回退变更，不应启动应用时自动导入整库。

## 文件和调度

文件读写与调度都复用 infra 的公共入口，不在新业务中另建存储配置表或自行操作 Quartz。

文件默认链路为上传 Controller → FileService → FileStorageService → S3 客户端。FileStorageService 在启动时根据 `basic-framework.file.minio` 创建唯一客户端，在销毁时关闭连接；配置来自 `MINIO_*`。文件服务检查名称、路径、类型，上传内容后登记元数据；路径唯一化避免同名覆盖。公开读取 URL 由 `MINIO_PUBLIC_URL` 和桶生成，客户端读取不会用用户 Token 保护对象。

直传链路获取预签名 PUT 地址、浏览器上传、再登记文件；跨域与浏览器可达 endpoint 是额外条件。对象存储与 MySQL 不构成同一事务，失败补偿要按实际代码和业务情况验证，不能把数据库事务描述为全资源原子提交。

Quartz 管理任务调度，infra 的 `JobService` 管理 handler、Cron 和日志。handler 是 Spring Bean 名称，新增任务需实现 core 的 `JobHandler` 并注册 Bean。默认配置未启用 Quartz JDBC JobStore；需要持久化调度时按 Spring 标准 `spring.quartz.*` 属性配置并验证。`infra_job` 的存在不证明调度状态已写入 `QRTZ_*` 表。

## 实现入口

<details>
<summary>关键组件源码映射</summary>

| 文件 | 支持内容 |
| --- | --- |
| [启动类](../../后端代码/basic-framework-boot/basic-framework-server/src/main/java/com/basicframework/server/BasicFrameworkServerApplication.java) | 组件扫描范围 |
| [全局配置](../../后端代码/basic-framework-boot/basic-framework-server/src/main/resources/application.yaml) | 数据库、缓存、安全与存储配置 |
| [WebProperties](../../后端代码/basic-framework-boot/basic-framework-core/basic-framework-spring-boot-starter-web/src/main/java/com/basicframework/framework/web/config/WebProperties.java) | API 前缀与 Controller 包匹配 |
| [认证 Controller](../../后端代码/basic-framework-boot/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/auth/AuthController.java) | 登录、刷新与权限信息入口 |
| [令牌服务](../../后端代码/basic-framework-boot/basic-framework-module-system/src/main/java/com/basicframework/module/system/service/oauth2/OAuth2TokenServiceImpl.java) | MySQL 与 Redis 令牌生命周期 |
| [权限服务](../../后端代码/basic-framework-boot/basic-framework-module-system/src/main/java/com/basicframework/module/system/service/permission/PermissionServiceImpl.java) | 角色菜单关系与缓存 |
| [文件服务](../../后端代码/basic-framework-boot/basic-framework-module-infra/src/main/java/com/basicframework/module/infra/service/file/FileServiceImpl.java)、[存储服务](../../后端代码/basic-framework-boot/basic-framework-module-infra/src/main/java/com/basicframework/module/infra/service/file/FileStorageServiceImpl.java) | 元数据与对象存储边界 |
| [调度服务](../../后端代码/basic-framework-boot/basic-framework-module-infra/src/main/java/com/basicframework/module/infra/service/job/JobServiceImpl.java) | Job 管理和调度调用 |

</details>

## 验证与限制

在 Java 工程根执行 `mvn -q test`，交付门禁使用 `mvn -q -Pquality-gate verify`；PMD、覆盖率配置和实际测试对象以当前 POM、报告为准。模块没有测试或覆盖率跳过时应如实记录，不能据此宣称全模块业务已验证。

Maven 验证之外，业务接口需验证正常、未授权、关键边界与失败恢复。短信需要有效渠道与模板，OAuth2 需要合法客户端与回调，文件需要真实存储，定时任务需要当前可执行 handler；这些外部链路不会因为 JAR 启动成功自动通过。部署入口见[Java README](../../后端代码/basic-framework-boot/README.md)。
