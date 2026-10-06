<script setup lang="ts">
/** 选项文本：渲染选项文字，须置于 SelectItem 内才参与选中判定。 */
import type { SelectItemTextProps } from 'reka-ui';

import { SelectItemText } from 'reka-ui';

const props = defineProps<SelectItemTextProps>();
</script>

<template>
  <SelectItemText v-bind="props">
    <slot></slot>
  </SelectItemText>
</template>
