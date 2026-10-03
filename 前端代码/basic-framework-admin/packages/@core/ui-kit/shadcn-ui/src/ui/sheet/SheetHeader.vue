<script setup lang="ts">
/** 抽屉头部区：组合抽屉标题与说明。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

const props = defineProps<{ class?: ClassValue }>();
</script>

<template>
  <div :class="cn('flex flex-col text-center sm:text-left', props.class)">
    <slot></slot>
  </div>
</template>
