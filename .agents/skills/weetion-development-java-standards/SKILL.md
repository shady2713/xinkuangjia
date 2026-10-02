---
name: weetion-development-java-standards
description: 在 basic-framework 项目设计、修改或评审 Java 后端及相关 SQL、配置、部署，或分析项目架构约束时使用；简单检索和通用 Java 问答不触发。
---

# basic-framework Java 开发规范

帮助将 Java 变更落到正确模块，沿用项目契约和基础设施，并选择与影响范围匹配的验证。工程位于 `后端代码/basic-framework-boot`；规则优先级、授权与共同底线遵循[根规则](../../../AGENTS.md)。

## 使用方式

首次开展 Java 开发或评审且尚无框架上下文时，先读[项目框架说明](references/project-framework.md)；跨模块设计或架构分析确认其中的模块与装配关系。已知文件的局部修改按下表读取，已有有效上下文可复用。定位实现优先使用框架中的 Starter 地图和关键文件速查。

框架说明负责项目结构与机制，专项引用负责场景约定；只读取本次任务涉及的部分。简单检索、通用问答和仅运行已知命令不自动加载本技能。

- 协议入口通过 Service 访问数据；跨模块通过提供方 API 与 DTO，不新增对内部实现的依赖。
- DO 不直接成为 HTTP、跨模块、MQ 或 Worker 契约；稳定契约使用明确类型。
- 复用现有基础设施；`core` 不依赖业务模块，`server` 负责启动装配。

## 按任务读取

| 当前要解决的问题 | 参考 |
| --- | --- |
| 工程定位、模块归属、Starter、集成、安全链或配置装配 | [项目框架说明](references/project-framework.md)的对应章节 |
| HTTP、跨模块契约、接口认证、凭证输出与模型转换 | [接口与模型](references/api-controller-model.md) |
| 如何实现业务用例和组织数据访问 | [Service](references/service.md) |
| 如何映射字段或修改查询 | 分别选择 [DO](references/do.md)、[Mapper](references/mapper.md) |
| 设计表和索引、编写升级或种子脚本 | [数据库约定](references/sql.md) |
| 生成、修改或评审 Java 注释 | 完整读取[注释标准](references/java-comments.md)，按真实行为反查 |
| 为变更选择测试和项目检查 | [测试与验证](references/testing-validation.md) |

实施变更时执行适用验证；只读分析不自动进入修改、构建或交付流程。代码评审覆盖约定范围，报告问题前执行[报告前核验](../weetion-code-review/SKILL.md#verify-findings)。

<a id="p3c-basis"></a>

## P3C 依据

遵循阿里[官方 P3C 仓库](https://github.com/alibaba/p3c)发布的《Java 开发手册（黄山版）》（2022-02-03），按任务查阅[官方 PDF](https://github.com/alibaba/p3c/blob/master/Java%E5%BC%80%E5%8F%91%E6%89%8B%E5%86%8C%28%E9%BB%84%E5%B1%B1%E7%89%88%29.pdf)的适用条款。保留强制、推荐、参考等级，不将建议升级为强制；冲突按项目优先级处理，未查证条款不作为已确认的违规依据。通用编码要求不在本技能重复摘录；工具版本、参数和覆盖范围以当前源 POM、规则配置及实际报告为准。
