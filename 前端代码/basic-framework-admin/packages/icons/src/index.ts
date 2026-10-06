/**
 * 图标包出口：合并 iconify 在线图标集、本地 svg 图标集与空状态组件 EmptyIcon，
 * 业务统一从 @vben/icons 引入即可，不必区分图标来源。
 */
export * from './iconify';
export { default as EmptyIcon } from './icons/empty-icon.vue';
export * from './svg';
