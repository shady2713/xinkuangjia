---
description: "说明 basic-framework Java 后端的模块、环境配置、启动、测试与发布前提，供后端开发和管理前端联调时查阅。"
kind: package-reference
---

# basic-framework Java 后端

## 摘要

使用 Java 17、Spring Boot 3.5.16 和 Maven 多模块提供系统管理与基础设施 API，供管理前端和新增业务模块使用。server 聚合 system、infra 和 core Starter 为一个进程，运行依赖 MySQL、Redis 与统一 MinIO。模块不是独立微服务。

## 目录

- [目录与职责](#目录与职责)
- [环境与配置](#环境与配置)
- [本地启动](#本地启动)
- [常用验证](#常用验证)
- [开发与部署](#开发与部署)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 目录与职责

新增业务放入自己的模块，server 负责装配，core 保持业务无关。

| 模块 | 职责 |
| --- | --- |
| basic-framework-dependencies | BOM 和依赖版本 |
| basic-framework-core | common 及 Web、Security、MyBatis、Redis、Job、Excel、保护、数据权限、IP Starter |
| basic-framework-module-system | 用户、角色、菜单、部门、岗位、字典、认证、OAuth2、短信和日志 |
| basic-framework-module-infra | 参数配置、唯一 MinIO 文件存储、Quartz 任务与执行日志 |
| basic-framework-server | 启动扫描、运行配置与可执行 JAR |

实际聚合清单以[根 POM](pom.xml)、[core POM](basic-framework-core/pom.xml)和[server POM](basic-framework-server/pom.xml)为准。MQ Starter 源目录未进入当前 core 聚合，不要求为框架启动 RabbitMQ。

## 环境与配置

准备 JDK 17 或兼容运行时、Maven 3.8+、MySQL 8.x、Redis 和 MinIO；通过 `maven.compiler.release=17` 同时约束语法、字节码和 JDK API，不随本机 JDK 自动升级。构建保留源码行号用于故障定位与逐行覆盖率；更改编译配置后应执行干净构建，不能沿用旧 class 文件证明新配置生效。

配置入口为 [application.yaml](basic-framework-server/src/main/resources/application.yaml)，Java 工程根的本机文件为 `.env`，按 [.env.example](.env.example)填写。实际凭据只放被忽略的文件或受控环境，不进入 SQL、文档或前端。Spring 按当前工作目录读取 `.env` 或 `../.env`；IDE 工作目录应为本工程根或 server 模块。

| 配置 | 映射及条件 |
| --- | --- |
| HTTP | `SERVER_PORT` 默认 48080；`SPRING_PROFILES_ACTIVE` 默认 local |
| 主库 | `DB_HOST` 默认 127.0.0.1、`DB_PORT` 默认 3306；库名、账号、密码须填写 |
| 从库 | `DB_SLAVE_*` 未提供时回退主库；只用一库时可移除样例中的从库覆盖值 |
| Redis | `REDIS_HOST`、`REDIS_PORT`、`REDIS_DATABASE`、`REDIS_PASSWORD`；默认 127.0.0.1:6379/0 |
| MinIO | `MINIO_ENDPOINT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_BUCKET`、`MINIO_SECURE`、`MINIO_REGION`、`MINIO_PUBLIC_URL` 均按实际环境填写 |
| 浏览器入口 | `ADMIN_UI_URL` 默认 http://localhost:5175；对象公开地址必须从浏览器可达 |
| 文档接口 | `SPRINGDOC_API_DOCS_ENABLED`、`SPRINGDOC_SWAGGER_UI_ENABLED`、`KNIFE4J_ENABLED` 默认 false |
| 日志 | `LOG_FILE` 默认 logs/basic-framework-server.log |

`.env` 按 Java properties 读取，值不加 shell 引号；示例中的 `your_*` 是占位值，使用前替换。与 Docker 共用 MinIO 配置时，`MINIO_SECURE` 使用 `true` 或 `false`，endpoint 与 TLS 实际方式一致。不要把宿主机 localhost 当作容器中的外部服务地址。

数据库使用[独立迁移入口](../../docs/部署/数据库初始化与迁移.md)，不由应用启动执行。`CORS_ALLOWED_ORIGIN` 已绑定为精确来源列表，留空关闭跨域；禁止通配符。转发头使用 Tomcat 原生处理，`TRUSTED_PROXY_REGEX` 默认不信任任何代理，见[服务器配置](../../docs/部署/部署说明.md#准备目录与配置)。

## 本地启动

以下 Java 命令在本 README 所在目录执行。先准备数据库和中间件；不要在应用启动时向已有库自动导入整库 SQL。

1. 按[数据库初始化与迁移](../../docs/部署/数据库初始化与迁移.md)核实目标，在授权空库执行版本化迁移并创建初始管理员；已有库使用经核对的升级与恢复流程。
2. 按环境样例建立本机配置；通用服务器的中间件安装见[部署说明](../../docs/部署/部署说明.md#安装中间件与初始化数据库)，个人开发环境按自己的服务地址填写。
3. 运行测试并生成 JAR：

```powershell
mvn -q test
mvn -q -DskipTests package
java -Dfile.encoding=UTF-8 -jar basic-framework-server/target/basic-framework-server.jar
```

第二条命令跳过测试，不能替代第一条或交付门禁。也可在 IDE 运行 [BasicFrameworkServerApplication](basic-framework-server/src/main/java/com/basicframework/server/BasicFrameworkServerApplication.java)。

从仓库根运行 `pwsh -File scripts/runtime/start_java.ps1 -Build` 可打包后启动；脚本需要 PATH 上的 `mvn.cmd` 与 `java`。不加 `-Build` 使用已有 JAR。默认服务 http://127.0.0.1:48080；检查 Started 日志、实际认证和权限接口，不能只看进程或端口。

## 常用验证

选择与改动相符的测试，并在发布前检查最终版本。

| 命令 | 用途 |
| --- | --- |
| `mvn -q test` | 实际 Surefire 测试；核对数量、失败与跳过 |
| `mvn -q -Pquality-audit verify` | 测试、PMD、JaCoCo 及覆盖缺口报告；审计不能替代最终门禁 |
| `mvn -q -Pquality-gate verify` | 测试、PMD、JaCoCo；每个手写生产文件 LINE/METHOD 全覆盖门禁 |
| `mvn -q -DskipTests package` | 生成应用 JAR，不证明测试通过 |
| `python -B -X utf8 scripts/code/check_worktree_comments.py`，仓库根 | 当前工作区 Java/Python 注释检查 |

报告来自当前模块的测试与质量结果；未执行的外部短信、OAuth2、文件和调度场景另列。测试与失败边界见[测试策略](../../docs/测试与可靠性/测试策略.md)。

## 开发与部署

<details>
<summary>后端开发入口与资源边界</summary>

Controller 的 admin 包自动获得 `/admin-api` 前缀，Service 编排业务，Mapper 管理持久化，模块间通过提供方 API/DTO 交互。身份来自 Security 上下文，操作用现有权限表达式校验，DO 不作为稳定对外契约。

访问令牌以数据库当前记录为权威，密码修改会撤销该用户全部访问与刷新会话；旧 Redis 令牌缓存不能恢复已撤销身份。角色菜单和短信预算仍有各自缓存生命周期。开放注册默认关闭，分享登录不受支持。文件统一交给 infra 文件 API，上传预约、实际内容核验、日预算与持久化补偿见[文件上传协议](../../docs/部署/文件上传协议.md)。

详见[Java 后端架构](../../docs/架构/03-Java后端.md)与[Java 技能](../../.agents/skills/weetion-development-java-standards/SKILL.md)。

</details>

可执行产物为 `basic-framework-server/target/basic-framework-server.jar`。当前没有仓库级 Java 生产 Compose；按[部署说明](../../docs/部署/部署说明.md)准备目标运行环境、数据库与存储配置。管理前端参见[前端 README](../../前端代码/basic-framework-admin/README.md)。

## 已知限制与暂缓工作

配置与构建只证明相应工程条件，不能证明业务外部依赖已可用。

- 不包含 AI、Workflow、代码生成器、数据源管理、多存储配置、公告或站内通知业务。
- 数据库迁移需要独立运维执行，目标生产环境仍需完成实际备份恢复演练。
- 短信、OAuth2、Quartz handler 需匹配实际配置和数据。
- 当前文件地址按公开读取契约生成；需要私有文件授权时须设计完整权限与签名链路，不能只修改桶策略。
