<script setup lang="ts">
/** 菜单分组容器：提供 role=group 的分组语义，不参与选中与展开状态。 */
import type { DropdownMenuGroupProps } from 'reka-ui';

import { DropdownMenuGroup } from 'reka-ui';

const props = defineProps<DropdownMenuGroupProps>();
</script>

<template>
  <DropdownMenuGroup v-bind="props">
    <slot></slot>
  </DropdownMenuGroup>
</template>
