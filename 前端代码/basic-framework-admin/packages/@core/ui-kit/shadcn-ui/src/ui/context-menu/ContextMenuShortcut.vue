<script setup lang="ts">
/** 右键菜单快捷键提示：把菜单项对应的键盘快捷键右对齐显示在同一行。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

const props = defineProps<{
  class?: ClassValue;
}>();
</script>

<template>
  <span
    :class="
      cn('ml-auto text-xs tracking-widest text-muted-foreground', props.class)
    "
  >
    <slot></slot>
  </span>
</template>
