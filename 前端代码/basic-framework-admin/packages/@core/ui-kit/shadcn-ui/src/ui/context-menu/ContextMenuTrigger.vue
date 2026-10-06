<script setup lang="ts">
/** 右键菜单触发区：包住任意目标元素并在其上监听右键，不渲染菜单本体。 */
import type { ContextMenuTriggerProps } from 'reka-ui';

import { ContextMenuTrigger, useForwardProps } from 'reka-ui';

const props = defineProps<ContextMenuTriggerProps>();

const forwardedProps = useForwardProps(props);
</script>

<template>
  <ContextMenuTrigger v-bind="forwardedProps">
    <slot></slot>
  </ContextMenuTrigger>
</template>
