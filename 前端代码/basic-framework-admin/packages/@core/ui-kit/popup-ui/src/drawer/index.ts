/**
 * drawer 子模块出口：导出 VbenDrawer 组件、
 * useVbenDrawer 与 setDefaultDrawerProps，
 * 并整体转发 drawer.ts 的类型定义。
 */
export type * from './drawer';
export { default as VbenDrawer } from './drawer.vue';
export { setDefaultDrawerProps, useVbenDrawer } from './use-drawer';
