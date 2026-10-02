# basic-framework 工程指南

[English](AGENTS.md)

本文件维护 Java 后端与 Vue 管理前端的仓库共同要求和任务入口，详细规则按当前任务读取。

## 项目地图

```text
后端代码/basic-framework-boot/
  basic-framework-core/          公共库与 Spring Boot Starter
  basic-framework-module-system/ 用户、权限、组织、字典与日志
  basic-framework-module-infra/  配置、文件与定时任务
  basic-framework-server/        应用聚合与启动
  basic-framework-dependencies/  统一依赖版本
前端代码/basic-framework-admin/
  apps/web-ele/                  Element Plus 管理应用
  packages/                      共享组件、状态、Hooks 与工具
  internal/                      构建、检查与 TypeScript 配置
数据库文件/                      数据库结构与初始化 SQL
docs/部署/                       完整项目安装与部署说明
scripts/                         质量检查、工具测试与本地启动入口
docs/                            架构、开发、测试与性能文档
.agents/skills/                  项目专项技能及引用资料
```

服务操作先查所属包 README；职责与集成边界查[总体架构](docs/架构/00-总体架构.md)、[Java 后端](docs/架构/03-Java后端.md)和[管理前端](docs/架构/01-管理前端.md)。

## 工作规则

- 遵循适用的目录规则。优先级：系统与用户当前指令、本文件、项目 Skill 及引用、模块配置、相邻代码的非冲突惯例。冲突未解决时停止写入。
- 修改前追踪真实调用、数据边界、配置与消费方，保持职责和依赖方向。跨模块修改须读总体架构和相关模块指南，不附带无关重构、依赖或服务。
- 使用 UTF-8，新文件无 BOM；已有文件保留 BOM 和换行符，但 Java 源码及直接相关的测试、SQL、配置、部署脚本和文档使用 LF。不编辑乱码、生成文件或构建产物。
- 每个方法必须有准确的职责注释。公共 API 和复杂方法说明参数、返回值、真实异常与副作用；核心逻辑解释业务原因和边界结果，不复述代码。
- 按专项规则处理安全与生命周期；密钥不得写入源码、默认值、测试、SQL、日志或文档。真实凭据从已忽略的本地配置或受控环境注入。
- HTTP 请求与响应模型和持久化对象分离。保留现有认证、权限及数据范围契约；新增接口使用所属场景的授权检查。
- 基于本框架开发业务项目时，非小改动须在同一次变更中使用 [Agent Note](.agents/skills/weetion-doc-archive-agent-notes/SKILL.md#when-to-write-a-note)留底：需求、验收、行为、契约、结构、流程或理由变化须保留来源、证据、备选方案、关联实现与验证。决策变化须新建交叉链接记录；不涉及这些变化的纯机械性或局部修改可豁免。
- 框架交付基线不携带维护过程 Notes。后续按业务项目自身的决定创建所需记录，不把框架提取或维护历史复制到业务文档。
- 复用已完整读取且仍有效的上下文，只读相关章节；截断内容须补读，不重复输出已读内容。
- 常规仓库或文档发现时，文件枚举、正文搜索与自动沿链接读取排除 `docs/需求卡/**`。只有用户明确请求、给出路径，或当前任务执行或检查相应计划/卡时，才读取相关内容。从仓库根用 `rg` 检索时添加 `-g '!docs/需求卡/**'`。这是检索规则，不是质量检查豁免。

## Skill 路由

仅使用 `.agents/skills` 及项目内引用，不搜索、读取或直接、间接加载外部 Skill。缺少技能时说明并完成可执行部分，不自动回退；更高优先级指令或用户当前明确要求可构成例外，须说明来源与范围。

设计、修改、测试、评审或依赖项目规则的架构分析加载对应 Skill；简单检索、通用问答和执行既有检查不自动加载语言技能。

| 任务 | `.agents/skills/` 下的 Skill |
| --- | --- |
| Java、SQL 及相关配置部署 | [weetion-development-java-standards](.agents/skills/weetion-development-java-standards/SKILL.md) |
| Vue、TypeScript、JavaScript、前端测试与 CRUD | [weetion-development-web-standards](.agents/skills/weetion-development-web-standards/SKILL.md) |
| 代码评审 | [weetion-code-review](.agents/skills/weetion-code-review/SKILL.md) |
| Markdown 与包 README | [weetion-doc](.agents/skills/weetion-doc/SKILL.md) |
| 业务决策记录 | [weetion-doc-archive-agent-notes](.agents/skills/weetion-doc-archive-agent-notes/SKILL.md) |
| 简化调查 | [weetion-doc-find-simplifications](.agents/skills/weetion-doc-find-simplifications/SKILL.md) |
| 创作过程残留清理 | [weetion-doc-trim-cot-leakage](.agents/skills/weetion-doc-trim-cot-leakage/SKILL.md) |
| 需求卡、计划与执行 | [weetion-task-cards](.agents/skills/weetion-task-cards/SKILL.md) |
| 性能调查与验证 | [weetion-speed-up-perf](.agents/skills/weetion-speed-up-perf/SKILL.md) |

涉及注释时，完整读取 Skill 要求的通用与语言专项引用；工具参数遵循受版本控制的配置，不得降低要求。本仓库 Python 文件用于质量与交付工具，未提供 Python 业务服务专项技能。

## 操作入口

- 依赖、检查、构建与交付先查[脚本索引](docs/开发指南/脚本使用索引.md)；新增、移动或停用脚本时同步索引和所属 README。
- 开发启动查所属包 README，启动应用前确认工作目录、环境与必需变量。
- 部署与离线交付查[部署说明](docs/部署/部署说明.md)和[离线打包](docs/部署/构建离线部署包说明.md)，区分应用产物与环境配置。
- 数据库初始化或数据修改须核实目标及恢复方式，不得自动把包含重建语句的 SQL 导入已有数据库。
- 列出命令不代表授权执行；检查不授权暂存、提交、推送、替换运行服务或修改生产数据。

<a id="required-validation"></a>

## 必需验证

- 交付前实际运行脚本索引与[测试策略](docs/测试与可靠性/测试策略.md)要求的适用检查和必要测试，覆盖正常、关键边界及失败行为；质量检查不能替代业务测试或构建。
- 检查最终修改版本：未暂存内容使用工作区入口，已暂存内容使用[提交前检查](scripts/workflow/check_staged_quality.py)；只有暂存入口时使用不改真实索引的隔离快照。空暂存、旧版本、零对象和跳过不能证明成功。
- 检查器、钩子或集中规则变化须运行相关测试和实际消费方检查，覆盖扫描范围变化；检查器测试本身不足以交付。
- 修复本次引入的失败，再次修改后复跑受影响检查；不得跳过检查、放宽断言或规则、降低阈值或用排除项掩盖失败。
- 无关失败或缺少环境、权限时，报告位置、影响范围及原因，不擅自扩大整改或将未完成检查记为通过。
- 报告改动文件、实际命令、范围与版本、退出状态或通过数量、失败、跳过、未运行项及剩余风险；编译通过不是测试通过。
