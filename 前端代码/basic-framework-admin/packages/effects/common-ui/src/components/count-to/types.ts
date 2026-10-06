/**
 * 数字滚动的类型契约：把 @vueuse 的过渡曲线表摊成可枚举的曲线名与取值类型。
 * CountToProps 覆盖起止值、时长、分隔符、小数位、前后缀及四段样式类名。
 */
import type { CubicBezierPoints, EasingFunction } from '@vueuse/core';

import type { StyleValue } from 'vue';

import { TransitionPresets as TransitionPresetsData } from '@vueuse/core';

/** 过渡曲线名：取自 @vueuse 过渡预设表的键，可直接写入 transition 属性。 */
export type TransitionPresets = keyof typeof TransitionPresetsData;

/** 全部过渡曲线名列表，供调用方枚举可选曲线。 */
export const TransitionPresetsKeys = Object.keys(
  TransitionPresetsData,
) as TransitionPresets[];

/** 数字滚动属性：起止值、时长与延迟、分隔符与小数位、前后缀，以及四段样式类名与内联样式。 */
export interface CountToProps {
  /** 初始值 */
  startVal?: number;
  /** 当前值 */
  endVal: number;
  /** 是否禁用动画 */
  disabled?: boolean;
  /** 延迟动画开始的时间 */
  delay?: number;
  /** 持续时间  */
  duration?: number;
  /** 小数位数  */
  decimals?: number;
  /** 小数点  */
  decimal?: string;
  /** 分隔符  */
  separator?: string;
  /** 前缀  */
  prefix?: string;
  /** 后缀  */
  suffix?: string;
  /** 过渡效果  */
  transition?: CubicBezierPoints | EasingFunction | TransitionPresets;
  /** 整数部分的类名 */
  mainClass?: string;
  /** 小数部分的类名 */
  decimalClass?: string;
  /** 前缀部分的类名 */
  prefixClass?: string;
  /** 后缀部分的类名 */
  suffixClass?: string;

  /** 整数部分的样式 */
  mainStyle?: StyleValue;
  /** 小数部分的样式 */
  decimalStyle?: StyleValue;
  /** 前缀部分的样式 */
  prefixStyle?: StyleValue;
  /** 后缀部分的样式 */
  suffixStyle?: StyleValue;
}
