---
description: "说明 basic-framework 管理前端 Web 技能与 CRUD 生成资料的使用入口、必需输入、生成范围和验证方式。"
kind: "package-reference"
---

# Web 开发与 CRUD 资料入口

## 摘要

使用 [Web 开发技能](SKILL.md)修改当前管理前端页面、组件、API、路由或生成 CRUD。该技能按任务选择组件资料和注释规范；完整 CRUD 使用专项流程，局部修改不强制生成整套文件。当前工程为 `前端代码/basic-framework-admin`，唯一应用是 Element Plus 的 `apps/web-ele`。

## 目录

- [使用入口](#使用入口)
- [完整 CRUD 的输入与产物](#完整-crud-的输入与产物)
- [检查与验收](#检查与验收)
- [资料组织](#资料组织)
- [深入探索](#深入探索)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 使用入口

在任务中说明目标业务和预期行为，可以直接使用技能名：

```text
使用 $weetion-development-web-standards 修改 system/post 页面，补充实际需求和验收条件。
```

智能体先核对目标文件、目录规则、应用配置及真实接口，再按 [SKILL.md](SKILL.md) 的路由读取资料。技能并不授权无关重构、依赖升级、提交或部署。

## 完整 CRUD 的输入与产物

生成前提供模块名、字段类型与校验、是否需要多标签页，以及导入导出或批量操作等特殊需求；未提供且无法从真实接口确定的关键要求须先确认。可使用[需求模板](assets/quick-start-template.md)整理输入，其中推送字段和端点是示例。

完整流程见 [CRUD 生成](references/crud-workflow.md)，主要产物位于 `apps/web-ele/src`：

| 产物 | 职责 |
| --- | --- |
| `api/<module>/types.ts` | 实际请求、响应与实体类型 |
| `api/<module>/index.ts` | 基于 `#/api/request` 的请求封装 |
| `views/<module>/index.vue` | 查询、分页和操作入口 |
| `views/<module>/data.ts` | 列配置、搜索与编辑 schema |
| `views/<module>/modules/form.vue` | 新增、编辑、校验和保存 |

管理应用使用后端菜单模式：业务路由由 `system_menu` 的组件路径、权限标识和角色授权提供；不为每个 CRUD 强制新增 `router/routes/modules/<module>.ts`。需要核心或独立静态路由时，才按实际路由契约添加。

## 检查与验收

在 `前端代码/basic-framework-admin` 执行 CRUD 专项脚本。下面的 `system/push` 是待生成模块的路径示例，需替换为本次实际存在的 API 与页面目录；Windows 执行此入口需要可用的 Bash：

```bash
bash ../../.agents/skills/weetion-development-web-standards/scripts/check.sh apps/web-ele/src/api/system/push apps/web-ele/src/views/system/push
```

脚本调用前端的 [CRUD 检查器](../../../前端代码/basic-framework-admin/scripts/quality/check_crud.py)，通过语法树检查必需文件及导入边界。允许各 API、页面模块内部的相对引用（例如 `modules/form.vue` 导入 `../data`），跨模块引用使用应用别名。随后执行所属应用类型检查和模块 ESLint，显式 `any` 作为错误处理。缺少配置、依赖、解析失败或检查失败均返回非零，不再跳过后输出成功。

Windows 也可直接在前端根运行 `python -B -X utf8 scripts/quality/check_crud.py <api-path> <views-path>`，无需 Bash。检查只读源码，不修复或暂存文件。

然后按[专项流程](references/crud-workflow.md#4-代码质量检查必须在输出总结前完成不得跳过)核对组件 API、请求参数和跨文件类型；相关 lint、注释、类型与测试命令以工程配置和[脚本索引](../../../docs/开发指南/脚本使用索引.md)为准。列表、新增、编辑、取消、校验失败、删除确认及权限边界需有适用的业务证据，脚本通过不能替代它们。

## 资料组织

<details>
<summary>技能、参考与模板之间的关系</summary>

主技能维护任务入口与验证选择，`references/` 维护组件与注释约定，`assets/` 提供组合片段。模板中业务标识、接口、字段和回调需要按目标模块填写；模板不能替代当前应用类型与适配器。

| 组件 | 参考 | 组合模板 |
| --- | --- | --- |
| 表单 | [表单参考](references/vben-form.md) | [表单模板](assets/form-template.md) |
| 表格 | [表格参考](references/vben-table.md) | [用法](assets/table-usage-template.md)、[适配层](assets/table-adapter-template.md) |
| 弹窗 | [弹窗参考](references/vben-modal.md) | [弹窗模板](assets/modal-template.md) |
| 抽屉 | [抽屉参考](references/vben-drawer.md) | [抽屉模板](assets/drawer-template.md) |

当前应用中的业务组合可对照 `apps/web-ele/src/views/system/post`、`apps/web-ele/src/adapter/form.ts` 和 `apps/web-ele/src/adapter/vxe-table.ts`；导入、分页字段、枚举和权限以实际代码及接口为准。

</details>

## 深入探索

- [Web 开发主入口](SKILL.md)：选择局部开发、完整 CRUD、评审或验证场景。
- [完整中文注释](references/web-comments.md)：职责、组件契约、公共接口及关键边界说明。
- [测试策略](../../../docs/测试与可靠性/测试策略.md)：选择能观察真实行为的验证层次。

## 已知限制与暂缓工作

本技能只覆盖管理前端，不提供 Python 业务服务或 Java 实现。通用 Vben 能力可支持其他 UI 适配器，但当前应用采用 Element Plus，不照搬 Ant Design 的组件和绑定。业务权限必须在服务端实际入口生效，前端菜单或按钮隐藏不能替代授权。
