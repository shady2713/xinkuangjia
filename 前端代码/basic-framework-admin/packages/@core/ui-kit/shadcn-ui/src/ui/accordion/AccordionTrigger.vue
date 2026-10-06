<script setup lang="ts">
/**
 * 手风琴标题按钮：整行可点，展开时右侧箭头旋转 180 度标示当前分组。
 *
 * 默认箭头可用 icon 插槽替换，标题文字走默认插槽；展开状态与键盘交互
 * 由根节点和 reka-ui 维护，本组件自身不保存状态。
 */
import type { AccordionTriggerProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ChevronDown } from 'lucide-vue-next';
import { AccordionHeader, AccordionTrigger } from 'reka-ui';

const props = defineProps<AccordionTriggerProps & { class?: ClassValue }>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <AccordionHeader class="flex">
    <AccordionTrigger
      v-bind="delegatedProps"
      :class="
        cn(
          'flex flex-1 items-center justify-between py-4 text-sm font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180',
          props.class,
        )
      "
    >
      <slot></slot>
      <slot name="icon">
        <ChevronDown
          class="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200"
        />
      </slot>
    </AccordionTrigger>
  </AccordionHeader>
</template>
