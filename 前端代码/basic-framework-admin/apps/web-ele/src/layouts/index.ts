/**
 * 布局出口：懒加载提供 BasicLayout、AuthPageLayout 与 IFrameView，
 * 供路由的 layoutMap 按后端菜单里的组件名引用同一份实现。
 */
const BasicLayout = () => import('./basic.vue');
const AuthPageLayout = () => import('./auth.vue');

const IFrameView = () => import('@vben/layouts').then((m) => m.IFrameView);

export { AuthPageLayout, BasicLayout, IFrameView };
