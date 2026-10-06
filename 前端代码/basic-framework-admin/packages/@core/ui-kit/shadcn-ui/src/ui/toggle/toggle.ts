/**
 * 切换按钮的样式变体：用 cva 声明 default、outline 两种外观
 * 与 sm、default、lg 三种尺寸，并导出推导出的 ToggleVariants 类型。
 * 只产出 class 字符串，交互状态由 Toggle.vue 与切换组选项消费。
 */
import type { VariantProps } from 'class-variance-authority';

import { cva } from 'class-variance-authority';

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

export type ToggleVariants = VariantProps<typeof toggleVariants>;
