/**
 * 按钮类型契约：VbenButtonProps 描述基础按钮入参，
 * VbenButtonGroupProps 描述按钮组的选项与多选/单选开关，
 * 另含 CustomRenderType、ValueType 两个渲染与取值别名。
 * 只声明类型，不含渲染实现。
 */
import type { AsTag } from 'reka-ui';

import type { Component } from 'vue';

import type { ClassValue } from '@vben-core/shared/utils';

import type { ButtonVariants, ButtonVariantSize } from '../../ui';

/**
 * 基础按钮的属性契约。
 * 样式由 variant 与 size 两个预设决定，class 用于在预设之上追加覆盖；
 * disabled 与 loading 是两条独立的禁用路径，前者表示业务不可用，
 * 后者表示操作进行中，组件会把两者合并后作用到渲染元素上。
 */
export interface VbenButtonProps {
  /**
   * The element or component this component should render as. Can be overwrite by `asChild`
   * @defaultValue "div"
   */
  as?: AsTag | Component;
  /**
   * Change the default rendered element for the one passed as a child, merging their props and behavior.
   *
   * Read our [Composition](https://www.reka-ui.com/docs/guides/composition) guide for more details.
   */
  asChild?: boolean;
  class?: ClassValue;
  disabled?: boolean;
  loading?: boolean;
  size?: ButtonVariantSize;
  variant?: ButtonVariants;
}

/**
 * 选项标题的渲染形态：直接写字符串，或写一个返回组件/标签名的函数，
 * 函数形式用于标题依赖内部状态、需要在渲染期再求值的场景。
 */
// 保持单行：prettier 会把括号内的 JSDoc 上提到括号外，使函数类型的中文说明脱离节点。
// prettier-ignore
export type CustomRenderType = (/** 无参的标题渲染函数，返回要渲染的组件或标签名 */ () => Component | string) | string;

/** 按钮组的取值域，选项、选中结果与 beforeChange 回调都限定在这三种标量内。 */
export type ValueType = boolean | number | string;

/**
 * 按钮组的属性契约。
 * 组件只负责把 options 渲染成一排按钮并维护选中结果，选中值以 v-model 双向绑定；
 * beforeChange 是选中前的拦截点，multiple 决定选中结果是数组还是单个值。
 * 继承自 VbenButtonProps 的 disabled 用于整组禁用。
 */
export interface VbenButtonGroupProps extends Pick<
  VbenButtonProps,
  'disabled'
> {
  /** 单选模式下允许清除选中 */
  allowClear?: boolean;
  /** 值改变前的回调 */
  beforeChange?: (
    value: ValueType,
    isChecked: boolean,
  ) => boolean | PromiseLike<boolean | undefined> | undefined;
  /** 按钮样式 */
  btnClass?: ClassValue;
  /** 按钮间隔距离 */
  gap?: number;
  /** 多选模式下限制最多选择的数量。0表示不限制 */
  maxCount?: number;
  /** 是否允许多选 */
  multiple?: boolean;
  /**
   * 选项
   * 只约束组件真正读取的 label / value；业务可在单个选项上附加自定义字段
   * （如权限标识、排序权重），组件不解释其含义，因此这里不做索引签名约束，
   * 避免要求调用方的选项类型必须自带字符串索引签名。
   */
  options?: { label: CustomRenderType; value: ValueType }[];
  /** 显示图标 */
  showIcon?: boolean;
  /** 尺寸 */
  size?: 'large' | 'middle' | 'small';
}
