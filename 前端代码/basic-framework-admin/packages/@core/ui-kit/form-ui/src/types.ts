/** 动态表单的类型契约：schema 描述、值类型、校验规则与渲染属性的统一口径。 */
import type {
  FieldOptions,
  FormContext,
  GenericObject,
  GenericValidateFunction,
} from 'vee-validate';
import type { ZodTypeAny } from 'zod';

import type { Component, HtmlHTMLAttributes, Ref, VNodeChild } from 'vue';

import type { VbenButtonProps } from '@vben-core/shadcn-ui';
import type { ClassType, MaybeComputedRef } from '@vben-core/typings';

import type { FormApi } from './form-api';

/** 动态表单值必须由字段规则或业务边界收窄后使用。 */
export type FormValues = Record<string, unknown>;

/**
 * 表单值泛型的约束类型。
 * 刻意复用 vee-validate 自身的 `GenericObject` 口径：业务 `interface` 可以直接作为
 * 值类型实参，而读写时又由具体 `TValues` 收窄，不需要在调用侧补索引签名。
 */
export type FormValuesConstraint = GenericObject;

/** 表单整体排布方式：标签与控件同行、标签在上或全部横向铺开，只影响展示不改校验。 */
export type FormLayout = 'horizontal' | 'inline' | 'vertical';

/** schema 中 `component` 可填写的控件名：内置控件名，或业务在适配层注册过的自定义名字符串。 */
export type BaseFormComponentType =
  | 'DefaultButton'
  | 'PrimaryButton'
  | 'VbenCheckbox'
  | 'VbenInput'
  | 'VbenInputPassword'
  | 'VbenPinInput'
  | 'VbenSelect'
  | (Record<never, never> & string);

/** 栅格类名允许的响应式断点前缀，空串表示不带断点，即始终生效的基础档。 */
type Breakpoints = '2xl:' | '3xl:' | '' | 'lg:' | 'md:' | 'sm:' | 'xl:';

/** 栅格列数的取值集合，覆盖 Tailwind 默认 1 到 13 列；超出该范围的列数不在类型允许范围内。 */
type GridCols = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

/** 表单容器的栅格类名：`断点前缀 + 列数`，也可以直接写任意自定义类名覆盖默认布局。 */
export type WrapperClassType =
  | `${Breakpoints}grid-cols-${GridCols}`
  | (Record<never, never> & string);

/** 单个表单项的栅格类名：控制起始列、结束列与跨越列数，取值可以是 auto、full 或具体列数。 */
export type FormItemClassType =
  | `${Breakpoints}cols-end-${'auto' | GridCols}`
  | `${Breakpoints}cols-span-${'auto' | 'full' | GridCols}`
  | `${Breakpoints}cols-start-${'auto' | GridCols}`
  | (Record<never, never> & string)
  | WrapperClassType;

/**
 * 交给 vee-validate Field 的渲染参数。
 * 全部成员可选，并在 FieldOptions 之上补出 blur/change/input/modelUpdate 四个校验触发开关。
 */
export type FormFieldOptions = Partial<
  FieldOptions<unknown> & {
    validateOnBlur?: boolean;
    validateOnChange?: boolean;
    validateOnInput?: boolean;
    validateOnModelUpdate?: boolean;
  }
>;

/** 通过 shapes 插槽下发给业务的字段描述，只给出字段名、默认值与是否必填，字段值本身不暴露。 */
export interface FormShape {
  /** 默认值 */
  default?: unknown;
  /** 字段名 */
  fieldName: string;
  /** 是否必填 */
  required?: boolean;
  rules?: ZodTypeAny;
}

/** 允许透传到控件的属性键：常用交互属性与原生 HTML 属性，外加任意自定义键以保留透传能力。 */
export type MaybeComponentPropKey =
  | 'options'
  | 'placeholder'
  | 'title'
  | keyof HtmlHTMLAttributes
  | (Record<never, never> & string);

/** 允许透传给控件的属性键：常用交互属性，加上业务自定义键以保持透传能力。 */
export type MaybeComponentProps = { [K in MaybeComponentPropKey]?: unknown };

/** vee-validate 表单上下文，按声明的值类型收窄读写面。 */
export type FormActions<TValues extends FormValuesConstraint = FormValues> =
  FormContext<TValues>;

