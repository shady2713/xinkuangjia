<script lang="ts" setup>
/** 面包屑分隔符：渲染层级之间的视觉分隔。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

import { ChevronRight } from 'lucide-vue-next';

const props = defineProps<{
  class?: ClassValue;
}>();
</script>

<template>
  <li
    :class="cn('[&>svg]:size-3.5', props.class)"
    aria-hidden="true"
    role="presentation"
  >
    <slot>
      <ChevronRight />
    </slot>
  </li>
</template>
