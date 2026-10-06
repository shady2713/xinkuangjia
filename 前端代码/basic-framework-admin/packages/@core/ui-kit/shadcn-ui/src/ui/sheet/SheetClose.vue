<script setup lang="ts">
/** 抽屉关闭入口：包裹任意可点击内容，点击后向根节点请求收起，不含图标与样式。 */
import type { DialogCloseProps } from 'reka-ui';

import { DialogClose } from 'reka-ui';

const props = defineProps<DialogCloseProps>();
</script>

<template>
  <DialogClose v-bind="props">
    <slot></slot>
  </DialogClose>
</template>
