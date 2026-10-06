/**
 * 提示出口：聚合 Tooltip 根节点、TooltipTrigger 触发件、
 * TooltipContent 浮层内容与 TooltipProvider 全局延迟容器。
 * 默认延迟、右侧方位等业务默认值由上层 components/tooltip 叠加。
 */
export { default as Tooltip } from './Tooltip.vue';
export { default as TooltipContent } from './TooltipContent.vue';
export { default as TooltipProvider } from './TooltipProvider.vue';
export { default as TooltipTrigger } from './TooltipTrigger.vue';
