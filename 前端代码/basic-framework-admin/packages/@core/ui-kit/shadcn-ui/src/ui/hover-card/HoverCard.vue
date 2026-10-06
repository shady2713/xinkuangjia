<script setup lang="ts">
/**
 * 悬浮卡片根组件：管理卡片的开合状态、悬停延迟与焦点行为。
 * props 与 emits 转发给 reka-ui，触发元素与内容分别由
 * HoverCardTrigger、HoverCardContent 提供，本组件无视觉输出。
 */
import type { HoverCardRootEmits, HoverCardRootProps } from 'reka-ui';

import { HoverCardRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<HoverCardRootProps>();
const emits = defineEmits<HoverCardRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <HoverCardRoot v-bind="forwarded">
    <slot></slot>
  </HoverCardRoot>
</template>
