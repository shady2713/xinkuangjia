/**
 * 徽章样式变体：提供 default、destructive、outline、secondary 四种配色。
 * 只产出类名且默认取 default，文案与图标由 Badge.vue 或使用方决定。
 */
import type { VariantProps } from 'class-variance-authority';

import { cva } from 'class-variance-authority';

/**
 * cva 变体表：基础类名负责行内弹性、圆角边框、字号字重与过渡色，
 * variant 轴给出 default、destructive、outline、secondary 四档配色；
 * 调用时不传 variant 会按 defaultVariants 取 default，不会返回空串。
 */
export const badgeVariants = cva(
  'inline-flex items-center rounded-md border border-border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    defaultVariants: {
      variant: 'default',
    },
    variants: {
      variant: {
        default:
          'border-transparent bg-accent hover:bg-accent text-primary-foreground shadow',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive-hover',
        outline: 'text-foreground',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
      },
    },
  },
);

/** badgeVariants 变体轴的可选取值类型，与 cva 推导结果保持一致，供徽章组件声明 variant 属性。 */
export type BadgeVariants = VariantProps<typeof badgeVariants>;
