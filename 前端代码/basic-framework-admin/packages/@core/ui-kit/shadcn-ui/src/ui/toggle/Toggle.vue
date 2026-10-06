<script setup lang="ts">
/**
 * 单个切换按钮：按下态由 reka-ui 的 Toggle 维护，
 * 外观取自 toggleVariants，size、variant 默认值在此补齐。
 * 组内互斥与整组样式下发不属于本组件，交给 toggle-group。
 */
import type { ToggleEmits, ToggleProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import type { ToggleVariants } from './toggle';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { Toggle, useForwardPropsEmits } from 'reka-ui';

import { toggleVariants } from './toggle';

const props = withDefaults(
  defineProps<
    ToggleProps & {
      class?: ClassValue;
      size?: ToggleVariants['size'];
      variant?: ToggleVariants['variant'];
    }
  >(),
  {
    disabled: false,
    size: 'default',
    variant: 'default',
  },
);

const emits = defineEmits<ToggleEmits>();

/** 剔除 class、size、variant 三个样式轴后，把其余属性连同 emits 转发给 Toggle；样式轴在模板里单独喂给 toggleVariants。 */
const delegatedProps = computed(() => {
  const { class: _, size: _size, variant: _variant, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <Toggle
    v-bind="forwarded"
    :class="cn(toggleVariants({ variant, size }), props.class)"
  >
    <slot></slot>
  </Toggle>
</template>
