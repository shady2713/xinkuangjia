/**
 * 内嵌页面模块出口：聚合 iframe 路由的承载组件。
 * IFrameRouterView 按标签页渲染 iframe，是真正的渲染方；
 * IFrameView 只是无内容的占位布局，供布局映射表登记。
 */
export { default as IFrameRouterView } from './iframe-router-view.vue';
export { default as IFrameView } from './iframe-view.vue';
