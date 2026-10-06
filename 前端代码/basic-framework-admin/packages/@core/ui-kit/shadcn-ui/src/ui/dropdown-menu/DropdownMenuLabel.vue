<script setup lang="ts">
/**
 * 菜单分组标题：渲染不可聚焦的分组名称，并作为分组 aria-labelledby 的来源。
 * inset 让文字与带图标的菜单项对齐，点击不触发选择。
 */
import type { DropdownMenuLabelProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { DropdownMenuLabel, useForwardProps } from 'reka-ui';

const props = defineProps<
  DropdownMenuLabelProps & { class?: ClassValue; inset?: boolean }
>();

/** 去掉 class 后的分组标题属性，转交 DropdownMenuLabel，使其成为分组的 aria-labelledby 来源且不可聚焦。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <DropdownMenuLabel
    v-bind="forwardedProps"
    :class="
      cn('px-2 py-1.5 text-sm font-semibold', inset && 'pl-8', props.class)
    "
  >
    <slot></slot>
  </DropdownMenuLabel>
</template>
