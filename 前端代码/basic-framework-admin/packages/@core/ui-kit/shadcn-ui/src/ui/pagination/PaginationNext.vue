<script setup lang="ts">
/**
 * 分页下一页按钮：默认渲染右箭头图标，点击后前进一页。
 * 能否前进由 reka-ui 根节点的禁用态决定，本件不缓存页码。
 */
import type { PaginationNextProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ChevronRight } from 'lucide-vue-next';
import { PaginationNext } from 'reka-ui';

import { Button } from '../button';

const props = withDefaults(
  defineProps<PaginationNextProps & { class?: ClassValue }>(),
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
  <PaginationNext v-bind="delegatedProps">
    <Button :class="cn('size-8 p-0', props.class)" variant="outline">
      <slot>
        <ChevronRight class="size-4" />
      </slot>
    </Button>
  </PaginationNext>
</template>
