# Vben Alert

框架提供了一些轻量级提示弹窗，只需使用 JS 代码即可动态快速创建，无需在模板中编写任何代码。

**具体使用示例和代码模板请参考**：[对应模板](../assets/alert-template.md)

## 重要说明

如果现有组件封装无法满足需求，可以使用原生组件或自行封装自定义组件。框架提供的组件并非强制使用，请根据实际需求选择。

## 应用场景

Alert 提供与 Modal 类似的功能，但仅适用于简单的应用场景。例如临时动态弹出模态确认框、输入框等。如果对弹窗有更复杂的需求，请使用 VbenModal。

## 注意

Alert 提供的 alert、confirm、prompt 快捷方法，在动态创建的弹窗已打开时不支持 HMR（热模块替换）。代码变更后，需要关闭这些弹窗并重新打开。

## useAlertContext

当弹窗的内容、页脚或图标使用自定义组件时，可以在这些组件中使用 useAlertContext 获取当前弹窗的上下文对象，以主动控制弹窗。

**注意**：useAlertContext 只能在 setup 或函数式组件中使用。

### 方法

#### doConfirm
- **类型**：`() => void`
- **版本**：>5.5.4
- **说明**：调用弹窗的确认操作

#### doCancel
- **类型**：`() => void`
- **版本**：>5.5.4
- **说明**：调用弹窗的取消操作

## 类型定义

### IconType

```typescript
/** 预设图标类型 */
export type IconType = 'error' | 'info' | 'question' | 'success' | 'warning';
```

### BeforeCloseScope

```typescript
export type BeforeCloseScope = {
  /** 是否由点击确认按钮触发关闭 */
  isConfirm: boolean;
};
```

### AlertProps

```typescript
export type AlertProps = {
  /** 关闭前的回调，返回 false 时终止关闭 */
  beforeClose?: (
    scope: BeforeCloseScope,
  ) => boolean | Promise<boolean | undefined> | undefined;
  /** 边框 */
  bordered?: boolean;
  /** 按钮对齐方式 */
  buttonAlign?: 'center' | 'end' | 'start';
  /** 取消按钮标题 */
  cancelText?: string;
  /** 是否居中显示 */
  centered?: boolean;
  /** 确认按钮标题 */
  confirmText?: string;
  /** 弹窗容器的额外样式 */
  containerClass?: string;
  /** 弹窗提示内容 */
  content: Component | string;
  /** 弹窗内容的额外样式 */
  contentClass?: string;
  /** beforeClose 回调执行期间在内容区显示加载遮罩 */
  contentMasking?: boolean;
  /** 弹窗页脚内容（与按钮在同一容器中） */
  footer?: Component | string;
  /** 弹窗图标（位于标题前） */
  icon?: Component | IconType;
  /** 弹窗遮罩模糊效果 */
  overlayBlur?: number;
  /** 是否显示取消按钮 */
  showCancel?: boolean;
  /** 弹窗标题 */
  title?: string;
};
```

### PromptProps

```typescript
export type PromptProps<T = any> = {
  /** 关闭前的回调，返回 false 时终止关闭 */
  beforeClose?: (scope: {
    isConfirm: boolean;
    value: T | undefined;
  }) => boolean | Promise<boolean | undefined> | undefined;
  /** 用于接收用户输入的组件 */
  component?: Component;
  /** 输入组件的属性 */
  componentProps?: Recordable<any>;
  /** 输入组件的插槽 */
  componentSlots?: Recordable<Component>;
  /** 默认值 */
  defaultValue?: T;
  /** 输入组件的值属性名 */
  modelPropName?: string;
} & Omit<AlertProps, 'beforeClose'>;
```

## 函数签名

### alert / confirm

```typescript
/**
 * alert 和 confirm 的函数签名相同。
 * confirm 默认显示取消按钮，而 alert 默认只有一个按钮
 */
export function alert(options: AlertProps): Promise<void>;
export function alert(
  message: string,
  options?: Partial<AlertProps>,
): Promise<void>;
export function alert(
  message: string,
  title?: string,
  options?: Partial<AlertProps>,
): Promise<void>;
```

### prompt

```typescript
/**
 * 弹出输入框的函数签名。
 * beforeClose 参数会传入当前输入值
 * component 指定接收用户输入的组件，默认为 Input
 * componentProps 为输入组件设置属性数据
 * defaultValue 为默认值
 * modelPropName 为输入组件的值属性名，默认为 modelValue
 */
export async function prompt<T = any>(
  options: Omit<AlertProps, 'beforeClose'> & {
    beforeClose?: (
      scope: BeforeCloseScope & {
        /** 输入组件的当前值 */
        value: T;
      },
    ) => boolean | Promise<boolean | undefined> | undefined;
    component?: Component;
    componentProps?: Recordable<any>;
    defaultValue?: T;
    modelPropName?: string;
  },
): Promise<T | undefined>;
```
