<script setup lang="ts">
/**
 * 提示触发件：把包裹的元素登记为提示锚点，悬停与聚焦由 reka-ui 接管。
 * 开启 as-child 时把行为合并到子元素上，本身不产生额外 DOM。
 */
import type { TooltipTriggerProps } from 'reka-ui';

import { TooltipTrigger } from 'reka-ui';

const props = defineProps<TooltipTriggerProps>();
</script>

<template>
  <TooltipTrigger v-bind="props">
    <slot></slot>
  </TooltipTrigger>
</template>
