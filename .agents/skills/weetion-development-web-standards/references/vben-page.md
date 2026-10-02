# Vben Page 组件参考文档
## 组件概述
Page 是 Vben Admin 的标准页面布局组件，提供页面结构：页头、内容区和页脚。

## 组件属性（Props）
### title
- **类型**：`string | slot`
- **默认值**：无
- **说明**：页面标题，可通过属性或插槽传入

### description
- **类型**：`string | slot`
- **默认值**：无
- **说明**：页面描述文本，显示在标题下方

### contentClass
- **类型**：`string`
- **默认值**：无
- **说明**：内容区的自定义 CSS 类名

### headerClass
- **类型**：`string`
- **默认值**：无
- **说明**：页头区的自定义 CSS 类名

### footerClass
- **类型**：`string`
- **默认值**：无
- **说明**：页脚区的自定义 CSS 类名

### autoContentHeight
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：自动调整内容区高度

## 插槽
### default
- **说明**：页面的主内容区

### title
- **说明**：自定义页面标题（优先级高于 title 属性）

### description
- **说明**：自定义页面描述（优先级高于 description 属性）

### extra
- **说明**：页头右侧的额外内容区

### footer
- **说明**：页面底部的内容区

## 重要说明
**页头渲染规则**：
- 如果 `title`、`description` 和 `extra` 都没有内容（无论通过属性还是插槽），页头区域将不会渲染。
- 至少提供其中一项，页头才会显示。

## 使用模板
**具体模板用法和代码示例请参考**：[对应模板](../assets/page-template.md)