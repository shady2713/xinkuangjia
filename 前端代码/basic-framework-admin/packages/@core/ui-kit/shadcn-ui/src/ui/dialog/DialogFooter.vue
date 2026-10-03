<script setup lang="ts">
/** 对话框底部操作区：放置确认与取消等操作按钮。 */
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
