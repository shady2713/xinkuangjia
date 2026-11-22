# basic-framework 工程指南

[English](AGENTS.md)

面向极简政企管理平台框架（Spring Boot 3.5 三模块后端 + 单包 Vue 3 & Element Plus 前端）的全仓工程规范。

## 项目结构

```text
后端代码/basic-framework-boot/
  basic-framework-core/      通用工具、Web/XSS/Jackson、Security、MyBatis-Plus、数据权限、Redis、Excel、@OperateLog AOP
  basic-framework-system/    认证/SM2、滑块验证码、RBAC、部门、字典、OAuth2、登录/操作日志、阿里云短信、本地/OSS 文件存储
  basic-framework-server/    Spring Boot 启动类、application.yaml、ArchUnit/OpenAPI/Schema 契约测试、Dockerfile
前端代码/basic-framework-admin/
  src/                       单包 Vite + Vue 3 + TypeScript + Element Plus + Pinia + Vue Router + Tailwind CSS
  scripts/                   OpenAPI -> TypeScript 契约类型生成脚本（pnpm api:gen）
数据库文件/                  14 表基线 SQL（basic_framework.sql）
docker-compose.dev.yml       本机回环 MySQL 8 + Redis 7 开发栈
scripts/runtime/             本地环境初始化、演示种子与开发启动脚本
docs/                        架构说明、开发与标准 CRUD 范例、部署与运维说明
.agents/skills/              项目工程 Skills
```

## 工作规则

- 规则优先级：系统与当前用户指令 > 本文件 > `.agents/skills` > 模块配置 > 相邻代码约定。
- Java、SQL、YAML、XML、TS、Vue、Shell、Python 与 Markdown 文件统一使用 UTF-8（无 BOM）和 LF 换行。
- 严禁在源码、默认配置、测试、SQL、日志或文档中写入任何密钥或密码；真实凭据仅来自被 Git 忽略的 `.env` 或外部环境变量。
- HTTP 请求/响应 VO 必须与持久化 DO 严格隔离；所有控制器端点必须显式声明 `@PreAuthorize` 或列入 ArchUnit `@PermitAll` 白名单。
- 严格维护双平台隔离（`super_admin` 与 `business_admin`）、无登录上下文 fail-closed 拒权以及 `@Transactional(rollbackFor = Exception.class)`。
- 修改后端接口路径或 VO 字段时，须在同一变更中更新 OpenAPI 快照（`mvn -B -ntp verify -Pquality-gate -Dopenapi.update=true`）并同步前端类型（`pnpm api:gen`）。
- 常规代码/文档检索默认排除 `docs/需求卡/**`，仅在用户显式指定时读取。

## Skill 路由

| 任务类型 | Skill 路径 |
| --- | --- |
| Java 后端、SQL 与部署配置 | [weetion-development-java-standards](.agents/skills/weetion-development-java-standards/SKILL.md) |
| 单包 Vue 3 + Element Plus 前端开发 | [weetion-development-web-standards](.agents/skills/weetion-development-web-standards/SKILL.md) |
| 代码评审与安全审计 | [weetion-code-review](.agents/skills/weetion-code-review/SKILL.md) |

## 必跑验证门禁

- **后端**：`cd 后端代码/basic-framework-boot && mvn -B -ntp -Pquality-gate verify`
- **前端**：`cd 前端代码/basic-framework-admin && pnpm run quality:gates`
- 禁止通过削弱断言、放宽 ArchUnit/PMD/ESLint 规则或跳过测试来伪造通过。
