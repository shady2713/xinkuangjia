/**
 * 下拉菜单的对外类型契约：VbenDropdownMenuItem 定义条目的值、标题、图标、
 * 分割线与点击处理，DropdownMenuProps 只约定 menus 列表，两个菜单组件共用。
 */
import type { Component } from 'vue';

/**
 * 单条下拉菜单条目的结构。
 * value 必填且需在菜单内唯一，既作渲染 key，也是单选菜单的 v-model 取值；
 * separator 为真时该条目只渲染成一条分割线；
 * handler 缺省时点击不产生任何效果，组件不会代替使用方兜底。
 */
interface VbenDropdownMenuItem {
  disabled?: boolean;
  /**
   * 点击事件处理
   * @param data 使用方在菜单项上挂载的业务数据，组件只做透传，形状由使用方决定
   */
  handler?(data: object): void;
  /**
   * @zh_CN 图标
   */
  icon?: Component;
  /**
   * @zh_CN 标题
   */
  label: string;
  /**
   * @zh_CN 是否是分割线
   */
  separator?: boolean;
  /**
   * @zh_CN 唯一标识
   */
  value: string;
}

/**
 * 下拉菜单的属性契约，只要求使用方给出条目列表。
 * 普通下拉菜单靠条目上的 handler 执行动作，单选菜单则读条目的 value 作为 v-model 取值。
 */
interface DropdownMenuProps {
  menus: VbenDropdownMenuItem[];
}

export type { DropdownMenuProps, VbenDropdownMenuItem };
