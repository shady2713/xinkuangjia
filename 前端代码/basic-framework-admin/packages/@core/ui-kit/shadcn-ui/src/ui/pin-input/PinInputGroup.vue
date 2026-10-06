<script setup lang="ts">
/**
 * 验证码分组容器：以 Primitive 横向排列单格输入并透传属性。
 * 仅负责排列，输入值与焦点流转由 reka-ui 根节点统一编排。
 */
import type { PrimitiveProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { Primitive, useForwardProps } from 'reka-ui';

const props = defineProps<PrimitiveProps & { class?: ClassValue }>();
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;
  return delegated;
});
const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <Primitive
    v-bind="forwardedProps"
    :class="cn('flex items-center', props.class)"
  >
    <slot></slot>
  </Primitive>
</template>
