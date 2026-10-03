<script setup lang="ts">
/** 对话框头部区：组合对话框标题与说明。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

const props = defineProps<{
  class?: ClassValue;
}>();
</script>

<template>
  <div
    :class="cn('flex flex-col gap-y-1.5 text-center sm:text-left', props.class)"
  >
    <slot></slot>
  </div>
</template>
