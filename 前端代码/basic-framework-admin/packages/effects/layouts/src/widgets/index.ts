/**
 * 布局挂件总出口：把头部、侧边栏与认证页共用的交互挂件收拢成一层。
 * 具名导出 Breadcrumb、LanguageToggle、AuthenticationLayoutToggle、
 * AuthenticationColorToggle 四个组件，其余能力按 check-updates、
 * global-search、help、lock-screen、notification、preferences、
 * theme-toggle、timezone、user-dropdown 子模块整体转出。
 * 消费方只依赖本出口，不需要了解挂件的内部目录结构。
 */
export { default as Breadcrumb } from './breadcrumb.vue';
export * from './check-updates';
export { default as AuthenticationColorToggle } from './color-toggle.vue';
export * from './global-search';
export * from './help';
export { default as LanguageToggle } from './language-toggle.vue';
export { default as AuthenticationLayoutToggle } from './layout-toggle.vue';
export * from './lock-screen';
export * from './notification';
export * from './preferences';
export * from './theme-toggle';
export * from './timezone';
export * from './user-dropdown';
