<script setup lang="ts">
/**
 * 分页上一页按钮：默认渲染左箭头图标，点击后回退一页。
 * 首屏禁用等边界状态来自 reka-ui 根节点上下文，本件不自行判断。
 */
import type { PaginationPrevProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ChevronLeft } from 'lucide-vue-next';
import { PaginationPrev } from 'reka-ui';

import { Button } from '../button';

const props = withDefaults(
  defineProps<PaginationPrevProps & { class?: ClassValue }>(),
  {
    asChild: true,
  },
);

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <PaginationPrev v-bind="delegatedProps">
    <Button :class="cn('size-8 p-0', props.class)" variant="outline">
      <slot>
        <ChevronLeft class="size-4" />
      </slot>
    </Button>
  </PaginationPrev>
</template>
