<script setup lang="ts">
/**
 * 二级子菜单面板：相对子菜单触发器侧向弹出，浮层样式与一级面板保持一致。
 * 显隐和键盘导航由 DropdownMenuSub 的上下文接管，本组件只透传属性与插槽。
 */
import type {
  DropdownMenuSubContentEmits,
  DropdownMenuSubContentProps,
} from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { DropdownMenuSubContent, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<
  DropdownMenuSubContentProps & { class?: ClassValue }
>();
const emits = defineEmits<DropdownMenuSubContentEmits>();

/** 去掉 class 后的子菜单浮层属性，连同 emits 转发给 DropdownMenuSubContent；定位继承父级子菜单的弹出方向。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DropdownMenuSubContent
    v-bind="forwarded"
    :class="
      cn(
        'z-50 min-w-32 overflow-hidden rounded-md',
        'border border-border',
        'bg-popover p-1 text-popover-foreground shadow-lg',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
        'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        props.class,
      )
    "
  >
    <slot></slot>
  </DropdownMenuSubContent>
</template>