/**
 * 按控件默认插槽参数渲染内容。
 * @param slotProps 控件传入的插槽参数，例如 Select 的 `{ label, value }`。
 * @returns 要渲染的组件、文本或虚拟节点。
 */
type CustomRenderFn = (
  slotProps?: Record<string, unknown>,
) => Component | string | VNodeChild;

/**
 * 命名插槽内容：静态文本或渲染函数。
 * 渲染函数可以声明接收组件默认插槽参数（例如 Select 的 `{ label, value }`），
 * 参数保持可选，既兼容既有不接收参数的写法，也允许直接传给 `VbenRenderContent`。
 */
export type CustomRenderType = CustomRenderFn | string;

/**
 * 表单项的校验规则：内置命名规则、业务自定义规则名，或直接给 zod 规则对象；null 表示不校验。
 */
export type FormSchemaRuleType =
  | 'emailRequired'
  | 'mobile'
  | 'mobileRequired'
  | 'passwordRequired'
  | 'required'
  | 'selectRequired'
  | 'uploadRequired'
  | 'usernameRequired'
  | null
  | (Record<never, never> & string)
  | ZodTypeAny;

/**
 * 依赖回调的入参契约。
 *
 * `value` 与 `actions` 都按动态键视图给出，而不是按值类型泛型化：
 * 联动回调的 `value` 类型是逆变位置，一旦引入 `TValues`，同一份 schema 就无法在
 * 不同值类型的表单间复用。字段的具体形状由页面在回调内部自行收窄。
 */
/**
 * 联动条件：在依赖字段变化后重新计算字段的显隐、必填或组件参数。
 * @param value 当前表单值，字段形状由调用方按自身 schema 收窄。
 * @param actions 表单上下文，用于读取其他字段或直接写值。
 * @returns 条件成立与否；可以返回 Promise 以支持异步判定。
 */
type FormItemDependenciesCondition<T = boolean | PromiseLike<boolean>> = (
  value: Partial<FormValues>,
  actions: FormActions,
) => T;

/**
 * 联动规则：按依赖字段的当前值追加或替换本字段的校验规则。
 * @param value 当前表单值。
 * @param actions 表单上下文。
 * @returns 规则名、Zod 规则或 null；可以返回 Promise 以支持异步取规则。
 */
type FormItemDependenciesConditionWithRules = (
  value: Partial<FormValues>,
  actions: FormActions,
) => FormSchemaRuleType | PromiseLike<FormSchemaRuleType>;

/**
 * 联动组件参数：按依赖字段的当前值计算本字段控件的属性。
 * @param value 当前表单值。
 * @param actions 表单上下文。
 * @returns 要透传给控件的属性对象；可以返回 Promise 以支持异步取参。
 */
type FormItemDependenciesConditionWithProps = (
  value: Partial<FormValues>,
  actions: FormActions,
) => MaybeComponentProps | PromiseLike<MaybeComponentProps>;

/**
 * 表单项联动声明：`triggerFields` 声明被哪些字段的变化触发，其余成员声明触发后要重算本字段的哪一部分。
 * `if` 与 `show` 的区别是前者会移除 DOM、后者只用样式隐藏。
 */
export interface FormItemDependencies {
  /**
   * 组件参数
   * @returns 组件参数
   */
  componentProps?: FormItemDependenciesConditionWithProps;
  /**
   * 是否禁用
   * @returns 是否禁用
   */
  disabled?: boolean | FormItemDependenciesCondition;
  /**
   * 是否渲染（删除dom）
   * @returns 是否渲染
   */
  if?: boolean | FormItemDependenciesCondition;
  /**
   * 是否必填
   * @returns 是否必填
   */
  required?: FormItemDependenciesCondition;
  /**
   * 字段规则
   */
  rules?: FormItemDependenciesConditionWithRules;
  /**
   * 是否隐藏(Css)
   * @returns 是否隐藏
   */
  show?: boolean | FormItemDependenciesCondition;
  /**
   * 任意触发都会执行
   */
  trigger?: FormItemDependenciesCondition<void>;
  /**
   * 触发字段
   */
  triggerFields: string[];
}

/**
 * 按当前表单值实时计算控件属性，用于让控件跟随其他字段变化。
 * @param value 当前表单值。
 * @param actions 表单上下文。
 * @returns 要透传给控件的属性对象。
 */
type DynamicComponentPropsFn = (
  value: Partial<FormValues>,
  actions: FormActions,
) => MaybeComponentProps;

