<a id="template-package-group"></a>

# 模板：package-group

本模板用于介绍包组或模块组的导览 README，按页面用途判断，不限定目录名称。介绍能力家族，以一句话角色说明列出直接下属包，并链接到由各包负责的细节，绝不复述包的约定。

<a id="frontmatter"></a>

## 前置元数据

必须满足[元数据核验规则](../references/metadata-links.md#metadata-verification)，`kind` 固定为 `package-group`。

```yaml
---
description: "<包组名称>：介绍直接下属包各自负责的内容，供选择或浏览这一包族的读者阅读。"
kind: "package-group"
---
```

<a id="skeleton"></a>

## 骨架

页面结构遵循[页面顺序](../references/structure-hierarchy.md#page-order)：标题默认中文，项目机器规则要求的标题保留；分隔线和开发笔记均可省略，不强制分隔线样式、空行和锚点前后位置，也不强制开发笔记数量、标题层级或末尾位置。已有开发者实现细节与开发笔记正文仍须折叠，必要操作、限制和警告保持可见。

```markdown
# <group>/ — <用一句话说明主题>

## 摘要

用简短、完整的段落，说明包族提供什么、读者能用它做什么、各个包分别负责哪部分，以及主要边界。具体长度遵循项目规范。遵循[摘要表述规则](../SKILL.md#voice-rules)。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发笔记](#dev-note)

-----

<a id="packages"></a>
## 包

先用一个简短句子引导读者，再给出包导览：

| 包 | 角色 |
|---|---|
| [`<pkg>`](<pkg>/README.md) | 用一行说明角色：它提供什么 |

-----

<a id="related-documentation"></a>
## 相关文档

按查阅需要链接相邻负责页面，并说明其补充内容。

- [相邻负责方](../../<path>.md)——它为此包族补充什么。

-----

<a id="dev-note"></a>
## 开发笔记

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
```

<a id="rules"></a>

## 规则

- 每个直接下属包占一行；角色文字说明包的贡献，绝不描述内部细节。
- 只有当区别有助于读者在直接下属包之间作选择时，才添加 组件标识、包类型或发布名称列。
- 相关文档链接到相邻的负责页面（分组导览、子系统页面、Agent Note），每个链接附一小段说明。
- 不要添加模型体验或已知限制章节；分组导览不负责运行时行为。
