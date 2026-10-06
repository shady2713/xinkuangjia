/**
 * 提示出口：同时暴露通用 VbenTooltip 与问号式 VbenHelpTooltip。
 * 前者接收任意触发元素，后者只固定问号图标与右侧弹出，两者都不做业务判断。
 */
export { default as VbenHelpTooltip } from './help-tooltip.vue';
export { default as VbenTooltip } from './tooltip.vue';
