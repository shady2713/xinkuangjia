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
| core Starter | Web、Security、MyBatis、Redis、保护、Quartz、Excel、部门数据权限、IP |
| module-system | 用户、组织、角色菜单、字典、认证、OAuth2、短信与日志 |
| module-infra | 参数配置、统一文件存储、任务管理、任务日志及 API 日志 |
| server | 启动扫描、全局配置、可执行 JAR；不承载业务规则 |

启动类扫描配置的基础包 `com.basicframework` 下的 `server` 与 `module`；Starter 由 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` 装配。新模块不仅要有源码，还需进入聚合 POM 与 server 依赖。MQ Starter 目录未进入当前 core 聚合清单，不能把它当作已经装配的消息消费服务。

版本以[根 POM](../../后端代码/basic-framework-boot/pom.xml)和[BOM](../../后端代码/basic-framework-boot/basic-framework-dependencies/pom.xml)为准：MyBatis 3.5.19、MyBatis-Plus 3.5.17、Redisson 3.52.0、Springdoc 2.8.17、Knife4j 4.5.0；MinIO 客户端使用 AWS SDK S3，BOM 为 2.54.7，不是 MinIO Java SDK。

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

新查询应使用项目分页和查询基类；用户身份取认证上下文，不信任请求中的用户、部门或权限字段。部门数据权限仅作用于已登记规则和对应 SQL 路径，应验证越权读取与更新，不宣称所有表自动隔离。

## 认证和权限

账号、令牌与操作权限由 system 提供；浏览器路由不是授权边界。

- 账号密码界面调用 `/system/auth/super-admin-login`；普通 `/login`、共享票据与短信等入口仍在服务端。超级管理员入口与普通入口分别校验用户平台类型，权限信息也按角色、菜单平台类型过滤。新增用户、角色或菜单须保持这些契约一致。
- `TokenAuthenticationFilter` 在 Security 过滤链中读取令牌，通过 OAuth2 Token API 校验并设置当前身份。匿名路径由 `@PermitAll`、Security 配置与模块定制共同决定，其余请求要求认证。
- 操作权限使用 `@PreAuthorize("@ss.hasPermission('域:资源:操作')")`，由权限服务计算角色和菜单关系；权限码须与菜单及前端按钮一致。数据范围是另一层约束，不能用按钮权限代替。
- access/refresh Token 存入 MySQL，access Token 有 Redis 缓存。查询先读缓存，未命中读数据库并回填，校验检查有效期；刷新与撤销由令牌服务维护。不能只删除浏览器 Token 就声称服务端登录态已撤销。

图形验证码使用 Anji Captcha 和 Redis，服务端启用开关与前端显示开关须一致。默认 `CAPTCHA_AES_STATUS=false` 对应当前前端坐标协议，不能只在后端开启 AES 就认为双方兼容。

## 数据与缓存

MyBatis Starter 管理 MySQL 访问，Redis Starter 管理缓存。运行时配置见[服务器部署](../部署/部署说明.md#准备目录与配置)。

主库名为 `master`，配置使用 `DB_*`；从库使用 `DB_SLAVE_*`，未提供时回退主库。启用严格数据源匹配，写错数据源名不应按默认库悄悄运行。MyBatis-Plus 开启下划线到驼峰与逻辑删除约定，DO 沿用公共审计字段及相邻模块的映射。

权限关系使用 `@Cacheable`、`@CacheEvict`；普通 Spring Redis Cache 默认 TTL 为一小时，不代表每个 Token、验证码和业务缓存都采用同一期限。更改权限应走对应 Service 失效流程；直接 SQL 修改不会触发缓存注解，联调时要明确刷新目标缓存或重新装配权限，不能无差别清空共享 Redis。

当前配置未接入 Flyway 迁移脚本或自动迁移入口。初始化 SQL 是导入资料，包含哪些重建语句须以实际文件为准；已有库升级需单独设计可回退变更，不应启动应用时自动导入整库。

## 文件和调度

文件读写与调度都复用 infra 的公共入口，不在新业务中另建存储配置表或自行操作 Quartz。

文件默认链路为上传 Controller → FileService → FileStorageService → S3 客户端。FileStorageService 在启动时根据 `basic-framework.file.minio` 创建唯一客户端，在销毁时关闭连接；配置来自 `MINIO_*`。文件服务检查名称、路径、类型，上传内容后登记元数据；对象键包含随机标识，避免同名并发请求依赖毫秒时间戳。公开读取 URL 由 `MINIO_PUBLIC_URL` 和桶生成，客户端读取不会用用户 Token 保护对象。

批量删除逐项完成对象及元数据删除；后续失败时先前已完成项保持生效，客户端应刷新列表后重试剩余项。该行为不提供整个批次的回滚。

后端上传和直传先持久化用户预约与日预算。直传签名只允许写暂存键，服务端有界读取并验证真实内容后写入独立最终键，元数据与完成状态同事务提交；过期和失败预约由持久化补偿清理。对象存储与 MySQL 不构成同一事务，未知提交结果不能触发盲目删除。协议、迁移和真实中间件测试见[文件上传与故障恢复](../部署/文件上传协议.md)。

Quartz 管理任务调度，infra 的 `JobService` 管理 handler、Cron 和日志。handler 是 Spring Bean 名称，新增任务需实现 core 的 `JobHandler` 并注册 Bean。当前 YAML 没有映射 `.env.example` 中 `QUARTZ_AUTO_STARTUP` 或 `QUARTZ_JDBC_INITIALIZE_SCHEMA`，也未配置 JDBC JobStore；需要这些能力时使用 Spring 标准 `spring.quartz.*` 配置并验证。`infra_job` 的存在不证明调度状态已写入 `QRTZ_*` 表。

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
