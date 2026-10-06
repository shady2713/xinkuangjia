<script setup lang="ts">
/**
 * 抽屉根节点：reka-ui 对话框根的开合属性与事件在此透传，是 v-model:open 与关闭请求的落点。
 * 只管辖开合状态，动画面板与遮罩在 SheetContent，页头页脚与标题另有专件。
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
