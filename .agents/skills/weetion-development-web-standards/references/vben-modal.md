# Vben Modal 组件参考文档

## 组件概述
Vben Modal 是框架提供的模态弹窗组件，支持拖拽、全屏、自动高度、加载状态等功能。

## 重要说明

- 如果现有组件封装无法满足需求，可以使用原生组件或自行封装自定义组件
- 框架提供的组件并非强制使用，请根据实际需求选择
- 国际化、主题和弹层展示取决于当前应用配置，修改后在实际页面核对，不依据示例保证无问题

## 基础用法
使用 `useVbenModal` 创建基础模态弹窗。

## 组件分离
业务场景中弹窗内容可能比较复杂，建议将弹窗内容抽取为独立组件以便复用。使用 `connectedComponent` 参数连接内外组件，无需额外操作。

## 可拖拽
使用 `draggable` 参数启用拖拽功能。

## 自动高度计算
弹窗会自动计算内容高度。当内容超过一定高度时会出现滚动条。该功能可与加载效果和 `prepend-footer` 插槽配合使用。

## 使用 API
使用 `modalApi` 调用弹窗方法，使用 `setState` 更新弹窗状态。

## 数据共享
使用 `connectedComponent` 参数时，内外组件共享数据。使用 `modalApi` 获取和设置数据，结合 `onOpenChange`，可以满足大部分需求。

## 动画类型
使用 `animationType` 属性控制弹窗动画效果：

- `slide`（默认）：打开/关闭时从顶部滑下
- `scale`：缩放淡入/淡出效果

## 优先级规则

**参数优先级**：`slot > props > state`（state 通过 API 和 useVbenModal 参数更新）

- 如果已传入插槽或 props，`setState` 将不会生效
- 此时应通过插槽或 props 更新状态

**连接组件优先级**：
- 使用 `connectedComponent` 时，存在 2 个 `useVbenModal` 实例
- 如果两边设置了相同参数，内部（未使用 `connectedComponent` 的一方）优先
- 示例：如果两边都设置了 `onConfirm`，将使用内部的 `onConfirm`
- 例外：`onOpenChange` 事件在内外组件中都会触发
- 如果设置了 `destroyOnClose`，关闭后内部 Modal 及其子组件将被完全销毁

**默认属性**：
- 如果默认行为不符合预期，可在 `src\bootstrap.ts` 中修改 `setDefaultModalProps` 参数
- 示例：默认隐藏全屏按钮、修改默认 ZIndex 等

## API

```typescript
// Modal 是弹窗组件
// modalApi 提供弹窗方法
const [Modal, modalApi] = useVbenModal({
  // 属性
  // 事件
});
```

## Props 配置

所有属性都可以传递给 useVbenModal 的第一个参数。

### appendToMain
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：是否挂载到内容区（默认挂载到 body）
- **备注**：挂载到内容区时，作为页面根容器的 Page 组件需要设置 auto-content-height 属性

### connectedComponent
- **类型**：`Component`
- **默认值**：-
- **说明**：连接另一个 Modal 组件

### destroyOnClose
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：关闭时销毁

### title
- **类型**：`string | slot`
- **默认值**：-
- **说明**：标题

### titleTooltip
- **类型**：`string | slot`
- **默认值**：-
- **说明**：标题提示信息

### description
- **类型**：`string | slot`
- **默认值**：-
- **说明**：描述信息

### isOpen
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：弹窗打开状态

### loading
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：弹窗加载状态

### fullscreen
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：全屏显示

### fullscreenButton
- **类型**：`boolean`
- **默认值**：`true`
- **说明**：显示全屏按钮

### draggable
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：可拖拽

### closable
- **类型**：`boolean`
- **默认值**：`true`
- **说明**：显示关闭按钮

### centered
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：居中显示

### modal
- **类型**：`boolean`
- **默认值**：`true`
- **说明**：显示遮罩

### header
- **类型**：`boolean`
- **默认值**：`true`
- **说明**：显示头部

### footer
- **类型**：`boolean | slot`
- **默认值**：`true`
- **说明**：显示页脚

### confirmDisabled
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：禁用确认按钮

### confirmLoading
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：确认按钮加载状态

### closeOnClickModal
- **类型**：`boolean`
- **默认值**：`true`
- **说明**：点击遮罩关闭弹窗

