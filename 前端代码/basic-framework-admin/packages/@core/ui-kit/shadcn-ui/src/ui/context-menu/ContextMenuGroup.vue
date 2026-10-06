<script setup lang="ts">
/** 右键菜单分组容器：只透传分组语义与属性，标题和分隔线由同级组件提供。 */
import type { ContextMenuGroupProps } from 'reka-ui';

import { ContextMenuGroup } from 'reka-ui';

const props = defineProps<ContextMenuGroupProps>();
</script>

<template>
  <ContextMenuGroup v-bind="props">
    <slot></slot>
  </ContextMenuGroup>
</template>
