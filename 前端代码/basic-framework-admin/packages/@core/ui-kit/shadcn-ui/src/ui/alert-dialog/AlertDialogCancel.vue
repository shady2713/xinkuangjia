<script setup lang="ts">
/**
 * 警告对话框取消按钮：透传 reka-ui 的 Cancel props，点击后直接关闭对话框。
 *
 * 与确认按钮只差语义和是否触发确认，文案与样式同样由使用方提供。
 */
import type { AlertDialogCancelProps } from 'reka-ui';

import { AlertDialogCancel } from 'reka-ui';

const props = defineProps<AlertDialogCancelProps>();
</script>

<template>
  <AlertDialogCancel v-bind="props">
    <slot></slot>
  </AlertDialogCancel>
</template>
