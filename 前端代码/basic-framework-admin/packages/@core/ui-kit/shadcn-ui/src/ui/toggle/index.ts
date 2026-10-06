/**
 * 切换按钮出口：导出单个 Toggle 组件，
 * 并把 toggle.ts 里的 toggleVariants 与 ToggleVariants 类型一并转发。
 * 需要成组互斥时改用同级 toggle-group 出口。
 */
export * from './toggle';
export { default as Toggle } from './Toggle.vue';
