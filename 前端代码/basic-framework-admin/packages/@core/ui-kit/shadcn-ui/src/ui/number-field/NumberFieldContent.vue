<script setup lang="ts">
/** 数字输入框内容容器：为增减按钮预留左右内边距，避免覆盖输入文本。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

const props = defineProps<{
  class?: ClassValue;
}>();
</script>

<template>
  <div
    :class="
      cn(
        'relative [&>[data-slot=input]]:has-[[data-slot=decrement]]:pl-5 [&>[data-slot=input]]:has-[[data-slot=increment]]:pr-5',
        props.class,
      )
    "
  >
    <slot></slot>
  </div>
</template>
