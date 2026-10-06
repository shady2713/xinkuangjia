/**
 * 分栏页面模块出口：对外暴露 ColPage 组件，并再导出其 ColPageProps 类型。
 * 由 common-ui 组件桶统一再导出，业务侧无需引用子路径。
 */
export { default as ColPage } from './col-page.vue';
export * from './types';
