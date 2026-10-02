# Vben EllipsisText

框架提供的文本展示组件，可配置长文本省略、悬浮提示、展开/收起等功能。

**具体使用示例和代码模板请参考**：[对应模板](../assets/ellipsis-text-template.md)

## 重要说明

如果现有组件封装无法满足需求，可以使用原生组件或自行封装自定义组件。框架提供的组件并非强制使用，请根据实际需求选择。

## 基础用法

通过 max-width 设置最大宽度，超出部分显示省略号。

## 可折叠文本块

通过 line 设置折叠后的行数，expand 属性设置是否支持展开/收起。

## 自定义悬浮提示

通过 tooltip 插槽自定义悬浮提示信息。

## 自动显示悬浮提示

通过 tooltip-when-ellipsis 设置，仅在文本长度超出并出现省略号时才触发悬浮提示。

## API

## Props

### expand
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：支持点击展开或收起

### line
- **类型**：`number`
- **默认值**：`1`
- **说明**：文本最大行数

### maxWidth
- **类型**：`number | string`
- **默认值**：`'100%'`
- **说明**：文本区域最大宽度

### placement
- **类型**：`'bottom' | 'left' | 'right' | 'top'`
- **默认值**：`'top'`
- **说明**：悬浮提示的位置

### tooltip
- **类型**：`boolean`
- **默认值**：`true`
- **说明**：启用文本悬浮提示

### tooltipWhenEllipsis
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：内容超出时自动启用文本悬浮提示

### ellipsisThreshold
- **类型**：`number`
- **默认值**：`3`
- **说明**：仅在设置 tooltipWhenEllipsis 后生效，文本截断检测的像素差阈值，值越大判断越严格，如遇异常情况可自行调整阈值

### tooltipBackgroundColor
- **类型**：`string`
- **默认值**：-
- **说明**：悬浮提示文字的背景颜色

### tooltipColor
- **类型**：`string`
- **默认值**：-
- **说明**：悬浮提示文字的颜色

### tooltipFontSize
- **类型**：`string`
- **默认值**：-
- **说明**：悬浮提示文字的字号

### tooltipMaxWidth
- **类型**：`number`
- **默认值**：-
- **说明**：悬浮提示的最大宽度。未设置时与文本宽度保持一致

### tooltipOverlayStyle
- **类型**：`CSSProperties`
- **默认值**：`{ textAlign: 'justify' }`
- **说明**：悬浮提示内容区样式

## 事件

### expandChange
- **类型**：`(isExpand: boolean) => void`
- **说明**：展开状态变化

## 插槽

### default
- **说明**：文本内容

### tooltip
- **说明**：启用文本悬浮提示时，用于自定义悬浮提示内容
