<script setup lang="ts">
/**
 * 警告对话框根节点：透传 reka-ui 的开关状态与事件，本身不渲染结构。
 * 作为组合入口提供上下文，遮罩、内容与按钮需由使用方按序拼装。
 */
import type { AlertDialogEmits, AlertDialogProps } from 'reka-ui';

import { AlertDialogRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<AlertDialogProps>();
const emits = defineEmits<AlertDialogEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <AlertDialogRoot v-bind="forwarded">
    <slot></slot>
  </AlertDialogRoot>
</template>
