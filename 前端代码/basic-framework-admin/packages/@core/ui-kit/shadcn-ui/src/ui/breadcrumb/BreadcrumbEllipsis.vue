<script lang="ts" setup>
/** 面包屑省略项：层级被折叠时占位，提示还有未展开的层级。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

import { MoreHorizontal } from 'lucide-vue-next';

const props = defineProps<{
  class?: ClassValue;
}>();
</script>

<template>
  <span
    :class="cn('flex h-9 w-9 items-center justify-center', props.class)"
    aria-hidden="true"
    role="presentation"
  >
    <slot>
      <MoreHorizontal class="h-4 w-4" />
    </slot>
    <span class="sr-only">More</span>
  </span>
</template>
