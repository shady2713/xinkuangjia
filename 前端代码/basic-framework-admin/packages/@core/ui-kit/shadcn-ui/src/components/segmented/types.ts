/**
 * 分段控件的数据契约：一个选项由展示文案 label 与取值 value 组成。
 * 作为 tabs 属性的条目类型，不含图标、禁用等扩展字段。
 */
interface SegmentedItem {
  label: string;
  value: string;
}

export type { SegmentedItem };
