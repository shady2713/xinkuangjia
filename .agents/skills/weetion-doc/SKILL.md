---
name: weetion-doc
description: 用于创建、修改、评审和整理仓库 Markdown 文档及包 README；按任务选择文档归属、元数据、页面结构、事实核查和验证要求。
---

<a id="repository-documentation"></a>
<a id="summary"></a>

# 仓库文档规范

先确定本次文档任务和读者用途，再读取对应规则。局部修正从目标内容及其事实来源开始，已有有效上下文可复用；不因使用本技能就审计整页、整库或加载全部模板。遵循目标项目根目录及目标目录的 AGENTS.md，项目明确要求的专项规则仍适用。

<a id="workflow"></a>
<a id="table-of-contents"></a>
<a id="detailed-references"></a>

## 按任务读取

只读取本次涉及的主题或章节；同时涉及多种任务时组合对应行，不默认串联其他 Skill。下方未要求读取的规则遇到相关问题时再查阅。

| 当前任务 | 读取范围 |
| --- | --- |
| 修正文案、链接或局部说明 | 目标内容、相关实现或其他事实来源；遇到链接约定问题再查[链接规则](references/metadata-links.md#repository-links-and-path-mentions)，不默认加载其他引用 |
| 新建或重组普通文档 | [内容归属与页面结构](references/structure-hierarchy.md)；按需要查[编写步骤](references/document-rules.md#workflow)及下方表述规则 |
| 编写包 README | [元数据与类别映射](references/metadata-links.md#the-kind-system)及[元数据要求](references/metadata-links.md#readme-metadata)，确定真实用途后只打开对应的一份[模板](templates/) |
| 评审文档 | [评审标准](references/review.md)，沿本次范围核对事实、缺失信息和验证证据 |
| 整库或专题文档审计 | 仅在任务明确包含该范围时读[审计流程](references/document-rules.md#audit-the-corpus)，不由局部编辑自动扩展 |
| 持久化格式变更、发布比较或历史格式记录 | 按下方类别入口选择对应模板；普通文档和 README 不加载这三类模板 |
| 专项精简或表达校正 | [表达与语义保留规则](references/style.md#clear-technical-expression)，示例仅在需要校准时读取 |
| 专项清理创作过程残留 | [残留清理 Skill](../weetion-doc-trim-cot-leakage/SKILL.md) |
| 调查删除、合并或降低复杂度的机会 | [简化调查 Skill](../weetion-doc-find-simplifications/SKILL.md)，不由普通编辑自动开展 |
| 编写、维护或归档决策记录 | [Agent Note Skill](../weetion-doc-archive-agent-notes/SKILL.md)，目录、状态和格式按项目约定 |

非小改动仍须在同一次变更中新增或更新至少一份相关 Agent Note；判定条件、格式及生命周期遵循上述 Agent Note Skill。本次任务路由不改变记录门槛。

<a id="fact-check-procedure-test-do-not-assume"></a>

## 必要的事实核查

先确认文档对应的版本和事实负责方。静态定义核对源码、配置或接口；新增、修改的命令及操作流程须在适用且已授权的环境实测。未变内容复用既有证据时核对版本、环境与覆盖范围，不能把阅读测试源码表述为测试通过。无法验证时保留依据和缺口，不写成确定结论，也不为迎合文字修改实现或测试。具体情形按[事实核查细则](references/document-rules.md#fact-check-procedure-test-do-not-assume)处理。

<a id="validation"></a>

## 验证与交付

从目标项目 AGENTS.md 指定的检查入口选择与本次文件版本匹配的质量检查和必要测试；basic-framework 的命令入口见[脚本使用索引](../../../docs/开发指南/脚本使用索引.md)，测试范围见[测试策略](../../../docs/测试与可靠性/测试策略.md)。运行适用的文档检查及 `git diff --check`；涉及命令、生成内容或行为时，按[对应验证要求](references/document-rules.md#validation)取得证据。

报告改动范围、实际验证命令与结果、未验证项和剩余风险。检查通过不等于业务验收通过；必需检查无法运行时说明原因，不用零对象、跳过或旧版本结果证明本次修改有效。

## 其他规则入口

下列主题只在相关任务中读取；既有章节锚点继续指向对应规则入口。

| 主题 | 规则 |
| --- | --- |
| <a id="kind-system-and-templates"></a>类别与模板 | [完整类别规则](references/document-rules.md#kind-system-and-templates)，包 README 使用上方元数据路由 |
| <a id="voice-rules"></a>表述规则 | [摘要、开发者章节、开发笔记与当前状态](references/document-rules.md#voice-rules) |
| <a id="quality-criteria"></a>质量标准 | [质量判据](references/document-rules.md#quality-criteria) |
| <a id="audit-the-corpus"></a>审计全部文档 | [审计流程](references/document-rules.md#audit-the-corpus) |
| <a id="wordcount-budgets"></a>字数预算 | [已有预算与必要内容的处理](references/document-rules.md#wordcount-budgets) |
| 页面风格 | [排版、折叠与强调](references/style.md) |

<a id="dev-note"></a>
