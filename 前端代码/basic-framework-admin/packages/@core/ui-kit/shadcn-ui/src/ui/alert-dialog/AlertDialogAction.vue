<script setup lang="ts">
/**
 * 警告对话框确认按钮：透传 reka-ui 的 Action props，点击后关闭对话框。
 *
 * 只承担确认语义与关闭行为，按钮文案、危险色样式和确认后的业务动作
 * 都由使用方自己决定。
 */
import type { AlertDialogActionProps } from 'reka-ui';

import { AlertDialogAction } from 'reka-ui';

const props = defineProps<AlertDialogActionProps>();
</script>

<template>
  <AlertDialogAction v-bind="props">
    <slot></slot>
  </AlertDialogAction>
</template>
