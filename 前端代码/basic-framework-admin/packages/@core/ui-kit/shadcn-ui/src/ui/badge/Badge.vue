<script setup lang="ts">
/** 徽章：渲染带变体样式的短标签，用于状态或分类标记。 */
import type { ClassValue } from '@vben-core/shared/utils';

import type { BadgeVariants } from './badge';

import { cn } from '@vben-core/shared/utils';

import { badgeVariants } from './badge';

const props = defineProps<{
  class?: ClassValue;
  variant?: BadgeVariants['variant'];
}>();
</script>

<template>
  <div :class="cn(badgeVariants({ variant }), props.class)">
    <slot></slot>
  </div>
</template>
