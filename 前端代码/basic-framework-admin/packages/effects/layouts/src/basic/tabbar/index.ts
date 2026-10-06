/**
 * 标签页模块出口：暴露 LayoutTabbar 与 useTabbar。
 * 标签的增删、固定、禁用态与右键菜单均在 use-tabbar 中实现，
 * 本文件只做聚合，应用层从这里导入即可。
 */
export { default as LayoutTabbar } from './tabbar.vue';
export * from './use-tabbar';
