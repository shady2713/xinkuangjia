/**
 * modal 子模块出口：导出 VbenModal 组件、
 * useVbenModal 与 setDefaultModalProps，
 * 并整体转发 modal.ts 的类型定义。
 */
export type * from './modal';
export { default as VbenModal } from './modal.vue';
export { setDefaultModalProps, useVbenModal } from './use-modal';
