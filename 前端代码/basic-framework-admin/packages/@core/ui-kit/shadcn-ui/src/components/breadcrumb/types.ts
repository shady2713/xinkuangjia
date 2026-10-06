/**
 * 面包屑数据契约：IBreadcrumb 描述单级标题、图标、路径
 * 与子项，BreadcrumbProps 约定组件入参。
 * 只有类型定义，样式与交互在对应组件里。
 */
import type { Component } from 'vue';

import type { BreadcrumbStyleType } from '@vben-core/typings';

export interface IBreadcrumb {
  icon?: Component | string;
  isHome?: boolean;
  items?: IBreadcrumb[];
  path?: string;
  title?: string;
}

export interface BreadcrumbProps {
  breadcrumbs: IBreadcrumb[];
  showIcon?: boolean;
  styleType?: BreadcrumbStyleType;
}
