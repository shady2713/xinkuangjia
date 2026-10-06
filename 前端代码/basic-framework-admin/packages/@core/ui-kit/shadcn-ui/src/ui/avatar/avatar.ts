/**
 * 头像样式变体：定义 circle、square 两种形状与 sm、base、lg 三档尺寸。
 * 仅产出类名，文字降级与状态圆点由上层头像组件另行补充。
 */
import type { VariantProps } from 'class-variance-authority';

import { cva } from 'class-variance-authority';

/**
 * cva 变体表：基础类名锁定行内弹性居中、文字禁止选中与溢出裁剪，
 * shape、size 两轴可任意组合；某个轴不传时只输出基础类名，
 * 不会隐式补上任何默认形状或默认尺寸。
 */
export const avatarVariant = cva(
  'inline-flex items-center justify-center font-normal text-foreground select-none shrink-0 bg-secondary overflow-hidden',
  {
    variants: {
      shape: {
        circle: 'rounded-full',
        square: 'rounded-md',
      },
      size: {
        base: 'h-16 w-16 text-2xl',
        lg: 'h-32 w-32 text-5xl',
        sm: 'h-10 w-10 text-xs',
      },
    },
  },
);

/** avatarVariant 两个变体轴的可选取值集合，由 cva 反推得出；值为 undefined 表示该轴不指定。 */
export type AvatarVariants = VariantProps<typeof avatarVariant>;
