<a id="template-package-library"></a>

# 模板：package-library

本模板用于主要通过公开 API 被调用方引入的库。读取目标项目的包清单和真实导出入口，核对依赖获取方式、调用约定及运行条件。

库 README 以依赖获取和调用示例为重点，不套用未受支持的宿主挂载或预设安装步骤。兼具插件等其他接口时，说明对应入口和使用边界。

<a id="frontmatter"></a>

## 前置元数据

```yaml
---
description: "用一到两个具体句子说明调用方可以借助该库构建什么，并包含消费包名称或可搜索的领域术语。"
kind: "package-library"
---
```

<a id="skeleton"></a>

## 骨架

页面结构遵循[页面顺序](../references/structure-hierarchy.md#page-order)：标题默认中文，项目机器规则要求的标题保留；分隔线和开发笔记均可省略，不强制分隔线样式、空行和锚点前后位置，也不强制开发笔记数量、标题层级或末尾位置。已有开发者实现细节与开发笔记正文仍须折叠，必要操作、限制和警告保持可见。

按目标项目的实际命令、配置和公开入口填写示例，不保留占位说明。仅在涉及模型交互时保留“模型体验”章节及其目录项；该部分按[包 README 评审标准](../references/review.md#package-readme-review)编写。

```markdown
# <包名称>

## 摘要

用简短、完整的段落，说明调用方能用该库做什么、谁消费它、最小入口以及主要边界。具体长度遵循项目规范。遵循[摘要表述规则](../SKILL.md#voice-rules)。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [深入探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发笔记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

从下方入口确认适用场景，再按项目支持的方式引入和调用。

### 何时使用

指明主要调用方、适用场景和不适用情况，说明选择该库所需的前提。

### 入口

说明项目支持的依赖获取方式，并使用对应编程语言的代码块提供最小导入与调用示例，随后说明成功结果和失败处理。链接真实公开入口或 API 参考以供查阅，不假定入口文件名。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>内部实现——点击展开</summary>

设计说明与源码映射表。不提供 API 目录。

</details>

-----

<a id="further-exploration"></a>
## 深入探索

相邻页面，最接近的前置知识排在最前。

-----

<a id="model-experience"></a>
## 模型体验

仅在涉及模型交互时，说明本库对模型输入、输出或上下文的实际影响；间接影响链接负责的调用方，不虚构本库没有的行为。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓工作

以顶层项目符号列出已知限制、影响及可用替代方式；没有已知限制时如实说明，不要求登记白名单。

<a id="dev-note"></a>
### 开发笔记

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
```

<a id="rules"></a>

## 规则

- **核实公开入口。** 根据目标项目实际的包清单、导出接口和调用位置选择本模板，不根据目录名称或某种语言的固定导出形式推断。
- **验证调用路径。** 按项目支持的方式获取依赖并运行最小调用示例，核实参数、返回值、失败行为和环境要求；不提供库本身不支持的安装或启用流程。
