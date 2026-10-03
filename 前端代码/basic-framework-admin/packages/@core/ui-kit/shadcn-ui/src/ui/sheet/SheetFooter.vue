<script setup lang="ts">
/** 抽屉底部操作区：放置抽屉的主要操作按钮。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

const props = defineProps<{ class?: ClassValue }>();
</script>

<template>
  <div
    :class="
      cn('flex flex-row flex-col-reverse justify-end gap-x-2', props.class)
    "
  >
    <slot></slot>
  </div>
</template>
