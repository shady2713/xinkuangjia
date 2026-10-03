<script lang="ts" setup>
/** 面包屑层级项：承载单个层级的容器，并按需渲染层级间的分隔。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

const props = defineProps<{
  class?: ClassValue;
}>();
</script>

<template>
  <li
    :class="
      cn('inline-flex items-center gap-1.5 hover:text-foreground', props.class)
    "
  >
    <slot></slot>
  </li>
</template>
