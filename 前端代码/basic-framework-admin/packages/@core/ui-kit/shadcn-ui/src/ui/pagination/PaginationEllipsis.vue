<script setup lang="ts">
/**
 * 分页省略号：占位被折叠的页码区间，默认渲染横向省略图标。
 * 只做展示不参与跳转，页码与禁用态仍由 reka-ui 分页根节点驱动。
 */
import type { PaginationEllipsisProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { MoreHorizontal } from 'lucide-vue-next';
import { PaginationEllipsis } from 'reka-ui';

const props = defineProps<PaginationEllipsisProps & { class?: ClassValue }>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <PaginationEllipsis
    v-bind="delegatedProps"
    :class="cn('flex size-8 items-center justify-center', props.class)"
  >
    <slot>
      <MoreHorizontal class="size-4" />
    </slot>
  </PaginationEllipsis>
</template>
