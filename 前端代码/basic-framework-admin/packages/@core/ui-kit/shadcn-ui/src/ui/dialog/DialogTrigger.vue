<script setup lang="ts">
/**
 * 对话框触发按钮：原样透传属性与插槽，点击后由根节点请求打开弹窗。
 * 自身不追加样式，开合状态由 DialogRoot 统一持有。
 */
import type { DialogTriggerProps } from 'reka-ui';

import { DialogTrigger } from 'reka-ui';

const props = defineProps<DialogTriggerProps>();
</script>

<template>
  <DialogTrigger v-bind="props">
    <slot></slot>
  </DialogTrigger>
</template>
