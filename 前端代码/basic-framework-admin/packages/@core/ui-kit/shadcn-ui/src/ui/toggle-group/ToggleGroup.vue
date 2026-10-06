<script setup lang="ts">
/**
 * 切换组容器：把一组选项组织成单选或多选集合，
 * 并通过 provide 把 size、variant 下发给组内选项做统一样式。
 * 选中值与键盘导航由 reka-ui 的 ToggleGroupRoot 承担，不渲染业务内容。
 */
import type { VariantProps } from 'class-variance-authority';
import type { ToggleGroupRootEmits, ToggleGroupRootProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import type { toggleVariants } from '../toggle';

import { computed, provide } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ToggleGroupRoot, useForwardPropsEmits } from 'reka-ui';

type ToggleGroupVariants = VariantProps<typeof toggleVariants>;

const props = defineProps<
  ToggleGroupRootProps & {
    class?: ClassValue;
    size?: ToggleGroupVariants['size'];
    variant?: ToggleGroupVariants['variant'];
  }
>();
const emits = defineEmits<ToggleGroupRootEmits>();

provide('toggleGroup', {
  size: props.size,
  variant: props.variant,
});

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;
  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <ToggleGroupRoot
    v-bind="forwarded"
    :class="cn('flex items-center justify-center gap-1', props.class)"
  >
    <slot></slot>
  </ToggleGroupRoot>
</template>
