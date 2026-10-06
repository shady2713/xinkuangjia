<script setup lang="ts">
/**
 * 提示根节点：维护提示开关状态，把双向绑定与更新事件透传给 reka-ui 的 TooltipRoot。
 * 不生成任何 DOM，触发件与浮层内容由引用方自行组合。
 */
import type { TooltipRootEmits, TooltipRootProps } from 'reka-ui';

import { TooltipRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<TooltipRootProps>();
const emits = defineEmits<TooltipRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <TooltipRoot v-bind="forwarded">
    <slot></slot>
  </TooltipRoot>
</template>
