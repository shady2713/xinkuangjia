<script setup lang="ts">
/**
 * 二级子菜单触发器：指针移入或点击时展开子面板，右侧固定显示展开箭头。
 * 子面板内容与显隐状态由 DropdownMenuSub、DropdownMenuSubContent 负责。
 */
import type { DropdownMenuSubTriggerProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ChevronRight } from 'lucide-vue-next';
import { DropdownMenuSubTrigger, useForwardProps } from 'reka-ui';

const props = defineProps<
  DropdownMenuSubTriggerProps & { class?: ClassValue }
>();

/** 去掉 class 后的子菜单触发器属性，转交 DropdownMenuSubTrigger；展开时机由 reka-ui 的指针与键盘逻辑决定。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <DropdownMenuSubTrigger
    v-bind="forwardedProps"
    :class="
      cn(
        'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent',
        props.class,
      )
    "
  >
    <slot></slot>
    <ChevronRight class="ml-auto h-4 w-4" />
  </DropdownMenuSubTrigger>
</template>
