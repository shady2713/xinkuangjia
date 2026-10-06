<script setup lang="ts">
/**
 * 选择值显示位：放进触发件内展示当前选中项文本，没有选中值时回退到 placeholder。
 * 只做属性与插槽透传，值的格式化与占位文案由调用方给出。
 */
import type { SelectValueProps } from 'reka-ui';

import { SelectValue } from 'reka-ui';

const props = defineProps<SelectValueProps>();
</script>

<template>
  <SelectValue v-bind="props">
    <slot></slot>
  </SelectValue>
</template>
