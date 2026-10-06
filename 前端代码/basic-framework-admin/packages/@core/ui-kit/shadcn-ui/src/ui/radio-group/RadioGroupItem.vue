<script setup lang="ts">
/**
 * 单选选项：渲染圆形指示器并透传选中、禁用与焦点样式。
 * 需置于 RadioGroup 内才有互斥选中，选项文案由使用方提供。
 */
import type { RadioGroupItemProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { Circle } from 'lucide-vue-next';
import { RadioGroupIndicator, RadioGroupItem, useForwardProps } from 'reka-ui';

const props = defineProps<RadioGroupItemProps & { class?: ClassValue }>();

/** 去掉 class 后的选项属性，转交 RadioGroupItem；圆点指示器由模板内的 RadioGroupIndicator 渲染。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <RadioGroupItem
    v-bind="forwardedProps"
    :class="
      cn(
        'aspect-square h-4 w-4 rounded-full border border-primary text-primary shadow focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )
    "
  >
    <RadioGroupIndicator class="flex items-center justify-center">
      <Circle class="h-2.5 w-2.5 fill-current text-current" />
    </RadioGroupIndicator>
  </RadioGroupItem>
</template>
