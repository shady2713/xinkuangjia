<script setup lang="ts">
/**
 * 数字输入框根容器：为 reka-ui 根节点补网格间距并透传属性与事件。
 * 数值状态、步进与键盘交互均由 reka-ui 提供，本件只管排版与插槽。
 */
import type { NumberFieldRootEmits, NumberFieldRootProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { NumberFieldRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<NumberFieldRootProps & { class?: ClassValue }>();
const emits = defineEmits<NumberFieldRootEmits>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <NumberFieldRoot v-bind="forwarded" :class="cn('grid gap-1.5', props.class)">
    <slot></slot>
  </NumberFieldRoot>
</template>