/**
 * 组件参数：静态参数对象，或按当前表单值动态计算的函数。
 * 动态函数在渲染时以实际表单值调用，返回值直接透传给控件。
 */
export type FormComponentProps = DynamicComponentPropsFn | MaybeComponentProps;

/**
 * 下发给全部表单项的公共配置：统一标签、栅格与控件参数的默认口径。
 * 表单项自己声明的同名配置优先级更高，因此这里只作为兜底。
 */
export interface FormCommonConfig {
  /**
   * 在Label后显示一个冒号
   */
  colon?: boolean;
  /**
   * 所有表单项的props
   */
  componentProps?: FormComponentProps;
  /**
   * 所有表单项的控件样式
   */
  controlClass?: string;
  /**
   * 所有表单项的禁用状态
   * @default false
   */
  disabled?: boolean;
  /**
   * 是否禁用所有表单项的change事件监听
   * @default true
   */
  disabledOnChangeListener?: boolean;
  /**
   * 是否禁用所有表单项的input事件监听
   * @default true
   */
  disabledOnInputListener?: boolean;
  /**
   * 所有表单项的空状态值,默认都是undefined，naive-ui的空状态值是null
   */
  emptyStateValue?: null | undefined;
  /**
   * 所有表单项的控件样式
   * @default {}
   */
  formFieldProps?: FormFieldOptions;
  /**
   * 所有表单项的栅格布局，支持函数形式
   * 字符串直接当作类名使用；函数形式在每次渲染时求值，求值抛错只打印错误并退化为空串。
   * @default ""
   */
  // 保持单行：prettier 会把括号内的 JSDoc 上提到括号外，使函数类型的中文说明脱离节点。
  // prettier-ignore
  formItemClass?: (/** 渲染期求值函数，返回本表单项的栅格类名。 */ () => string) | string;
  /**
   * 隐藏所有表单项label
   * @default false
   */
  hideLabel?: boolean;
  /**
   * 是否隐藏必填标记
   * @default false
   */
  hideRequiredMark?: boolean;
  /**
   * 所有表单项的label样式
   * @default ""
   */
  labelClass?: string;
  /**
   * 所有表单项的label宽度
   */
  labelWidth?: number;
  /**
   * 所有表单项的model属性名
   * @default "modelValue"
   */
  modelPropName?: string;
  /**
   * 所有表单项的wrapper样式
   */
  wrapperClass?: string;
}

/**
 * 根据当前表单构造组件命名插槽内容。
 * 入参按动态键视图给出，与表单声明的值类型无关。
 */
type RenderComponentContentType = (
  value: Partial<FormValues>,
  api: FormActions,
) => Record<string, CustomRenderType>;

/**
 * 提交回调：仅在校验全部通过后调用，入参是当前表单值。
 * @param values 校验通过后的表单值，形状与调用方声明的值类型一致。
 * @returns 业务处理完成后 resolve；抛出的异常会向上冒泡给调用方。
 */
export type HandleSubmitFn<TValues extends FormValuesConstraint = FormValues> =
  (values: TValues) => Promise<void> | void;

/**
 * 重置回调：入参是重置后的表单值。
 * @param values 重置完成后读取到的表单值。
 * @returns 业务处理完成后 resolve；抛出的异常会向上冒泡给调用方。
 */
export type HandleResetFn<TValues extends FormValuesConstraint = FormValues> = (
  values: TValues,
) => Promise<void> | void;

/**
 * 用自定义函数决定区间两端写出的值。
 * @param value 区间的一端。
 * @param fieldName 正在展开的字段名，供函数按字段区分处理。
 * @returns 写入开始键或结束键的最终值。
 */
type RangeTimeFormatter = (value: unknown, fieldName: string) => unknown;

/**
 * 时间区间展开配置：每项给出区间字段名、展开后的开始键与结束键，以及两端的格式化方式。
 */
export type FieldMappingTime = [
  string,
  [string, string],
  [string, string] | null | RangeTimeFormatter | string,
][];

/**
 * 数组字段的字符串映射声明，三种写法等价：
 * 单个字段名用默认逗号分隔；字符串数组的末位若是单个字符则作为分隔符；嵌套数组第二项为分隔符。
 */
