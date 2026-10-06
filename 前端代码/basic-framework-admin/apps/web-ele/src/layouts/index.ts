/**
 * 布局出口：懒加载提供 BasicLayout、AuthPageLayout 与 IFrameView，
 * 供路由的 layoutMap 按后端菜单里的组件名引用同一份实现。
 */
const BasicLayout = () => import('./basic.vue');
/** 认证页面布局的懒加载函数，对应 auth.vue。 */
const AuthPageLayout = () => import('./auth.vue');

/** 内嵌外部页面视图的懒加载函数，对应 @vben/layouts 的 IFrameView。 */
const IFrameView = () => import('@vben/layouts').then((m) => m.IFrameView);

export { AuthPageLayout, BasicLayout, IFrameView };
