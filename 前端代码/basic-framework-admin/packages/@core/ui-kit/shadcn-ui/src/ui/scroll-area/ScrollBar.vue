<script setup lang="ts">
/**
 * 滚动条部件：按 orientation 渲染纵向或横向轨道与滑块。
 * 由 ScrollArea 内部挂载，使用方通常无需单独引用。
 */
import type { ScrollAreaScrollbarProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ScrollAreaScrollbar, ScrollAreaThumb } from 'reka-ui';

const props = withDefaults(
  defineProps<ScrollAreaScrollbarProps & { class?: ClassValue }>(),
  {
    orientation: 'vertical',
  },
);

/** 去掉 class 后的轨道属性，转交 ScrollAreaScrollbar；orientation 缺省为纵向，滑块外观由内部 ScrollAreaThumb 固定。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <ScrollAreaScrollbar
    v-bind="delegatedProps"
    :class="
      cn(
        'flex touch-none select-none transition-colors',
        orientation === 'vertical' &&
          'h-full w-2.5 border-l border-l-transparent p-px',
        orientation === 'horizontal' &&
          'h-2.5 flex-col border-t border-t-transparent p-px',
        props.class,
      )
    "
  >
    <ScrollAreaThumb class="relative flex-1 rounded-full bg-border" />
  </ScrollAreaScrollbar>
</template>
