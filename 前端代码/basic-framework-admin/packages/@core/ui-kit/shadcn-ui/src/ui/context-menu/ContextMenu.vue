<script setup lang="ts">
/**
 * 右键菜单根组件：透传根节点的开合状态与属性、事件，并关闭 reka-ui 的模态遮罩。
 * modal 默认 false，菜单展开时页面仍可滚动、也可响应外部点击；
 * 触发区、内容面板与各类条目由同级组件组合提供。
 */
import type { ContextMenuRootEmits, ContextMenuRootProps } from 'reka-ui';

import { ContextMenuRoot, useForwardPropsEmits } from 'reka-ui';

const props = withDefaults(defineProps<ContextMenuRootProps>(), {
  modal: false,
});
const emits = defineEmits<ContextMenuRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <ContextMenuRoot v-bind="forwarded">
    <slot></slot>
  </ContextMenuRoot>
</template>
