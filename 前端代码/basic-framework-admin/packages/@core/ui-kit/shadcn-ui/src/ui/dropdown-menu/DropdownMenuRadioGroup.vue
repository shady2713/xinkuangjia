<script setup lang="ts">
/**
 * 单选菜单组：用 modelValue 保存组内唯一选中值，并把变更抛给使用方。
 * 组内需搭配单选菜单项，普通菜单项不参与该值的同步。
 */
import type {
  DropdownMenuRadioGroupEmits,
  DropdownMenuRadioGroupProps,
} from 'reka-ui';

import { DropdownMenuRadioGroup, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<DropdownMenuRadioGroupProps>();
const emits = defineEmits<DropdownMenuRadioGroupEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <DropdownMenuRadioGroup v-bind="forwarded">
    <slot></slot>
  </DropdownMenuRadioGroup>
</template>
