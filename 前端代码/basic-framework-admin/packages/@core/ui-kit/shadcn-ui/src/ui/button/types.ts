/**
 * 按钮类型契约：约束尺寸为五档、变体为八种语义配色，均允许空值。
 * 与 button.ts 的 cva 配置配套，供上层封装声明属性类型。
 */
export type ButtonVariantSize =
  | 'default'
  | 'icon'
  | 'lg'
  | 'sm'
  | 'xs'
  | null
  | undefined;

/**
 * 按钮语义配色的取值联合：与 button.ts 的 variant 轴逐项对应，
 * null 与 undefined 视为不指定并交给 cva 回落默认值。
 */
export type ButtonVariants =
  | 'default'
  | 'destructive'
  | 'ghost'
  | 'heavy'
  | 'icon'
  | 'link'
  | 'outline'
  | 'secondary'
  | null
  | undefined;
