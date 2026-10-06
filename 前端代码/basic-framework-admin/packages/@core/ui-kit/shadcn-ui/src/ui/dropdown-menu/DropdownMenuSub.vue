<script setup lang="ts">
/**
 * 下拉菜单子菜单根节点：为「父项 + 子面板」的二级结构提供展开状态。
 * props 与 emits 原样转发给 reka-ui，触发项与面板分别由
 * DropdownMenuSubTrigger、DropdownMenuSubContent 负责，本文件不含样式。
 */
import type { DropdownMenuSubEmits, DropdownMenuSubProps } from 'reka-ui';

import { DropdownMenuSub, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<DropdownMenuSubProps>();
const emits = defineEmits<DropdownMenuSubEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <DropdownMenuSub v-bind="forwarded">
    <slot></slot>
  </DropdownMenuSub>
</template>
