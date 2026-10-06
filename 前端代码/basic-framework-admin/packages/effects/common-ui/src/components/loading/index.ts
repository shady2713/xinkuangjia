/**
 * 加载能力出口：导出 registerLoadingDirective 与
 * Loading、Spinner 组件。
 * 指令本体在同目录 directive.ts，本文件只做转发。
 */
export * from './directive';
export { default as Loading } from './loading.vue';
export { default as Spinner } from './spinner.vue';
