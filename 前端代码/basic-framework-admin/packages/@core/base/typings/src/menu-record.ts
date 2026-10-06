/**
 * 菜单与路由记录类型：声明服务端权限菜单与前端菜单条目的形状。
 * MenuRecordRaw 是前端消费的菜单结构，含徽标（角标）字段。
 * ExRouteRecordRaw 给 vue-router 记录补父级链。
 * 服务端原始菜单由 AppRouteRecordRaw 承载，转换由使用方完成。
 */
import type { Component } from 'vue';
import type { RouteRecordRaw } from 'vue-router';

/** 服务端权限菜单；尚未解析为 Vue 组件或前端菜单，不能与路由记录混用。 */
interface AppRouteRecordRaw {
  children?: AppRouteRecordRaw[];
  /** 页面组件标识；服务端菜单可能返回 null，消费方按空组件处理。 */
  component?: null | string;
  componentName?: string;
  icon?: string;
  id: number;
  keepAlive: boolean;
  name: string;
  parentId: number;
  path: string;
  sort?: number;
  visible: boolean;
}

/**
 * 扩展路由原始对象
 */
type ExRouteRecordRaw = RouteRecordRaw & {
  parent?: string;
  parents?: string[];
};

/**
 * 菜单徽标字段：`badge` 决定角标文本，`badgeType` 决定是圆点还是文本，`badgeVariants` 决定配色。
 */
interface MenuRecordBadgeRaw {
  /**
   * 徽标
   */
  badge?: string;
  /**
   * 徽标类型
   */
  badgeType?: 'dot' | 'normal';
  /**
   * 徽标颜色
   */
  badgeVariants?: 'destructive' | 'primary' | string;
}

/**
 * 菜单原始对象
 */
interface MenuRecordRaw extends MenuRecordBadgeRaw {
  /**
   * 激活时的图标名
   */
  activeIcon?: string;
  /**
   * 子菜单
   */
  children?: MenuRecordRaw[];
  /**
   * 是否禁用菜单
   * @default false
   */
  disabled?: boolean;
  /**
   * 图标名
   */
  icon?: Component | string;
  /**
   * 菜单名
   */
  name: string;
  /**
   * 排序号
   */
  order?: number;
  /**
   * 父级路径
   */
  parent?: string;
  /**
   * 所有父级路径
   */
  parents?: string[];
  /**
   * 菜单路径，唯一，可当作key
   */
  path: string;
  /**
   * 是否显示菜单
   * @default true
   */
  show?: boolean;
}

export type {
  AppRouteRecordRaw,
  ExRouteRecordRaw,
  MenuRecordBadgeRaw,
  MenuRecordRaw,
};
