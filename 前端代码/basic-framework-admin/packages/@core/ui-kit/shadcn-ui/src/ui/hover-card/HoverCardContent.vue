<script setup lang="ts">
/**
 * 悬浮卡片内容层：经 Portal 挂到 body，默认与触发元素相距 4px，
 * 统一弹层层级、边框阴影以及按 data-state 方向的进出场动画，
 * class 可覆盖默认样式；开合时机与延迟由 HoverCard 根组件控制。
 */
import type { HoverCardContentProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { HoverCardContent, HoverCardPortal, useForwardProps } from 'reka-ui';

const props = withDefaults(
  defineProps<HoverCardContentProps & { class?: ClassValue }>(),
  {
    sideOffset: 4,
  },
);

/** 去掉 class 后的浮层属性，转交 HoverCardContent；sideOffset 缺省 4，传送门与开合延迟不在这里处理。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <HoverCardPortal>
    <HoverCardContent
      v-bind="forwardedProps"
      :class="
        cn(
          'z-popup data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 w-64 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none',
          props.class,
        )
      "
    >
      <slot></slot>
    </HoverCardContent>
  </HoverCardPortal>
</template>
