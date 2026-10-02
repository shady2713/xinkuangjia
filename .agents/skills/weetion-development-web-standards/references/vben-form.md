# Vben Form 组件参考文档
## 组件概述
Vben Form 是框架提供的表单组件，兼容 Ant Design Vue、Element Plus、Naive UI 等 UI 框架，底层使用 vee-validate 进行表单校验。当前应用通过 `#/adapter/form` 使用 Element Plus 适配；字段组件名与属性以 `apps/web-ele/src/adapter/component/index.ts` 的注册为准。

## 基础用法
使用 `useVbenForm` 创建表单实例，并通过 schema 配置表单字段。

## Schema 配置
### fieldName
- **类型**：`string`
- **是否必填**：是
- **说明**：字段名，对应表单数据的键

### label
- **类型**：`string`
- **默认值**：无
- **说明**：字段标签文本

### component
- **类型**：`string`
- **是否必填**：是
- **说明**：使用的组件类型
- **可选值**：`Input`、`Select`、`DatePicker`、`Checkbox`、`Radio`、`Switch`、`Textarea`、`InputNumber` 等

### componentProps
- **类型**：`object`
- **默认值**：`{}`
- **说明**：传递给组件的属性

### defaultValue
- **类型**：`any`
- **默认值**：无
- **说明**：字段的默认值

### rules
- **类型**：`string | object`
- **默认值**：无
- **说明**：校验规则，支持 vee-validate 规则和 zod schema

#### 使用 zod 进行复杂校验
```typescript
import { z } from '#/adapter/form';
// 基础类型
{
  rules: z.string().min(1, { message: '请输入字符串' });
}
// 可选（可以为 undefined），并携带默认值
{
  rules: z.string().default('default value').optional();
}
// 可以是空字符串、undefined 或邮箱地址
{
  rules: z.union([z.string().email().optional(), z.literal('')]);
}
{
  rules: z.string().email().or(z.literal('')).optional();
}
// 复杂校验
{
  rules: z.string()
    .min(1, { message: '请输入' })
    .refine((value) => value === '123', {
      message: '值必须为 123',
    });
}
```

### dependencies
- **类型**：`object`
- **默认值**：无
- **说明**：字段依赖配置，用于表单联动

#### dependencies 配置项
```typescript
dependencies: {
  // 触发字段；只有这些字段的值变化时才会触发联动
  triggerFields: ['name'],
  // 动态判断当前字段是否需要显示；不显示时直接销毁
  if(values, formApi) {},
  // 动态判断当前字段是否需要显示；不显示时使用 CSS 隐藏
  show(values, formApi) {},
  // 动态判断当前字段是否需要禁用
  disabled(values, formApi) {},
  // 每当字段变化时都会触发该函数：
  trigger(values, formApi) {},
  // 动态规则
  rules(values, formApi) {},
  // 动态必填
  required(values, formApi) {},
  // 动态组件参数
  componentProps(values, formApi) {},
}
```

## FormApi 方法
useVbenForm 返回的第二个参数包含以下方法：
### submitForm
- **说明**：提交表单
- **类型**：`(e:Event)=>Promise<Record<string,any>>`

### validateAndSubmitForm
- **说明**：提交并校验表单
- **类型**：`(e:Event)=>Promise<Record<string,any>>`

### resetForm
- **说明**：重置表单
- **类型**：`()=>Promise<void>`

### `setValues`
- **说明**：设置表单值。默认会过滤掉 schema 中未定义的字段。
- **类型**：`(fields: Record<string, any>, filterFields?: boolean, shouldValidate?: boolean) => Promise<void>`

### getValues
- **说明**：获取表单值。
- **类型**：`(fields:Record<string, any>,shouldValidate: boolean = false)=>Promise<void>`

### validate
- **说明**：表单校验。
- **类型**：`()=>Promise<void>`

### validateField
- **说明**：校验指定字段。
- **类型**：`(fieldName: string)=>Promise<ValidationResult<unknown>>`

### isFieldValid
- **说明**：检查字段是否通过校验。
- **类型**：`(fieldName: string)=>Promise<boolean>`

### resetValidate
- **说明**：重置表单校验
- **类型**：`()=>Promise<void>`

### updateSchema
- **说明**：更新 formSchema
- **类型**：`(schema:FormSchema[])=>void`

### setFieldValue
- **说明**：设置字段值
- **类型**：`(field: string, value: any, shouldValidate?: boolean)=>Promise<void>`

### setState
- **说明**：设置组件状态（props）
- **类型**：`(stateOrFn:| ((prev: VbenFormProps) => Partial<VbenFormProps>)| Partial<VbenFormProps>)=>Promise<void>`

### getState
- **说明**：获取组件状态（props）
- **类型**：`()=>Promise<VbenFormProps>`

### getFieldComponentRef
- **说明**：获取指定字段的组件实例
- **类型**：`<T=unknown>(fieldName: string)=>T`

### getFocusedField
- **说明**：获取当前获得焦点的字段
- **类型**：`()=>string|undefined`

## Props 配置
所有属性都可以传递给 useVbenForm 的第一个参数。

### layout
- **说明**：表单项布局
- **类型**：`'horizontal' | 'vertical' | 'inline'`
- **默认值**：`horizontal`

### showCollapseButton
- **说明**：是否显示折叠按钮
- **类型**：`boolean`
- **默认值**：`false`

### wrapperClass
- **说明**：表单布局，基于 tailwindcss
- **类型**：`any`

### actionWrapperClass
- **说明**：表单操作区类名
- **类型**：`any`

### actionLayout
- **说明**：表单操作按钮位置
- **类型**：`'newLine' | 'rowEnd' | 'inline'`
- **默认值**：`rowEnd`

