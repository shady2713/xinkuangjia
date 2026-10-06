<script setup lang="ts">
/**
 * 页签根节点：维护当前选中值，把双向绑定与切换事件透传给 reka-ui 的 TabsRoot。
 * 本身不渲染可见结构，列表、触发件与面板由引用方按需组合。
 */
import type { TabsRootEmits, TabsRootProps } from 'reka-ui';

import { TabsRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<TabsRootProps>();
const emits = defineEmits<TabsRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <TabsRoot v-bind="forwarded">
    <slot></slot>
  </TabsRoot>
</template>
