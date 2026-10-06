/**
 * 切换按钮的样式变体：用 cva 声明 default、outline 两种外观
 * 与 sm、default、lg 三种尺寸，并导出推导出的 ToggleVariants 类型。
 * 只产出 class 字符串，交互状态由 Toggle.vue 与切换组选项消费。
 */
import type { VariantProps } from 'class-variance-authority';

import { cva } from 'class-variance-authority';

/**
 * cva 变体表：基础类名处理排版、悬停与聚焦反馈，并用 data-[state=on] 表达按下态底色，
 * size 三档（sm、default、lg）与 variant 两档（default、outline）正交组合，
 * 两轴都缺省时按 defaultVariants 回落。
 */
export const toggleVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground',
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-9 px-3',
        lg: 'h-10 px-3',
        sm: 'h-8 px-2',
      },
      variant: {
        default: 'bg-transparent',
        outline:
          'border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground',
      },
    },
  },
);

/** toggleVariants 变体轴的可选取值类型，Toggle.vue 与切换组组件据此声明 size、variant 属性。 */
export type ToggleVariants = VariantProps<typeof toggleVariants>;
