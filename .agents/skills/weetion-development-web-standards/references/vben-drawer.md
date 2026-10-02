# Vben Drawer 组件参考文档

## 组件概述
Vben Drawer 是框架提供的抽屉组件，支持自动高度、加载状态等功能。

## 重要说明

- 如果现有组件封装无法满足需求，可以使用原生组件或自行封装自定义组件
- 框架提供的组件并非强制使用，请根据实际需求选择
- 国际化、主题和弹层展示取决于当前应用配置，修改后在实际页面核对，不依据示例保证无问题

## 基础用法
使用 `useVbenDrawer` 创建基础抽屉。

## 组件分离
业务场景中抽屉内容可能比较复杂，建议将抽屉内容抽取为独立组件以便复用。使用 `connectedComponent` 参数连接内外组件，无需额外操作。

## 自动高度计算
抽屉会自动计算内容高度。当内容超过一定高度时会出现滚动条。该功能可与加载效果和 `prepend-footer` 插槽配合使用。

## 使用 API
使用 `drawerApi` 调用抽屉方法，使用 `setState` 更新抽屉状态。

## 数据共享
使用 `connectedComponent` 参数时，内外组件共享数据。使用 `drawerApi` 获取和设置数据，结合 `onOpenChange`，可以满足大部分需求。

## 优先级规则

**参数优先级**：`slot > props > state`（state 通过 API 和 useVbenDrawer 参数更新）

- 如果已传入插槽或 props，`setState` 将不会生效
- 此时应通过插槽或 props 更新状态

**连接组件优先级**：
- 使用 `connectedComponent` 时，存在 2 个 `useVbenDrawer` 实例
- 如果两边设置了相同参数，内部（未使用 `connectedComponent` 的一方）优先
- 示例：如果两边都设置了 `onConfirm`，将使用内部的 `onConfirm`
- 例外：`onOpenChange` 事件在内外组件中都会触发

**销毁配置**：
- 使用 `connectedComponent` 时，可以配置 `destroyOnClose` 决定关闭抽屉时是否销毁连接的组件
- 销毁后组件会重新创建，其内部所有变量、状态和数据都会恢复为初始状态

**默认属性**：
- 如果默认行为不符合预期，可在 `src\bootstrap.ts` 中修改 `setDefaultDrawerProps` 参数
- 示例：默认隐藏全屏按钮、修改默认 ZIndex 等

## API

```typescript
// Drawer 是抽屉组件
// drawerApi 提供抽屉方法
const [Drawer, drawerApi] = useVbenDrawer({
  // 属性
  // 事件
});
```

## Props 配置

所有属性都可以传递给 useVbenDrawer 的第一个参数。

### appendToMain
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：是否挂载到内容区（默认挂载到 body）
- **备注**：挂载到内容区时，作为页面根容器的 Page 组件需要设置 auto-content-height 属性

### connectedComponent
- **类型**：`Component`
- **默认值**：-
- **说明**：连接另一个 Drawer 组件

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
- **说明**：抽屉打开状态

### loading
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：抽屉加载状态

### closable
- **类型**：`boolean`
- **默认值**：`true`
- **说明**：显示关闭按钮

### closeIconPlacement
- **类型**：`'left' | 'right'`
- **默认值**：`right`
- **说明**：关闭按钮位置

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

### confirmLoading
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：确认按钮加载状态

### closeOnClickModal
- **类型**：`boolean`
- **默认值**：`true`
- **说明**：点击遮罩关闭抽屉

### closeOnPressEscape
- **类型**：`boolean`
- **默认值**：`true`
- **说明**：按下 ESC 键关闭抽屉

### confirmText
- **类型**：`string | slot`
- **默认值**：Confirm
- **说明**：确认按钮文本

### cancelText
- **类型**：`string | slot`
- **默认值**：Cancel
- **说明**：取消按钮文本

### placement
- **类型**：`'left' | 'right' | 'top' | 'bottom'`
- **默认值**：`right`
- **说明**：抽屉弹出位置

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
- **说明**：抽屉类名，宽度通过此项配置

### contentClass
- **类型**：`string`
- **默认值**：-
- **说明**：抽屉内容区类名

### footerClass
- **类型**：`string`
- **默认值**：-
- **说明**：抽屉页脚区类名

### headerClass
- **类型**：`string`
- **默认值**：-
- **说明**：抽屉头部区类名

### zIndex
- **类型**：`number`
- **默认值**：`1000`
- **说明**：抽屉 ZIndex 层级

### overlayBlur
- **类型**：`number`
- **默认值**：-
- **说明**：遮罩模糊程度

## DrawerApi 方法

### setState
- **说明**：动态设置抽屉状态属性
- **类型**：`(((prev: ModalState) => Partial<ModalState>) | Partial<ModalState>) => drawerApi`

### open
- **说明**：打开抽屉
- **类型**：`() => void`

### close
- **说明**：关闭抽屉
- **类型**：`() => void`

### setData
- **说明**：设置共享数据
- **类型**：`<T>(data: T) => drawerApi`

### getData
- **说明**：获取共享数据
- **类型**：`<T>() => T`

### useStore
- **说明**：获取响应式状态
- **类型**：-

### lock
- **说明**：将抽屉标记为提交中，锁定当前状态
- **类型**：`(isLock: boolean) => drawerApi`
- **版本**：>5.5.3
- **详情**：用于锁定抽屉状态，一般在提交数据时使用，防止用户重复提交或抽屉被意外关闭、表单数据被修改等。锁定状态下，抽屉的确认按钮变为加载状态，同时禁用取消和关闭按钮，阻止通过 ESC 键或点击遮罩关闭抽屉，并启用抽屉的加载动画覆盖内容。对锁定状态的抽屉调用 close 方法关闭时会自动解锁。

### unlock
- **说明**：lock 方法的反向操作，解锁抽屉状态，也是 lock(false) 的别名
- **类型**：`() => drawerApi`
- **版本**：>5.5.3

## 事件

以下事件只有在 `useVbenDrawer({onCancel:()=>{}})` 中传入时才生效。

### onBeforeClose
- **说明**：关闭前触发，返回 false 时阻止关闭
- **类型**：`() => boolean`

### onCancel
- **说明**：点击取消按钮时触发
- **类型**：`() => void`

### onClosed
- **说明**：关闭动画完成时触发
- **类型**：`() => void`
- **版本**：>5.5.2

### onConfirm
- **说明**：点击确认按钮时触发
- **类型**：`() => void`

### onOpenChange
- **说明**：抽屉打开或关闭时触发
- **类型**：`(isOpen: boolean) => void`

### onOpened
- **说明**：打开动画完成时触发
- **类型**：`() => void`
- **版本**：>5.5.2

## 插槽

除上述属性类型中包含的插槽外，还可以通过插槽自定义抽屉内容。

### default
- **说明**：默认插槽——抽屉内容

### prepend-footer
- **说明**：取消按钮左侧

### center-footer
- **说明**：取消按钮与确认按钮之间（未使用 footer 插槽时生效）

### append-footer
- **说明**：确认按钮右侧

### close-icon
- **说明**：关闭按钮图标

### extra
- **说明**：额外内容（标题右侧）

## 使用模板

**具体模板用法和代码示例请参考**：[对应模板](../assets/drawer-template.md)
