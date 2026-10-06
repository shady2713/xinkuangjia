<script setup lang="ts">
/**
 * 分页末页按钮：内部按钮沿用描边小尺寸，默认渲染双右箭头图标。
 * 与首页按钮分工对称，跳转和禁用判断都交给 reka-ui 根节点。
 */
import type { PaginationLastProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ChevronsRight } from 'lucide-vue-next';
import { PaginationLast } from 'reka-ui';

import { Button } from '../button';

const props = withDefaults(
  defineProps<PaginationLastProps & { class?: ClassValue }>(),
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
  <PaginationLast v-bind="delegatedProps">
    <Button :class="cn('size-8 p-0', props.class)" variant="outline">
      <slot>
        <ChevronsRight class="size-4" />
      </slot>
    </Button>
  </PaginationLast>
</template>
