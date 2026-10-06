<script setup lang="ts">
/** 纯图标按钮：在只有图标的场景下补一层气泡提示，并把点击、禁用与外观透传给基础按钮。 */
import type { ClassValue } from '@vben-core/shared/utils';

import type { ButtonVariants } from '../../ui';
import type { VbenButtonProps } from './button';

import { computed, useSlots } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { VbenTooltip } from '../tooltip';
import VbenButton from './button.vue';

/**
 * 纯图标按钮的入参：在基础按钮属性之上补充气泡提示相关的四项。
 * tooltip 与 tooltip 插槽二选一即可决定提示文案，tooltipSide、tooltipDelayDuration
 * 只影响提示的方位与延迟；onClick 允许使用方把点击处理作为属性直接传入。
 */
interface Props extends VbenButtonProps {
  class?: ClassValue;
  disabled?: boolean;
  /** 点击回调；不传时由 withDefaults 补一个空函数，模板里可以无条件绑定 */
  onClick?: () => void;
  tooltip?: string;
  tooltipDelayDuration?: number;
  tooltipSide?: 'bottom' | 'left' | 'right' | 'top';
  variant?: ButtonVariants;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  /** 未传 onClick 时的空实现，只为让 @click 绑定始终有目标，不产生任何效果 */
  onClick: () => {},
  tooltipDelayDuration: 200,
  tooltipSide: 'bottom',
  variant: 'icon',
});

const slots = useSlots();

/**
 * 是否需要套一层气泡提示：提供了 tooltip 插槽或 tooltip 文案任一即可。
 * 两者都没有时直接渲染裸按钮，避免为空提示付出浮层组件的代价。
 */
const showTooltip = computed(() => !!slots.tooltip || !!props.tooltip);
</script>

<template>
  <VbenButton
    v-if="!showTooltip"
    :class="cn('rounded-full', props.class)"
    :disabled="disabled"
    :variant="variant"
    size="icon"
    @click="onClick"
  >
    <slot></slot>
  </VbenButton>

  <VbenTooltip
    v-else
    :delay-duration="tooltipDelayDuration"
    :side="tooltipSide"
  >
    <template #trigger>
      <VbenButton
        :class="cn('rounded-full', props.class)"
        :disabled="disabled"
        :variant="variant"
        size="icon"
        @click="onClick"
      >
        <slot></slot>
      </VbenButton>
    </template>
    <slot v-if="slots.tooltip" name="tooltip"> </slot>
    <template v-else>
      {{ tooltip }}
    </template>
  </VbenTooltip>
</template>
