<script setup lang="ts">
/**
 * 提示浮层内容：经 TooltipPortal 挂到浮层容器，
 * 默认出现在触发件右侧 5px 处，带边框、阴影与进出场动画。
 * 显示时机由根节点状态与 Provider 的延迟决定，此处只管外观。
 */
import type { TooltipContentEmits, TooltipContentProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { TooltipContent, TooltipPortal, useForwardPropsEmits } from 'reka-ui';

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<TooltipContentProps & { class?: ClassValue }>(),
  {
    class: '',
    side: 'right',
    sideOffset: 5,
  },
);

const emits = defineEmits<TooltipContentEmits>();

/** 去掉 class 后的提示浮层属性，连同 emits 转发给 TooltipContent；side 与 sideOffset 缺省值已固定，$attrs 在模板里另行合并。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      v-bind="{ ...forwarded, ...$attrs }"
      :class="
        cn(
          'z-popup shadow-float animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 overflow-hidden rounded-sm border border-border bg-accent px-4 py-2 text-xs text-accent-foreground',
          props.class,
        )
      "
    >
      <slot></slot>
    </TooltipContent>
  </TooltipPortal>
</template>
