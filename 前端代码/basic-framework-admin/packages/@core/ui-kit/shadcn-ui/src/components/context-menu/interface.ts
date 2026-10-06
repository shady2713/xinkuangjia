/**
 * 右键菜单的对外类型契约：IContextMenuItem 约束菜单项结构，
 * ContextMenuHandlerData 是宿主实体在菜单回调中的透传别名，按 object 暴露。
 */
import type { Component } from 'vue';

/**
 * 右键菜单宿主传入的数据包。
 * 标签页等使用方传入自己的实体（如 TabDefinition），菜单构建函数与点击回调都只做透传，
 * 组件本身不解释其结构，因此按 object 暴露；使用方在回调内部自行收窄。
 */
export type ContextMenuHandlerData = object;

interface IContextMenuItem {
  /**
   * 是否禁用
   */
  disabled?: boolean;
  /**
   * 点击事件处理
   * @param data 宿主传入的数据包，即触发菜单时所在实体的快照
   */
  handler?(data: ContextMenuHandlerData): void;
  /**
   * @zh_CN 是否隐藏
   */
  hidden?: boolean;
  /**
   * @zh_CN 图标
   */
  icon?: Component;
  /**
   * @zh_CN 是否显示图标
   */
  inset?: boolean;
  /**
   * @zh_CN 唯一标识
   */
  key: string;
  /**
   * @zh_CN 是否是分割线
   */
  separator?: boolean;
  /**
   * @zh_CN 快捷键
   */
  shortcut?: string;
  /**
   * @zh_CN 标题
   */
  text: string;
}
export type { IContextMenuItem };
