<script setup lang="ts">
/** 卡片头部区：组合卡片标题与描述。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

const props = defineProps<{
  class?: ClassValue;
}>();
</script>

<template>
  <div :class="cn('flex flex-col gap-y-1.5 p-5', props.class)">
    <slot></slot>
  </div>
</template>
