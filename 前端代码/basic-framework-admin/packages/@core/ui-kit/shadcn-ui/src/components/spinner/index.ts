/**
 * 加载态出口：聚合 VbenLoading 遮罩与 VbenSpinner 方块动画两个组件。
 * 前者带文案与图标插槽，后者只有动画；弹层和 v-loading 指令都从这里取。
 */
export { default as VbenLoading } from './loading.vue';
export { default as VbenSpinner } from './spinner.vue';
