<script lang="ts" setup>
/** 面包屑当前页：标记当前所在层级，不参与跳转。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

const props = defineProps<{
  class?: ClassValue;
}>();
</script>

<template>
  <span
    :class="cn('font-normal text-foreground', props.class)"
    aria-current="page"
    aria-disabled="true"
    role="link"
  >
    <slot></slot>
  </span>
</template>
