<script setup lang="ts">
import type { DialogTitleProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { DialogTitle } from 'reka-ui';

const props = defineProps<DialogTitleProps & { class?: ClassValue }>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <DialogTitle
    :class="cn('font-medium text-foreground', props.class)"
    v-bind="delegatedProps"
  >
    <slot></slot>
  </DialogTitle>
</template>
