<script setup lang="ts">
/**
 * 浮层内容：经传送门渲染面板，默认居中对齐并偏移 4 像素。
 * 继承属性直接落到面板，宽度与动画内置；显隐与定位由根节点和触发器控制。
 */
import type { PopoverContentEmits, PopoverContentProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { PopoverContent, PopoverPortal, useForwardPropsEmits } from 'reka-ui';

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<PopoverContentProps & { class?: ClassValue }>(),
  {
    align: 'center',
    sideOffset: 4,
  },
);
const emits = defineEmits<PopoverContentEmits>();

/** 去掉 class 后的浮层属性，连同 emits 转发给 PopoverContent；align 与 sideOffset 缺省值已在 withDefaults 中固定。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <PopoverPortal>
    <PopoverContent
      v-bind="{ ...forwarded, ...$attrs }"
      :class="
        cn(
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none',
          props.class,
        )
      "
    >
      <slot></slot>
    </PopoverContent>
  </PopoverPortal>
</template>
