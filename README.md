---
description: "basic-framework 提供 Java 后端与 Vue 管理前端的公共能力，包含认证权限、组织、字典、日志、文件、配置和定时任务，供新业务项目接入。"
kind: package-group
---

# basic-framework 基础开发框架

## 摘要

basic-framework 提供 Java 后端与 Vue 管理前端的公共能力，包含认证权限、组织、字典、日志、文件、配置和定时任务，供新业务项目接入。

## 目录

- [框架能力](#框架能力)
- [包](#包)
- [开始使用](#开始使用)
- [相关文档](#相关文档)

<a id="框架能力"></a>

## 框架能力

后端以 Spring Boot 和 MyBatis 实现系统管理与基础设施，前端基于 Vue Vben Admin、Vue 3、TypeScript 和 Element Plus。业务模块复用统一的请求、认证、授权、错误处理与基础组件。

| 能力 | 负责模块 |
| --- | --- |
| 登录、令牌、用户、角色、菜单与数据权限 | system 与 security、data-permission Starter |
| 部门、岗位、字典、登录日志与操作日志 | system |
| OAuth2、短信渠道与短信模板 | system；接入参数按实际业务配置 |
| 参数配置、文件存储与任务调度 | infra；文件使用 MinIO，调度使用 Quartz |
| 分页、校验、统一响应、异常、缓存与 Excel | core |
| 动态菜单、表格表单、公共组件与状态管理 | 管理前端 apps/web-ele 与共享 packages |

<a id="包"></a>

## 包

各入口负责自己的使用与开发细节；先按任务选择所属模块，再阅读对应说明。

| 目录或模块 | 职责与入口 |
| --- | --- |
| [Java 后端](后端代码/basic-framework-boot/README.md) | 依赖、启动、配置、打包与 Java 模块 |
| [管理前端](前端代码/basic-framework-admin/README.md) | 工作区、开发服务、类型检查、测试与生产构建 |
| [总体架构](docs/架构/00-总体架构.md) | 前后端调用关系、中间件职责与模块边界 |
| [完整项目部署](docs/部署/部署说明.md) | 服务器环境、中间件、应用发布与验收 |
| 数据库文件 | 初始化 SQL；使用前核对目标库和现有数据 |
| [开发工具](docs/开发指南/脚本使用索引.md) | 检查入口、参数、执行目录与工具测试 |
| .agents/skills | 当前框架的专项开发、评审、文档与性能规则 |

<a id="开始使用"></a>

## 开始使用

开发运行按 Java 与管理前端 README 完成下列步骤；服务器安装按[部署说明](docs/部署/部署说明.md)准备完整项目。依赖版本、环境变量和完整命令由所属文档维护。

1. 运行 `python -B -X utf8 scripts/runtime/init_local_dev.py --apply` 生成被 Git 忽略的 `.env.dev`、后端 `.env` 并启用 `.githooks` 提交前检查；使用 [`sh scripts/runtime/start_dev_stack.sh`](scripts/runtime/start_dev_stack.sh) 启动本地 MySQL、Redis 和 MinIO。启动前核对容器和后端的桶名、访问模式、环境变量及已生成策略。旧卷也会同步应用并读回策略。
2. 核对本地配置与目标库无误后，安装前端锁定依赖，准备 Java 应用包，按顺序启动中间件、后端和管理前端；本地联调可按需用 `python -B -X utf8 scripts/runtime/seed_local_dev.py --apply` 导入本地演示组织/岗位/角色，如需同时写入 `admin` 口令可显式传入 `--admin-password-hash`（或环境变量 `SEED_ADMIN_PASSWORD_HASH`）。
3. 新增模块或 CRUD 可使用 `scripts/scaffold/new_java_module.py`、`scripts/scaffold/new_java_crud.py` 与 `scripts/scaffold/new_web_crud.py` 生成标准骨架，日常小切片自检使用 `python -B -X utf8 scripts/workflow/verify_slice.py`。
4. 检查登录页面、验证码、受保护接口与菜单；文件和外部短信按各自配置单独验证。

应用部署查[部署说明](docs/部署/部署说明.md)，离线交付查[离线打包说明](docs/部署/构建离线部署包说明.md)。两者分别说明构建产物、环境配置和运行验收。

<a id="相关文档"></a>

## 相关文档

编写业务前先确认代码归属和接口边界；提交交付前运行与实际改动匹配的检查和测试。

- [Java 后端架构](docs/架构/03-Java后端.md)：模块依赖、分层、认证权限、数据库与文件扩展。
- [管理前端架构](docs/架构/01-管理前端.md)：应用入口、请求客户端、权限菜单与页面接入。
- [脚本索引](docs/开发指南/脚本使用索引.md)：选择实际检查、测试和构建命令。
- [Vibe Coding 开发工作流](docs/开发指南/Vibe-Coding开发工作流.md)：从需求拆解、单责切片到小批次 PR 与 CI 合并门禁的开发闭环。
- [测试策略](docs/测试与可靠性/测试策略.md)：正常、边界与失败场景，以及验证结果的适用范围。
- [工程规则（中文）](AGENTS.zh.md)与[英文版](AGENTS.md)：开发约束、Skill 路由、注释与交付要求。

交付文档说明框架当前能力和使用方法。业务项目按自己的需求维护业务文档与决策记录。

## CI

Pull request 与 `main` 推送由 [GitHub Actions CI](.github/workflows/ci.yml) 并行执行后端 quality-gate、前端契约/工作区/循环依赖/单测/类型检查/lint/构建与产物体积扫描、文档与增量注释及 PR 切片规模检查、`pytest` 工具测试以及提交范围密钥扫描。CI 汇总制品包含实际受验提交、PR head、基线、用例计数和跳过原因。PR 的独立审查及规则扫描由[受信验收入口](docs/开发指南/受信PR验收.md)校验。候选作业还通过 [真实附件集成](.github/workflows/attachment-integration.yml) 验证隔离环境中的上传、授权下载和拒绝访问。
