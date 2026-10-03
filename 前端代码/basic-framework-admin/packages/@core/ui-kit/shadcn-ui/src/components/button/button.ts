import type { AsTag } from 'reka-ui';

import type { Component } from 'vue';

import type { ClassValue } from '@vben-core/shared/utils';

import type { ButtonVariants, ButtonVariantSize } from '../../ui';

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

export type CustomRenderType = (() => Component | string) | string;

export type ValueType = boolean | number | string;

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
