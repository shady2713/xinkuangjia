<script setup lang="ts">
/**
 * 气泡卡片根组件：持有展开状态并下发给触发器与内容面板。
 * 面板定位与外观不在本层，上层 VbenPopover 负责组合三者。
 */
import type { PopoverRootEmits, PopoverRootProps } from 'reka-ui';

import { PopoverRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<PopoverRootProps>();
const emits = defineEmits<PopoverRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <PopoverRoot v-bind="forwarded">
    <slot></slot>
  </PopoverRoot>
</template>