### actionPosition
- **说明**：表单操作按钮对齐方式
- **类型**：`'left' | 'center' | 'right'`
- **默认值**：`right`

### handleReset
- **说明**：表单重置回调
- **类型**：`(values: Record<string, any>) => Promise<void> | void`

### handleSubmit
- **说明**：表单提交回调
- **类型**：`(values: Record<string, any>) => Promise<void> | void`

### handleValuesChange
- **说明**：表单值变化回调
- **类型**：`(values: Record<string, any>, fieldsChanged: string[]) => void`
- **备注**：
- 第一个参数 `values` 是表单变化后的当前值对象。
- 第二个参数 `fieldsChanged` 是包含所有已变化字段名的数组（v5.5.4+ 可用）。
- `fieldsChanged` 只包含 schema 中定义的字段名，不包含映射后的字段名。

### handleCollapsedChange
- **说明**：表单折叠/展开状态变化回调
- **类型**：`(collapsed: boolean) => void`

### actionButtonsReverse
- **说明**：反转操作按钮的位置
- **类型**：`boolean`
- **默认值**：`false`

### showDefaultActions
- **说明**：是否显示默认操作按钮
- **类型**：`boolean`
- **默认值**：`true`

### collapsed
- **说明**：是否折叠，在 showCollapseButton 为 true 时生效
- **类型**：`boolean`
- **默认值**：`false`

### collapseTriggerResize
- **说明**：折叠时触发 resize 事件
- **类型**：`boolean`
- **默认值**：`false`

### collapsedRows
- **说明**：折叠时保留的行数
- **类型**：`number`
- **默认值**：`1`

### fieldMappingTime
- **说明**：将表单内的数组值映射为两个字段。
- **类型**：`[string, [string, string], Nullable<string>|[string,string]|((any,string)=>any)?][]`
- **示例**：`[['timeRange', ['startTime', 'endTime'], 'YYYY-MM-DD']]`
- **备注**：
- 第一个参数：需要映射的字段名
- 第二个参数：映射的字段名数组
- 第三个参数（可选）：格式化掩码或格式化函数
- 设置为 null 时将原值不做格式化直接映射（适用于非日期时间字段）

### commonConfig
- **说明**：表单项的通用配置；每项配置都会传递给每个表单项。
- **类型**：`FormCommonConfig`

### schema
- **说明**：各表单项的配置。
- **类型**：`FormSchema[]`

### submitOnEnter
- **说明**：按下回车键时提交表单
- **类型**：`boolean`
- **默认值**：`false`

### submitOnChange
- **说明**：字段值变化时提交表单（内部做了防抖处理）
- **类型**：`boolean`
- **默认值**：`false`

### compact
- **说明**：是否使用紧凑模式（忽略为校验信息预留的空间）
- **类型**：`boolean`
- **默认值**：`false`

### scrollToFirstError
- **说明**：表单校验失败时是否自动滚动到第一个错误字段
- **类型**：`boolean`
- **默认值**：`false`

## 使用模板
**具体模板用法和代码示例请参考**：[对应模板](../assets/form-template.md)

## 插槽
### 内置插槽
| 插槽名 | 说明 |
|--------|------|
| reset-before | 重置按钮之前的位置 |
| submit-before | 提交按钮之前的位置 |
| expand-before | 展开按钮之前的位置 |
| expand-after | 展开按钮之后的位置 |

### 字段插槽
除上述内置插槽外，schema 属性中每个字段的 fieldName 都可以作为插槽名使用。

**重要说明**：
- 字段插槽的优先级高于 component 属性中定义的组件。
- 当提供与 fieldName 同名的插槽时，插槽内容将作为该字段的组件使用。
- 此时 component 的值将被忽略。

## TypeScript 类型定义
### ActionButtonOptions
```typescript
interface ActionButtonOptions {
  class?: ClassType; // 样式
  disabled?: boolean; // 是否禁用
  loading?: boolean; // 是否加载中
  size?: ButtonVariantSize; // 按钮尺寸
  variant?: ButtonVariants; // 按钮类型
  show?: boolean; // 是否显示
  content?: string; // 按钮文本
  [key: string]: any; // 任意属性
}
```

### FormCommonConfig
```typescript
interface FormCommonConfig {
  componentProps?: ComponentProps; // 所有表单项的 props
  controlClass?: string; // 所有表单项的控件样式
  colon?: boolean; // 在标签后显示冒号
  disabled?: boolean; // 所有表单项的禁用状态
  formFieldProps?: Partial<typeof Field>; // 所有表单项的样式
  formItemClass?: (() => string) | string; // 所有表单项的栅格布局
  hideLabel?: boolean; // 隐藏所有表单项标签
  hideRequiredMark?: boolean; // 是否隐藏必填标记
  labelClass?: string; // 所有表单项的标签样式
  labelWidth?: number; // 所有表单项的标签宽度
  modelPropName?: string; // 模型属性名（默认 "modelValue"）
  wrapperClass?: string; // 所有表单项的包裹样式
}
```

### FormSchema
```typescript
interface FormSchema<T = BaseFormComponentType> extends FormCommonConfig {
  component: Component | T; // 组件
  componentProps?: ComponentProps; // 组件参数
  defaultValue?: any; // 默认值
  dependencies?: FormItemDependencies; // 依赖配置
  description?: string; // 描述
  fieldName: string; // 字段名（必填）
  help?: CustomRenderType; // 帮助信息
  hide?: boolean; // 是否隐藏表单项
  label?: CustomRenderType; // 表单标签
  renderComponentContent?: RenderComponentContentType; // 自定义组件内部渲染
  rules?: FormSchemaRuleType; // 字段规则
  suffix?: CustomRenderType; // 后缀
}
