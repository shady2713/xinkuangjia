/**
 * 面包屑数据契约：IBreadcrumb 描述单级标题、图标、路径
 * 与子项，BreadcrumbProps 约定组件入参。
 * 只有类型定义，样式与交互在对应组件里。
 */
import type { Component } from 'vue';

import type { BreadcrumbStyleType } from '@vben-core/typings';

/**
 * 单级面包屑数据项：title 决定展示文案，path 决定点击后抛给调用方的路径；
 * items 非空时该级改渲染成下拉菜单，icon 在 showIcon 打开时由 VbenIcon 解析渲染。
 * 层级的新旧顺序由数组下标决定，末级固定当作当前页处理。
 */
export interface IBreadcrumb {
  /** 层级图标：函数式组件、图标名称或 http 图标地址；showIcon 关闭时不渲染。 */
  icon?: Component | string;
  /** 首页标记，普通样式据此放大图标并省略其后的分隔符。 */
  isHome?: boolean;
  /** 同级其它页面，非空时该级变成下拉菜单，菜单项复用 path 抛出 select。 */
  items?: IBreadcrumb[];
  /** 该级对应的路径；留空时点击不抛事件，末级也不作为跳转入口。 */
  path?: string;
  /** 层级展示文案。 */
  title?: string;
}

/**
 * 面包屑组件入参：只有层级数据必传，其余都是可选开关。
 * styleType 只影响视图组件挑选哪种样式，组件自身不做路由跳转。
 */
export interface BreadcrumbProps {
  /** 按从根到当前页顺序排列的层级数据，下标靠后的一项即当前页。 */
  breadcrumbs: IBreadcrumb[];
  /** 是否在每级文案前渲染 icon。 */
  showIcon?: boolean;
  /** 视图样式：normal 走 shadcn 原语，background 走带折角背景的列表样式。 */
  styleType?: BreadcrumbStyleType;
}
