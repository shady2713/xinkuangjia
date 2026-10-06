/**
 * 图表能力出口：聚合 ECOption 类型、EchartsUI 容器组件与 useEcharts、EchartsUIType。
 * echarts 实例及按需注册细节保留在 echarts.ts，业务侧统一经 useEcharts 使用。
 */
export * from './echarts';
export { default as EchartsUI } from './echarts-ui.vue';
export * from './use-echarts';
