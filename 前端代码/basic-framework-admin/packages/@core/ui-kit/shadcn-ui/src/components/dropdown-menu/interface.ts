import type { Component } from 'vue';

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

interface DropdownMenuProps {
  menus: VbenDropdownMenuItem[];
}

export type { DropdownMenuProps, VbenDropdownMenuItem };
