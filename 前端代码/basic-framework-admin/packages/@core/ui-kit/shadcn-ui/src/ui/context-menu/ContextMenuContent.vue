<script setup lang="ts">
/**
 * 右键菜单内容面板：包一层传送门后渲染 reka-ui 内容容器与进出场动画。
 * 只负责层级、圆角与位移动画，菜单项排布和点击行为由子项各自承担。
 */
import type { ContextMenuContentEmits, ContextMenuContentProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import {
  ContextMenuContent,
  ContextMenuPortal,
  useForwardPropsEmits,
} from 'reka-ui';

const props = defineProps<ContextMenuContentProps & { class?: ClassValue }>();
const emits = defineEmits<ContextMenuContentEmits>();

/** 去掉 class 后的浮层属性，转交 ContextMenuContent；传送门与贴边翻转策略沿用 reka-ui 默认值。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <ContextMenuPortal>
    <ContextMenuContent
      v-bind="forwarded"
      :class="
        cn(
          'z-popup data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 min-w-32 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
          props.class,
        )
      "
    >
      <slot></slot>
    </ContextMenuContent>
  </ContextMenuPortal>
</template>