export type ArrayToStringFields = Array<
  | [string[], string?] // 嵌套数组格式，可选分隔符
  | string // 单个字段，使用默认分隔符
  | string[] // 简单数组格式，最后一个元素可以是分隔符
>;

/**
 * 表单项定义。
 *
 * 这里只描述“有哪些字段、用什么控件、什么规则”，因此不携带值类型：
 * 字段名是动态字符串，联动回调也按动态键视图工作。
 * 表单实例声明的值类型（`VbenFormProps` 的 `TValues`）只约束读写与提交回调，
 * 因此同一份 schema 可以被任意值类型的表单复用。
 */
export interface FormSchema<
  T extends BaseFormComponentType = BaseFormComponentType,
> extends FormCommonConfig {
  /** 组件 */
  component: Component | T;
  /** 组件参数 */
  componentProps?: FormComponentProps;
  /** 默认值 */
  defaultValue?: unknown;
  /** 依赖 */
  dependencies?: FormItemDependencies;
  /** 描述 */
  description?: CustomRenderType;
  /** 字段名 */
  fieldName: string;
  /** 帮助信息 */
  help?: CustomRenderType;
  /** 是否隐藏表单项 */
  hide?: boolean;
  /** 表单项 */
  label?: CustomRenderType;
  // 自定义组件内部渲染
  renderComponentContent?: RenderComponentContentType;
  /** 字段规则 */
  rules?: FormSchemaRuleType;
  /** 后缀 */
  suffix?: CustomRenderType;
}

/** 字段渲染属性：在表单项定义之上补一层渲染期参数。 */
export interface FormFieldProps<
  T extends BaseFormComponentType = BaseFormComponentType,
> extends FormSchema<T> {
  required?: boolean;
}

/**
 * 表单渲染层的输入属性：控件表、schema、公共配置与折叠控制。
 * 不含表单实例与业务回调，渲染层只按这些属性产出 DOM。
 */
export interface FormRenderProps<
  T extends BaseFormComponentType = BaseFormComponentType,
> {
  /**
   * 表单字段数组映射字符串配置 默认使用","
   */
  arrayToStringFields?: ArrayToStringFields;
  /**
   * 是否折叠，在showCollapseButton=true下生效
   * true:折叠 false:展开
   */
  collapsed?: boolean;
  /**
   * 折叠时保持行数
   * @default 1
   */
  collapsedRows?: number;
  /**
   * 是否触发resize事件
   * @default false
   */
  collapseTriggerResize?: boolean;
  /**
   * 表单项通用后备配置，当子项目没配置时使用这里的配置，子项目配置优先级高于此配置
   */
  commonConfig?: FormCommonConfig;
  /**
   * 紧凑模式（移除表单每一项底部为校验信息预留的空间）
   */
  compact?: boolean;
  /**
   * 组件v-model事件绑定
   */
  componentBindEventMap?: Partial<Record<BaseFormComponentType, string>>;
  /**
   * 组件集合
   */
  componentMap: Record<BaseFormComponentType, Component>;
  /**
   * 表单字段映射到时间格式
   */
  fieldMappingTime?: FieldMappingTime;
  /**
   * 表单实例
   */
  form?: FormContext;
  /**
   * 表单项布局
   */
  layout?: FormLayout;
  /**
   * 表单定义
   */
  schema?: FormSchema<T>[];

  /**
   * 是否显示展开/折叠
   */
  showCollapseButton?: boolean;
  /**
   * 格式化日期
   */

  /**
   * 表单栅格布局
   * @default "grid-cols-1"
   */
  wrapperClass?: WrapperClassType;
}

/** 操作按钮的透传参数：在通用按钮属性之外补出文案与显隐开关，其余键原样交给按钮组件。 */
export interface ActionButtonOptions extends VbenButtonProps {
  [key: string]: unknown;
  content?: MaybeComputedRef<string>;
  show?: boolean;
}

/**
 * 表单组件属性。
 *
 * `T` 决定 schema 中 `component` 的可取值集合，`TValues` 决定提交、重置与取值回调的参数类型；
 * 两者互相独立，同一份 schema 因此可以在不同值类型的表单间复用。
 */
export interface VbenFormProps<
  T extends BaseFormComponentType = BaseFormComponentType,
  TValues extends FormValuesConstraint = FormValues,
> extends Omit<
  FormRenderProps<T>,
  'componentBindEventMap' | 'componentMap' | 'form'
