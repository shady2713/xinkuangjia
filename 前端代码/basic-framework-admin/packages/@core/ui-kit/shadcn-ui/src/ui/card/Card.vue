<script setup lang="ts">
/** 卡片容器：统一卡片的圆角、边框与背景外观。 */
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
        'rounded-xl border border-border bg-card text-card-foreground',
        props.class,
      )
    "
  >
    <slot></slot>
  </div>
</template>
