<script setup lang="ts">
/** 卡片标题区：展示卡片主标题。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

const props = defineProps<{
  class?: ClassValue;
}>();
</script>

<template>
  <h3 :class="cn('font-semibold leading-none tracking-tight', props.class)">
    <slot></slot>
  </h3>
</template>
