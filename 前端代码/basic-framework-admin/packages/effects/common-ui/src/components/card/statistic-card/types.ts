/**
 * 统计卡片的 props 契约：只有 title 必填，数值、小数位、环比与提示均可选。
 * 组件对缺省数值按 0 渲染、环比取绝对值展示，取数与单位换算由使用方负责。
 */
export interface StatisticCardProps {
  /** 标题 */
  title: string;
  /** 提示信息 */
  tooltip?: string;
  /** 前缀 */
  prefix?: string;
  /** 数值 */
  value?: number;
  /** 小数位数 */
  decimals?: number;
  /** 环比百分比 */
  percent?: number | string;
  /** 环比标签文本 */
  percentLabel?: string;
}
