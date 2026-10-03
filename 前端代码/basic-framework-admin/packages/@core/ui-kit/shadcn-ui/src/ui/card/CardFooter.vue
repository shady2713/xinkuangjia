<script setup lang="ts">
/** 卡片底部操作区：放置次要操作按钮。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

const props = defineProps<{
  class?: ClassValue;
}>();
</script>

<template>
  <div :class="cn('flex items-center p-6 pt-0', props.class)">
    <slot></slot>
  </div>
</template>
