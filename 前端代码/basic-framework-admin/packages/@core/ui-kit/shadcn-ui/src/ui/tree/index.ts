/**
 * 树出口：暴露基于 reka-ui 的 VbenTree 组件、TreeProps 与 FlattenedItem 类型，
 * 以及集中声明缺省值的 treePropsDefaults 工厂。
 * 空数据占位、业务图标等表现由上层 common-ui 的 tree 组件补齐。
 */
export { default as VbenTree } from './tree.vue';
export type { TreeProps } from './types';
export { treePropsDefaults } from './types';
export type { FlattenedItem } from 'reka-ui';
