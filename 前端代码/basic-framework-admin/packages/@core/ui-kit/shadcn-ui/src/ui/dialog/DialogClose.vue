<script setup lang="ts">
/** 对话框关闭入口：点击即关闭所在对话框，不承担确认、提交与禁用判断。 */
import type { DialogCloseProps } from 'reka-ui';

import { DialogClose } from 'reka-ui';

const props = defineProps<DialogCloseProps>();
</script>

<template>
  <DialogClose v-bind="props">
    <slot></slot>
  </DialogClose>
</template>
