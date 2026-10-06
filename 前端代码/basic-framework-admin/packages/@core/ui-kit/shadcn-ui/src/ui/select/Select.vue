<script setup lang="ts">
/**
 * 下拉选择根节点：持有选中值与开合状态，把 reka-ui 根组件的属性与双向绑定事件原样透传。
 * 自身不渲染可见结构，触发件、面板与选项由同目录其他基础件组合，或直接用上层封装选择器。
 */
import type { SelectRootEmits, SelectRootProps } from 'reka-ui';

import { SelectRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<SelectRootProps>();
const emits = defineEmits<SelectRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <SelectRoot v-bind="forwarded">
    <slot></slot>
  </SelectRoot>
</template>
