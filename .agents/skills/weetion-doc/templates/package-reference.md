<a id="template-package-reference"></a>

# 模板：package-reference

本模板用于插件、服务或其他功能包。根据目标项目实际的包清单、公开入口及加载机制确认接入方式；参考示例优先选择项目中仍受维护的同类 README。

<a id="frontmatter"></a>

## 前置元数据

```yaml
---
description: "用一到两个具体句子说明该包让读者能够选择、配置或调试什么，并包含可搜索的领域术语。"
kind: "package-reference"
---
```

<a id="skeleton"></a>

## 骨架

页面结构遵循[页面顺序](../references/structure-hierarchy.md#page-order)：标题默认中文，项目机器规则要求的标题保留；分隔线和开发笔记均可省略，不强制分隔线样式、空行和锚点前后位置，也不强制开发笔记数量、标题层级或末尾位置。已有开发者实现细节与开发笔记正文仍须折叠，必要操作、限制和警告保持可见。

按目标项目的实际命令、配置和公开入口填写示例，不保留占位说明。仅在涉及模型交互时保留“模型体验”章节及其目录项；该部分按[包 README 评审标准](../references/review.md#package-readme-review)编写。

```markdown
# <包名称>

## 摘要

用简短、完整的段落，说明用户或 智能体能用该包做什么：结果、选择时机、主要代价、最重要的边界。具体长度遵循项目规范。遵循[摘要表述规则](../SKILL.md#voice-rules)；绝不描述其角色、类型或内部身份。

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

用一句引导文字说明常见路径。

### 何时选择

选择或避免使用该包：用一个段落说明决定条件及可替代的包。

### 最小配置

按项目实际格式提供能运行的最小配置；无需配置时改为最小使用示例。只解释该路径必需的字段：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `<field>` | `<default>` 或 `required` | 用一行说明含义 |

完整配置说明链接目标项目实际维护的权威文档或生成目录。没有独立参考时，在本页说明必要字段、默认值和约束，不虚构链接或重复维护完整清单。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>内部实现——点击展开</summary>

设计概念、组件架构和概略数据流，应足以理解该包。源码映射表链接到文件以供查看精确细节。不提供 API 目录，也不复述 接口文档。

</details>

-----

<a id="further-exploration"></a>
## 深入探索

仅链接直接相关且有帮助的相邻页面，最接近的前置知识排在最前，每篇附一条简短说明；不设固定篇数。

-----

<a id="model-experience"></a>
## 模型体验

仅在涉及模型交互时，说明本包在什么条件下影响模型输入、输出或上下文；按实际影响补充资源消耗、缓存及限制。间接影响链接负责的组件，不虚构本包行为。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓工作

先用一句话引导，再用顶层项目符号列出已知限制、影响及可用替代方式；没有已知限制时如实说明，不编造内容。

<a id="dev-note"></a>
### 开发笔记

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
```

<a id="rules"></a>

## 规则

- **编写前核查事实。** 在适用的测试环境中按项目真实方式加载或运行该包，核实 README 的使用路径、配置和行为；验证方式遵循主技能的事实核查流程。
- **接入方式。** 安装、启用、配置或运行命令取自项目实际工具和公开入口。核对必要条件、成功结果及失败处理，不沿用相邻包不适用的命令。
- **内容与检查。** 按[包 README 评审标准](../references/review.md#package-readme-review)说明模型交互和已知限制，使用项目实际提供的检查，不要求专用白名单或额外脚本。
