<script lang="ts" setup>
/** 面包屑列表：按顺序排列各个层级项的有序列表容器。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

const props = defineProps<{
  class?: ClassValue;
}>();
</script>

<template>
  <ol
    :class="
      cn(
        'flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5',
        props.class,
      )
    "
  >
    <slot></slot>
  </ol>
</template>
