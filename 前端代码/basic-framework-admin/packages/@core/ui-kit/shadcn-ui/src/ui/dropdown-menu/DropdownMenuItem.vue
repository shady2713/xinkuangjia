<script setup lang="ts">
/**
 * 普通菜单项：抛出选择事件，聚焦时高亮，inset 让文字与带图标的项左对齐。
 * 选中值、勾选与单选标记由复选、单选菜单项承担，本组件不保存状态。
 */
import type { DropdownMenuItemProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { DropdownMenuItem, useForwardProps } from 'reka-ui';

const props = defineProps<
  DropdownMenuItemProps & { class?: ClassValue; inset?: boolean }
>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <DropdownMenuItem
    v-bind="forwardedProps"
    :class="
      cn(
        'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        inset && 'pl-8',
        props.class,
      )
    "
  >
    <slot></slot>
  </DropdownMenuItem>
</template>
