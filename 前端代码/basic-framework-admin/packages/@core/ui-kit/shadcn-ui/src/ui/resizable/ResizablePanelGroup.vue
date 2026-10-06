<script setup lang="ts">
/**
 * 可调整面板组：按 direction 决定面板横向或纵向排列。
 * 只负责布局与朝向类名，拖拽条需由使用方显式作为子节点放入。
 */
import type { SplitterGroupEmits, SplitterGroupProps } from 'reka-ui';

import type { HTMLAttributes } from 'vue';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { SplitterGroup, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<
  SplitterGroupProps & { class?: HTMLAttributes['class'] }
>();
const emits = defineEmits<SplitterGroupEmits>();

/** 去掉 class 后的面板组属性，连同 emits 转发给 SplitterGroup；面板尺寸由组内各面板与拖拽条协商。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;
  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <SplitterGroup
    v-bind="forwarded"
    :class="
      cn(
        'flex h-full w-full data-[panel-group-direction=vertical]:flex-col',
        props.class,
      )
    "
  >
    <slot></slot>
  </SplitterGroup>
</template>