> {
  /**
   * 操作按钮是否反转（提交按钮前置）
   */
  actionButtonsReverse?: boolean;
  /**
   * 操作按钮组的样式
   * newLine: 在新行显示。rowEnd: 在行内显示，靠右对齐（默认）。inline: 使用grid默认样式
   */
  actionLayout?: 'inline' | 'newLine' | 'rowEnd';
  /**
   * 操作按钮组显示位置，默认靠右显示
   */
  actionPosition?: 'center' | 'left' | 'right';
  /**
   * 表单操作区域class
   */
  actionWrapperClass?: ClassType;
  /**
   * 表单字段数组映射字符串配置 默认使用","
   */
  arrayToStringFields?: ArrayToStringFields;

  /**
   * 表单字段映射
   */
  fieldMappingTime?: FieldMappingTime;
  /**
   * 表单收起展开状态变化回调
   */
  handleCollapsedChange?: (collapsed: boolean) => void;
  /**
   * 表单重置回调
   */
  handleReset?: HandleResetFn<TValues>;
  /**
   * 表单提交回调
   */
  handleSubmit?: HandleSubmitFn<TValues>;
  /**
   * 表单值变化回调
   */
  handleValuesChange?: (values: TValues, fieldsChanged: string[]) => void;
  /**
   * 重置按钮参数
   */
  resetButtonOptions?: ActionButtonOptions;

  /**
   * 验证失败时是否自动滚动到第一个错误字段
   * @default false
   */
  scrollToFirstError?: boolean;

  /**
   * 是否显示默认操作按钮
   * @default true
   */
  showDefaultActions?: boolean;

  /**
   * 提交按钮参数
   */
  submitButtonOptions?: ActionButtonOptions;

  /**
   * 是否在字段值改变时提交表单
   * @default false
   */
  submitOnChange?: boolean;

  /**
   * 是否在回车时提交表单
   * @default false
   */
  submitOnEnter?: boolean;
}

/**
 * 从表单状态中挑选需要响应的部分。
 * 传入 NoInfer 状态类型，避免调用方在选择器里反推泛型实参。
 * @param state 当前表单状态。
 * @returns 需要订阅的响应式结果。
 */
type FormStateSelector<
  T extends BaseFormComponentType,
  TValues extends FormValuesConstraint,
  R,
> = (state: NoInfer<VbenFormProps<T, TValues>>) => R;

/** 供业务组件消费的表单实例：保留 `FormApi` 全部能力并补充状态订阅。 */
export type ExtendedFormApi<
  TValues extends FormValuesConstraint = FormValues,
  T extends BaseFormComponentType = BaseFormComponentType,
> = {
  /**
   * 订阅表单状态。
   * @param selector 从状态中挑选需要响应的部分；缺省时订阅整个状态对象。
   * @returns 只读的响应式结果，状态变化时组件自动更新。
   */
  useStore: <R = NoInfer<VbenFormProps<T, TValues>>>(
    selector?: FormStateSelector<T, TValues, R>,
  ) => Readonly<Ref<R>>;
} & FormApi<TValues, T>;

/**
 * 应用启动时一次性登记的表单适配配置：控件取值属性名、监听开关与业务自定义命名规则。
 * 这里的配置是全局的，对之后创建的所有表单生效。
 */
export interface VbenFormAdapterOptions<
  T extends BaseFormComponentType = BaseFormComponentType,
> {
  config?: {
    baseModelPropName?: string;
    disabledOnChangeListener?: boolean;
    disabledOnInputListener?: boolean;
    emptyStateValue?: null | undefined;
    modelPropNameMap?: Partial<Record<T, string>>;
  };
  /** 允许业务扩展规则名，回调数据遵守 vee-validate 的实际调用契约。 */
  defineRules?: Record<string, NamedFormRule>;
}

/**
 * 命名规则接收未校验字段及可选参数；上下文由 vee-validate 提供。
 * @param value 待校验字段的原始值。
 * @param params 规则声明时传入的参数，可以是位置参数或具名参数。
 * @param context vee-validate 提供的校验上下文，含字段路径与表单实例。
 * @returns 校验通过为 true；返回字符串时该字符串作为错误提示。
 */
export type NamedFormRule = (
  value: unknown,
  params: Record<string, unknown> | unknown[],
  context: Parameters<GenericValidateFunction>[1],
) => boolean | Promise<boolean | string> | string;
