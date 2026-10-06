<script setup lang="ts">
/**
 * 单选组容器：以网格排列选项并统一转发 v-model 与朝向等根属性。
 * 只负责分组语义，单个选项的圆点外观由 RadioGroupItem 提供。
 */
import type { RadioGroupRootEmits, RadioGroupRootProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { RadioGroupRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<RadioGroupRootProps & { class?: ClassValue }>();
const emits = defineEmits<RadioGroupRootEmits>();

/** 去掉 class 后的单选组属性，连同 emits 转发给 RadioGroupRoot；互斥选中与朝向语义由底层维护。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <RadioGroupRoot :class="cn('grid gap-2', props.class)" v-bind="forwarded">
    <slot></slot>
  </RadioGroupRoot>
</template>
