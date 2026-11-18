import { defineAsyncComponent } from 'vue';

export { setupVbenVxeTable } from './init';
export { default as VbenVxeTableToolbar } from './table-toolbar.vue';
export type { VxeTableGridOptions } from './types';
export * from './use-vxe-grid';
export { default as VbenVxeGrid } from './use-vxe-grid.vue';
export { useTableToolbar } from './use-vxe-toolbar';
export * from './validation';

export type {
  VxeGridListeners,
  VxeGridProps,
  VxeGridPropTypes,
  VxeTableInstance,
} from 'vxe-table';

/**
 * 按需异步加载 VxeTable 主表格组件。
 *
 * @returns VxeTable 组件定义
 */
function loadVxeTable() {
  return import('vxe-table/es/vxe-table/index.js').then((mod) => mod.VxeTable);
}

/**
 * 按需异步加载 VxeColumn 表格列组件。
 *
 * @returns VxeColumn 组件定义
 */
function loadVxeColumn() {
  return import('vxe-table/es/vxe-column/index.js').then(
    (mod) => mod.VxeColumn,
  );
}

/**
 * 按需异步加载 VxeToolbar 工具栏组件。
 *
 * @returns VxeToolbar 组件定义
 */
function loadVxeToolbar() {
  return import('vxe-table/es/vxe-toolbar/index.js').then(
    (mod) => mod.VxeToolbar,
  );
}

/** 异步导出 vxe-table 表格组件。 */
export const AsyncVxeTable = defineAsyncComponent(loadVxeTable);
/** 异步导出 vxe-table 列组件。 */
export const AsyncVxeColumn = defineAsyncComponent(loadVxeColumn);
/** 异步导出 vxe-table 工具栏组件。 */
export const AsyncVxeToolbar = defineAsyncComponent(loadVxeToolbar);