### closeOnPressEscape
- **类型**：`boolean`
- **默认值**：`true`
- **说明**：按下 ESC 键关闭弹窗

### confirmText
- **类型**：`string | slot`
- **默认值**：Confirm
- **说明**：确认按钮文本

### cancelText
- **类型**：`string | slot`
- **默认值**：Cancel
- **说明**：取消按钮文本

### showCancelButton
- **类型**：`boolean`
- **默认值**：`true`
- **说明**：显示取消按钮

### showConfirmButton
- **类型**：`boolean`
- **默认值**：`true`
- **说明**：显示确认按钮

### class
- **类型**：`string`
- **默认值**：-
- **说明**：弹窗类名，宽度通过此项配置

### contentClass
- **类型**：`string`
- **默认值**：-
- **说明**：弹窗内容区类名

### footerClass
- **类型**：`string`
- **默认值**：-
- **说明**：弹窗页脚区类名

### headerClass
- **类型**：`string`
- **默认值**：-
- **说明**：弹窗头部区类名

### bordered
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：是否显示边框

### zIndex
- **类型**：`number`
- **默认值**：`1000`
- **说明**：弹窗 ZIndex 层级

### overlayBlur
- **类型**：`number`
- **默认值**：-
- **说明**：遮罩模糊程度

### animationType
- **类型**：`'slide' | 'scale'`
- **默认值**：`'slide'`
- **说明**：动画类型

### submitting
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：标记为提交中，锁定当前弹窗状态

## ModalApi 方法

### setState
- **说明**：动态设置弹窗状态属性
- **类型**：`(((prev: ModalState) => Partial<ModalState>) | Partial<ModalState>) => modalApi`

### open
- **说明**：打开弹窗
- **类型**：`() => void`

### close
- **说明**：关闭弹窗
- **类型**：`() => void`

### setData
- **说明**：设置共享数据
- **类型**：`<T>(data: T) => modalApi`

### getData
- **说明**：获取共享数据
- **类型**：`<T>() => T`

### useStore
- **说明**：获取响应式状态
- **类型**：-

### lock
- **说明**：将弹窗标记为提交中，锁定当前状态
- **类型**：`(isLock: boolean) => modalApi`
- **版本**：>5.5.2
- **详情**：用于锁定当前弹窗状态，一般在提交数据时使用，防止用户重复提交或弹窗被意外关闭、表单数据被修改等。锁定状态下，弹窗的确认按钮变为加载状态，同时禁用取消和关闭按钮，阻止通过 ESC 键或点击遮罩关闭弹窗，并启用弹窗的加载动画覆盖弹窗内容。对锁定状态的弹窗调用 close 方法关闭时会自动解锁。

### unlock
- **说明**：lock 方法的反向操作，解锁弹窗状态，也是 lock(false) 的别名
- **类型**：`() => modalApi`
- **版本**：>5.5.3

## 事件

以下事件只有在 `useVbenModal({onCancel:()=>{}})` 中传入时才生效。

### onBeforeClose
- **说明**：关闭前触发，返回 false 或被拒绝时阻止关闭
- **类型**：`() => Promise<boolean> | boolean`
- **版本**：>5.5.2 支持 Promise

### onCancel
- **说明**：点击取消按钮时触发
- **类型**：`() => void`

### onClosed
- **说明**：关闭动画完成时触发
- **类型**：`() => void`
- **版本**：>5.4.3

### onConfirm
- **说明**：点击确认按钮时触发
- **类型**：`() => void`

### onOpenChange
- **说明**：弹窗打开或关闭时触发
- **类型**：`(isOpen: boolean) => void`

### onOpened
- **说明**：打开动画完成时触发
- **类型**：`() => void`
- **版本**：>5.4.3

## 插槽

除上述属性类型中包含的插槽外，还可以通过插槽自定义弹窗内容。

### default
- **说明**：默认插槽——弹窗内容

### prepend-footer
- **说明**：取消按钮左侧

### center-footer
- **说明**：取消按钮与确认按钮之间（未使用 footer 插槽时生效）

### append-footer
- **说明**：确认按钮右侧

## 使用模板

**具体模板用法和代码示例请参考**：[对应模板](../assets/modal-template.md)
