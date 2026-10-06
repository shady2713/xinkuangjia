<script setup lang="ts">
/**
 * 切换组选项：组内单个可切换按钮，未显式传 size、variant 时
 * 回退到组容器通过 inject 下发的上下文，保证组内外观一致。
 * 选中态样式由 reka-ui 输出，本组件只决定变体来源与属性转发。
 */
import type { VariantProps } from 'class-variance-authority';
import type { ToggleGroupItemProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed, inject } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ToggleGroupItem, useForwardProps } from 'reka-ui';

import { toggleVariants } from '../toggle';

type ToggleGroupVariants = VariantProps<typeof toggleVariants>;

const props = defineProps<
  ToggleGroupItemProps & {
    class?: ClassValue;
    size?: ToggleGroupVariants['size'];
    variant?: ToggleGroupVariants['variant'];
  }
>();

const context = inject<ToggleGroupVariants>('toggleGroup');

const delegatedProps = computed(() => {
  const { class: _, size: _size, variant: _variant, ...delegated } = props;
  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <ToggleGroupItem
    v-bind="forwardedProps"
    :class="
      cn(
        toggleVariants({
          variant: context?.variant || variant,
          size: context?.size || size,
        }),
        props.class,
      )
    "
  >
    <slot></slot>
  </ToggleGroupItem>
</template>
