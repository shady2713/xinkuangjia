<script setup lang="ts">
/**
 * 数字输入框减号按钮：绝对定位在输入框左侧，默认渲染减号图标。
 * 步进与禁用态由 reka-ui 根节点上下文决定，本件不读写数值。
 */
import type { NumberFieldDecrementProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { Minus } from 'lucide-vue-next';
import { NumberFieldDecrement, useForwardProps } from 'reka-ui';

const props = defineProps<NumberFieldDecrementProps & { class?: ClassValue }>();

/** 去掉 class 后的减号按钮属性，转交 NumberFieldDecrement；是否触底禁用由根节点上下文判定。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardProps(delegatedProps);
</script>

<template>
  <NumberFieldDecrement
    data-slot="decrement"
    v-bind="forwarded"
    :class="
      cn(
        'absolute left-0 top-1/2 -translate-y-1/2 p-3 disabled:cursor-not-allowed disabled:opacity-20',
        props.class,
      )
    "
  >
    <slot>
      <Minus class="h-4 w-4" />
    </slot>
  </NumberFieldDecrement>
</template>
