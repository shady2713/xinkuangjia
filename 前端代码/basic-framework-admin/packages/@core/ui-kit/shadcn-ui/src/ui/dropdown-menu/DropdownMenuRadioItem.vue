<script setup lang="ts">
/**
 * 单选菜单项：点击后请求把所在组的选中值切换为自己，选中时显示圆点图标。
 * 选中值由 DropdownMenuRadioGroup 统一持有，本组件只渲染与抛事件。
 */
import type {
  DropdownMenuRadioItemEmits,
  DropdownMenuRadioItemProps,
} from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { Circle } from 'lucide-vue-next';
import {
  DropdownMenuItemIndicator,
  DropdownMenuRadioItem,
  useForwardPropsEmits,
} from 'reka-ui';

const props = defineProps<
  DropdownMenuRadioItemProps & { class?: ClassValue }
>();

const emits = defineEmits<DropdownMenuRadioItemEmits>();

/** 剔除 class 后的单选菜单项属性，连同 emits 转发给 DropdownMenuRadioItem；组内选中值由单选组上下文维护。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DropdownMenuRadioItem
    v-bind="forwarded"
    :class="
      cn(
        'relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        props.class,
      )
    "
  >
    <span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuItemIndicator>
        <Circle class="h-2 w-2 fill-current" />
      </DropdownMenuItemIndicator>
    </span>
    <slot></slot>
  </DropdownMenuRadioItem>
</template>
