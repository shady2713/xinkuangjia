<script setup lang="ts">
/** 右键菜单传送门：把菜单内容挂载到指定容器，避免被父级裁剪，不负责定位。 */
import type { ContextMenuPortalProps } from 'reka-ui';

import { ContextMenuPortal } from 'reka-ui';

const props = defineProps<ContextMenuPortalProps>();
</script>

<template>
  <ContextMenuPortal v-bind="props">
    <slot></slot>
  </ContextMenuPortal>
</template>
