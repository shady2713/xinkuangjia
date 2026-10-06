<script setup lang="ts">
/**
 * 通用提示气泡：把 reka-ui 的 Provider、Trigger、Content 收成触发与内容两个插槽。
 *
 * delayDuration 默认 0、side 默认 right，浮层样式由 contentClass 与 contentStyle 透传；
 * 只做悬停展示，触发元素被置为 tabindex=-1，不接管键盘焦点与点击行为。
 */
import type { TooltipContentProps } from 'reka-ui';

import type { StyleValue } from 'vue';

import type { ClassType } from '@vben-core/typings';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../ui';

/**
 * 提示气泡的入参。
 * delayDuration 作用于整组 Provider，决定悬停后多久才弹出；side 决定浮层相对触发元素的方向。
 * contentClass 与 contentStyle 只作用于浮层内容，不影响触发区；
 * 提示文案本身走默认插槽，不在属性里声明。
 */
interface Props {
  contentClass?: ClassType;
  contentStyle?: StyleValue;
  delayDuration?: number;
  side?: TooltipContentProps['side'];
}

withDefaults(defineProps<Props>(), {
  delayDuration: 0,
  side: 'right',
});
</script>

<template>
  <TooltipProvider :delay-duration="delayDuration">
    <Tooltip>
      <TooltipTrigger as-child tabindex="-1">
        <slot name="trigger"></slot>
      </TooltipTrigger>
      <TooltipContent
        :class="contentClass"
        :side="side"
        :style="contentStyle"
        class="side-content rounded-md bg-accent text-popover-foreground"
      >
        <slot></slot>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
