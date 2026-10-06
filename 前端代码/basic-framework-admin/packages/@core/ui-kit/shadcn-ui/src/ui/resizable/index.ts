/**
 * 可调整面板出口：暴露 ResizablePanelGroup 面板组、
 * ResizableHandle 拖拽条，并转出 reka-ui 的面板部件。
 * 第三项导出为 reka-ui 面板部件改名的 ResizablePanel。
 */
export { default as ResizableHandle } from './ResizableHandle.vue';
export { default as ResizablePanelGroup } from './ResizablePanelGroup.vue';
export { SplitterPanel as ResizablePanel } from 'reka-ui';
