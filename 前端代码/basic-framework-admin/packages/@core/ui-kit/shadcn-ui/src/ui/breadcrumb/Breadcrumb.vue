<script lang="ts" setup>
/** 面包屑导航根节点：提供导航语义容器，本身不渲染层级。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

const props = defineProps<{
  class?: ClassValue;
}>();
</script>

<template>
  <nav :class="cn(props.class)" aria-label="breadcrumb" role="navigation">
    <slot></slot>
  </nav>
</template>
