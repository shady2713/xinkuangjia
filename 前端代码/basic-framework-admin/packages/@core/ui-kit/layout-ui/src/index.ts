/**
 * 布局外壳入口：对外暴露 VbenAdminLayout 组件及其属性类型。
 *
 * 区域组件、侧边栏按钮等实现细节不经此出口，使用方只依赖这一个入口。
 */
export type * from './admin-layout';
export { default as VbenAdminLayout } from './admin-layout.vue';
