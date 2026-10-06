<script setup lang="ts">
/**
 * 分页首页按钮：以 asChild 把跳转语义挂到内部描边小按钮上。
 * 默认渲染双左箭头，目标页码由 reka-ui 根节点计算，本件不读当前页。
 */
import type { PaginationFirstProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ChevronsLeft } from 'lucide-vue-next';
import { PaginationFirst } from 'reka-ui';

import { Button } from '../button';

const props = withDefaults(
  defineProps<PaginationFirstProps & { class?: ClassValue }>(),
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
  <PaginationFirst v-bind="delegatedProps">
    <Button :class="cn('size-8 p-0', props.class)" variant="outline">
      <slot>
        <ChevronsLeft class="size-4" />
      </slot>
    </Button>
  </PaginationFirst>
</template>
