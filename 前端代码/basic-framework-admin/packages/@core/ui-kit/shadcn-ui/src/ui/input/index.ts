/**
 * 输入框出口：只暴露 Input 组件，业务侧经 @vben-core/shadcn-ui 引入。
 * 表单字段所需的 id、标签关联与错误提示由 form 目录的 FormControl
 * 等组件补齐，本文件不重复实现这些能力。
 */
export { default as Input } from './Input.vue';
