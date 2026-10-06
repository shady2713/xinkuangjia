/**
 * 认证布局出口：只对外暴露 AuthPageLayout 认证外壳，
 * 表单视图、认证工具栏等内部件随目录自带，不经此聚合。
 */
export { default as AuthPageLayout } from './authentication.vue';
