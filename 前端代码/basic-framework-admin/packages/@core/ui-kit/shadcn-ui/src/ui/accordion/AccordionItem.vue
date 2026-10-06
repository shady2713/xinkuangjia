<script setup lang="ts">
/**
 * 手风琴分组项：给一个分组套上下边框，并转发 reka-ui 的项级 props。
 *
 * 只提供容器与分隔线，展开状态由根节点统一管理，标题和内容作为子节点传入。
 */
import type { AccordionItemProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { AccordionItem, useForwardProps } from 'reka-ui';

const props = defineProps<AccordionItemProps & { class?: ClassValue }>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <AccordionItem v-bind="forwardedProps" :class="cn('border-b', props.class)">
    <slot></slot>
  </AccordionItem>
</template>
