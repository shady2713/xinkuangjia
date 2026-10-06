/**
 * tabs-ui 包入口：对外只提供 TabsView 与工具区按钮组件。
 * Tabs、TabsChrome 属内部渲染实现，不经此处暴露；
 * IContextMenuItem 由 shadcn-ui 转出，供使用方引用。
 */
export * from './components/widgets';
export { default as TabsView } from './tabs-view.vue';
export type { IContextMenuItem } from '@vben-core/shadcn-ui';
