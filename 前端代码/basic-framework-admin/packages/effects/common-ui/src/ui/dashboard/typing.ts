/**
 * 仪表盘展示数据的结构定义：为分析页指标与工作台各列表提供条目形状。
 *
 * 只声明字段约定，不含取数、排序等运行时逻辑。
 */
import type { Component } from 'vue';

/** 分析页指标卡：图标、标题、总计文案与总计值，以及当前统计值。 */
interface AnalysisOverviewItem {
  icon: Component | string;
  title: string;
  totalTitle: string;
  totalValue: number;
  value: number;
}

/** 工作台项目条目：分组、标题、描述与日期，可选图标、主题色与跳转地址。 */
interface WorkbenchProjectItem {
  color?: string;
  content: string;
  date: string;
  group: string;
  icon: Component | string;
  title: string;
  url?: string;
}

/** 工作台动态条目：头像、标题、正文与日期。 */
interface WorkbenchTrendItem {
  avatar: string;
  content: string;
  date: string;
  title: string;
}

/** 工作台待办条目：标题、正文、日期与是否已完成。 */
interface WorkbenchTodoItem {
  completed: boolean;
  content: string;
  date: string;
  title: string;
}

/** 工作台快捷导航条目：标题与图标，可选主题色与跳转地址。 */
interface WorkbenchQuickNavItem {
  color?: string;
  icon: Component | string;
  title: string;
  url?: string;
}

export type {
  AnalysisOverviewItem,
  WorkbenchProjectItem,
  WorkbenchQuickNavItem,
  WorkbenchTodoItem,
  WorkbenchTrendItem,
};
