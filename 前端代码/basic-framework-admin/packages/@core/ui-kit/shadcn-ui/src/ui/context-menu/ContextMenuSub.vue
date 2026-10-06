<script setup lang="ts">
/** 二级菜单容器：只维护子菜单开合状态，触发条目与面板需作为其子节点传入。 */
import type { ContextMenuSubEmits, ContextMenuSubProps } from 'reka-ui';

import { ContextMenuSub, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<ContextMenuSubProps>();
const emits = defineEmits<ContextMenuSubEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <ContextMenuSub v-bind="forwarded">
    <slot></slot>
  </ContextMenuSub>
</template>
