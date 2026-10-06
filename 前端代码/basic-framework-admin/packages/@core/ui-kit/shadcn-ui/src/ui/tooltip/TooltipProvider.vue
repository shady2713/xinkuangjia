<script setup lang="ts">
/**
 * 提示延迟提供者：包住一组提示，统一交付延迟与跳过延迟时长，
 * 避免指针在相邻提示间移动时逐个重新等待。
 * 只提供上下文，不渲染可见元素，也不控制单个提示的开关。
 */
import type { TooltipProviderProps } from 'reka-ui';

import { TooltipProvider } from 'reka-ui';

const props = defineProps<TooltipProviderProps>();
</script>

<template>
  <TooltipProvider v-bind="props">
    <slot></slot>
  </TooltipProvider>
</template>
