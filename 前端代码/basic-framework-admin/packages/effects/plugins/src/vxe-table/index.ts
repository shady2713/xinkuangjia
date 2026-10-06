/**
 * 表格插件出口：聚合 setupVbenVxeTable 初始化、VbenVxeGrid 与
 * VbenVxeTableToolbar 组件、useVbenVxeGrid/useTableToolbar、必填校验
 * 类名生成器与 vxe 类型定义。
 * 另导出 AsyncVxeTable、AsyncVxeColumn、AsyncVxeToolbar 供绕过封装直接用原生表格。
 */
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

/** vxe-table 原生表格组件的异步版本，供绕过封装直接使用原生表格的场景按需加载。 */
// 异步导出 vxe-table 相关组件提供给需要单独使用 vxe-table 的场景
export const AsyncVxeTable = defineAsyncComponent(() =>
  import('vxe-table').then((mod) => mod.VxeTable),
);
/** vxe-table 原生列组件的异步版本，需与 AsyncVxeTable 搭配使用。 */
export const AsyncVxeColumn = defineAsyncComponent(() =>
  import('vxe-table').then((mod) => mod.VxeColumn),
);
/** vxe-table 原生工具栏组件的异步版本，需与 AsyncVxeTable 搭配使用。 */
export const AsyncVxeToolbar = defineAsyncComponent(() =>
  import('vxe-table').then((mod) => mod.VxeToolbar),
);
