<script setup lang="ts">
/**
 * 手风琴根节点：透传 reka-ui 的展开状态与更新事件，自身不渲染可见结构。
 *
 * 单开还是多开由 type、collapsible 等 props 决定；子项由使用方按
 * Item、Trigger、Content 顺序拼装，本组件不校验子节点结构。
 */
import type { AccordionRootEmits, AccordionRootProps } from 'reka-ui';

import { AccordionRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<AccordionRootProps>();
const emits = defineEmits<AccordionRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <AccordionRoot v-bind="forwarded">
    <slot></slot>
  </AccordionRoot>
</template>
