<script setup lang="ts">
/**
 * 手风琴内容面板：展开收起时播放下滑动效，并裁掉溢出的内容。
 *
 * 只负责动效、内边距与 class 透传，面板里渲染什么、如何校验由使用方决定。
 */
import type { AccordionContentProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { AccordionContent } from 'reka-ui';

const props = defineProps<AccordionContentProps & { class?: ClassValue }>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <AccordionContent
    v-bind="delegatedProps"
    class="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden text-sm"
  >
    <div :class="cn('pb-4 pt-0', props.class)">
      <slot></slot>
    </div>
  </AccordionContent>
</template>
