<script setup lang="ts">
/** 右键菜单单选组：集中维护组内唯一选中值，具体条目由单选条目组件渲染。 */
import type {
  ContextMenuRadioGroupEmits,
  ContextMenuRadioGroupProps,
} from 'reka-ui';

import { ContextMenuRadioGroup, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<ContextMenuRadioGroupProps>();
const emits = defineEmits<ContextMenuRadioGroupEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <ContextMenuRadioGroup v-bind="forwarded">
    <slot></slot>
  </ContextMenuRadioGroup>
</template>
