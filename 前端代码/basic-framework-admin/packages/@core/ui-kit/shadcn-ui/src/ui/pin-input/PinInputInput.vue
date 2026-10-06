<script setup lang="ts">
/**
 * 验证码单格输入：带边框与首尾圆角，聚焦时抬升层级显示描边。
 * 输入值与焦点顺序由 reka-ui 根节点编排，本件只提供格子外观。
 */
import type { PinInputInputProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { PinInputInput, useForwardProps } from 'reka-ui';

const props = defineProps<PinInputInputProps & { class?: ClassValue }>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;
  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <PinInputInput
    v-bind="forwardedProps"
    :class="
      cn(
        'relative flex h-10 w-8 items-center justify-center border-y border-r border-input bg-background text-center text-sm transition-all first:rounded-l-md first:border-l last:rounded-r-md focus:relative focus:z-10 focus:outline-none focus:ring-2 md:w-10',
        props.class,
      )
    "
  />
</template>
