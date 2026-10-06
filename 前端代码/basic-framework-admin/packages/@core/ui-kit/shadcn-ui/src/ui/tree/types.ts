/**
 * 树组件的数据与属性类型契约：声明节点键空间、可配置字段名及缺省值工厂。
 * 取值、子级、禁用等字段名由调用方给出，本文件不校验节点数据也不渲染树。
 */
import type { Arrayable } from '@vueuse/core';
import type { FlattenedItem } from 'reka-ui';

import type { Recordable } from '@vben-core/typings';

/**
 * 树节点数据。
 *
 * 取值字段、禁用字段与子节点字段名都由调用方配置，
 * 每个键的真实类型只能在读取处收窄，因此这里只声明键空间。
 */
export type TreeNode = Recordable<unknown>;

/**
 * 树组件的对外属性契约：仅 treeData 必填，其余字段既描述取值、标签、子级、禁用等键名，也描述多选、
 * 父子联动、清空与展开等行为开关。键名可配置意味着真实键类型要到读取处才能收窄，因此这里只用 string 描述键空间。
 */
export interface TreeProps {
  /** 单选时允许取消已有选项 */
  allowClear?: boolean;
  /** 非关联选择时，自动选中上级节点 */
  autoCheckParent?: boolean;
  /** 显示边框 */
  bordered?: boolean;
  /** 取消父子关联选择 */
  checkStrictly?: boolean;
  /** 子级字段名 */
  childrenField?: string;
  /** 默认展开的键 */
  defaultExpandedKeys?: Array<number | string>;
  /** 默认展开的级别（优先级高于defaultExpandedKeys） */
  defaultExpandedLevel?: number;
  /** 默认值 */
  defaultValue?: Arrayable<number | string>;
  /** 禁用 */
  disabled?: boolean;
  /** 禁用字段名 */
  disabledField?: string;
  /** 自定义节点类名 */
  getNodeClass?: (item: FlattenedItem<TreeNode>) => string;
  iconField?: string;
  /** label字段 */
  labelField?: string;
  /** 是否多选 */
  multiple?: boolean;
  /** 显示由iconField指定的图标 */
  showIcon?: boolean;
  /** 启用展开收缩动画 */
  transition?: boolean;
  /** 树数据 */
  treeData: TreeNode[];
  /** 值字段 */
  valueField?: string;
}

/**
 * 树属性的缺省值：集中一处，避免各调用点自行拼默认值。
 * 用函数返回而不是常量对象，是因为 `defaultExpandedKeys` 需要每次拿到独立数组，
 * 共用同一个数组会让多个树实例互相污染展开状态。
 * @returns 与 `TreeProps` 缺省项对应的全新对象。
 */
export function treePropsDefaults() {
  return {
    allowClear: false,
    autoCheckParent: true,
    bordered: false,
    checkStrictly: false,
    /** 默认展开键：每次返回独立数组，调用方可安全修改。 */
    defaultExpandedKeys: (): (number | string)[] => [],
    defaultExpandedLevel: 0,
    disabled: false,
    disabledField: 'disabled',
    iconField: 'icon',
    labelField: 'label',
    multiple: false,
    showIcon: true,
    transition: true,
    valueField: 'value',
    childrenField: 'children',
  };
}
