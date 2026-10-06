<script setup lang="ts">
/** 抽屉打开入口：包裹触发内容，点击后请求展开；接入 useVbenDrawer 的受控抽屉不走它。 */
import type { DialogTriggerProps } from 'reka-ui';

import { DialogTrigger } from 'reka-ui';

const props = defineProps<DialogTriggerProps>();
</script>

<template>
  <DialogTrigger v-bind="props">
    <slot></slot>
  </DialogTrigger>
</template>
