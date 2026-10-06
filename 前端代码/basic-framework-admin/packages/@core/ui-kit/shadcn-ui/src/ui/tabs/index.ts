/**
 * 页签出口：暴露根节点、列表、触发件与内容面板四个部件，
 * 并转发 reka-ui 的 TabsIndicator 滑动指示条。
 * 只做样式封装，选中状态与切换动作由 reka-ui 维护。
 */
export { default as Tabs } from './Tabs.vue';
export { default as TabsContent } from './TabsContent.vue';
export { default as TabsList } from './TabsList.vue';
export { default as TabsTrigger } from './TabsTrigger.vue';
export { TabsIndicator } from 'reka-ui';
