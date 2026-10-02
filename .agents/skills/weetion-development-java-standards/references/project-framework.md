# Java 项目框架说明

当前工程为 `后端代码/basic-framework-boot`，包根为 com.basicframework，使用 Java 17、Maven 多模块和 Spring Boot。运行和依赖以[Java README](../../../../后端代码/basic-framework-boot/README.md)及[根 POM](../../../../后端代码/basic-framework-boot/pom.xml)为准。

## 模块与装配

core 提供 Starter，dependencies 维护 BOM，system 和 infra 提供业务，server 聚合启动。core 不依赖业务模块，跨业务模块通过提供方 API 与 DTO 调用，DO 不作为稳定 HTTP 或跨模块契约。

| 模块 | 当前职责 |
| --- | --- |
| basic-framework-module-system | 登录、用户、组织、角色菜单、字典、审计、OAuth2 与短信 |
| basic-framework-module-infra | 文件、参数配置、Quartz 任务和日志 |
| basic-framework-server | 启动扫描与全局配置 |
| basic-framework-core | Web、Security、MyBatis、Redis、MQ、Job、Excel、保护、数据权限与 IP Starter |

## 入口与能力归属

应用入口为 server 的 BasicFrameworkServerApplication；配置为 [application.yaml](../../../../后端代码/basic-framework-boot/basic-framework-server/src/main/resources/application.yaml)。Starter 使用 AutoConfiguration.imports 装配。业务域能力放在相应 module 的 controller、service、dal、api 与 framework；server 不实现业务。

## 安全链与数据边界

HTTP 请求经过编码、日志和安全过滤链，再进入 Controller、Service、Mapper 或外部客户端。身份来自认证上下文，权限在真实操作入口校验，不只信任请求字段。跨模块契约、凭证展示与模型转换见[接口规则](api-controller-model.md)。文件由 MinioFileProperties 与 FileStorageService 管理统一存储，凭据从环境注入，不恢复多存储数据库配置。

## 配置与运行

Java 根目录 `.env` 提供 DB、REDIS、MINIO 系列配置；只有非敏感连接端口等可有安全默认值。必须的凭据缺失时失败，不回退共享认证信息。[环境样例](../../../../后端代码/basic-framework-boot/.env.example)只维护字段说明，开发启动见[Java README](../../../../后端代码/basic-framework-boot/README.md)，服务器部署见[部署说明](../../../../docs/部署/部署说明.md)。

## 验证与源码定位

按[测试与验证](testing-validation.md)选择当前模块和真实用例。框架没有 AI、Workflow、推理、转码或业务前端，不创建对应依赖。

| 事实 | 权威位置 |
| --- | --- |
| Java 与插件版本 | 后端代码/basic-framework-boot/pom.xml |
| BOM | 后端代码/basic-framework-boot/basic-framework-dependencies/pom.xml |
| Starter 清单 | 后端代码/basic-framework-boot/basic-framework-core/pom.xml |
| 聚合依赖 | 后端代码/basic-framework-boot/basic-framework-server/pom.xml |
| 数据库与存储配置 | 后端代码/basic-framework-boot/basic-framework-server/src/main/resources/application.yaml |
