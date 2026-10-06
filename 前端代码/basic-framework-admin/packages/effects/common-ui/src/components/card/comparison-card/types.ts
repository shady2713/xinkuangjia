/** 对比卡片的 props 契约：标题、数值与今日新增必填，图标名与加载态可选。 */
export interface ComparisonCardProps {
  icon: string; // 图标名称
  iconColor?: string; // 图标颜色类名
  loading?: boolean; // 加载状态
  title: string; // 标题
  todayCount: number; // 今日新增数量
  value: number; // 数值
}
