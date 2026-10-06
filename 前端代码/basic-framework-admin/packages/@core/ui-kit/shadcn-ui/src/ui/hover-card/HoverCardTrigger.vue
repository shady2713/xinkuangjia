<script setup lang="ts">
/**
 * 悬浮卡片触发元素：鼠标悬停或键盘聚焦时打开卡片。
 * 仅把 props 原样透传给 reka-ui，不设置样式与延迟；
 * 卡片本体与定位由 HoverCardContent、HoverCard 负责。
 */
import type { HoverCardTriggerProps } from 'reka-ui';

import { HoverCardTrigger } from 'reka-ui';

const props = defineProps<HoverCardTriggerProps>();
</script>

<template>
  <HoverCardTrigger v-bind="props">
    <slot></slot>
  </HoverCardTrigger>
</template>
