/**
 * 标签栏实现桶文件：暴露 Chrome 风格与普通风格两种标签栏。
 * 共用同一属性契约，由 TabsView 按 styleType 二选一渲染。
 * 本文件只做转发，不承担标签数据获取与选中态管理。
 */
export { default as TabsChrome } from './tabs-chrome/tabs.vue';
export { default as Tabs } from './tabs/tabs.vue';
