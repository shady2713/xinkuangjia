<script setup lang="ts">
/**
 * 对话框根节点：向 reka-ui 透传 open 状态与开关事件。
 * 自身不渲染视觉元素，遮罩与面板分别由 DialogOverlay 和
 * DialogContent 承担；触发与关闭入口是另外两个组件。
 */
import type { DialogRootEmits, DialogRootProps } from 'reka-ui';

import { DialogRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<DialogRootProps>();
const emits = defineEmits<DialogRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <DialogRoot v-bind="forwarded">
    <slot></slot>
  </DialogRoot>
</template>
