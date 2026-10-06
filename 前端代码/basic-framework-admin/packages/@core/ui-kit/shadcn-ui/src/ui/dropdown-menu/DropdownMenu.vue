<script setup lang="ts">
/**
 * 下拉菜单根组件：持有整棵菜单的展开状态与焦点管理。
 * 默认 modal 为 false，展开时不锁定页面滚动与外部交互；
 * 面板、菜单项与分组由本目录内的同级组件渲染。
 */
import type { DropdownMenuRootEmits, DropdownMenuRootProps } from 'reka-ui';

import { DropdownMenuRoot, useForwardPropsEmits } from 'reka-ui';

const props = withDefaults(defineProps<DropdownMenuRootProps>(), {
  modal: false,
});
const emits = defineEmits<DropdownMenuRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <DropdownMenuRoot v-bind="forwarded">
    <slot></slot>
  </DropdownMenuRoot>
</template>
