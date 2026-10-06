<script setup lang="ts">
/** 气泡卡片触发器：只负责触发根组件切换显隐，不定义外观与内容。 */
import type { PopoverTriggerProps } from 'reka-ui';

import { PopoverTrigger } from 'reka-ui';

const props = defineProps<PopoverTriggerProps>();
</script>

<template>
  <PopoverTrigger v-bind="props">
    <slot></slot>
  </PopoverTrigger>
</template>
