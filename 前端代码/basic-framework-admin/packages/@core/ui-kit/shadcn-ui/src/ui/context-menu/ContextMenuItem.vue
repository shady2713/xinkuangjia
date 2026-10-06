<script setup lang="ts">
/**
 * 右键菜单普通条目：承载单个可点击动作，inset 为真时左侧让出图标位。
 * 只负责条目样式与事件透传，勾选、单选与二级菜单由对应条目组件承担。
 */
import type { ContextMenuItemEmits, ContextMenuItemProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ContextMenuItem, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<
  ContextMenuItemProps & { class?: ClassValue; inset?: boolean }
>();
const emits = defineEmits<ContextMenuItemEmits>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <ContextMenuItem
    v-bind="forwarded"
    :class="
      cn(
        'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        inset && 'pl-8',
        props.class,
      )
    "
  >
    <slot></slot>
  </ContextMenuItem>
</template>
