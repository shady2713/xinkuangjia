<script setup lang="ts">
import type { SelectLabelProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

import { SelectLabel } from 'reka-ui';

const props = defineProps<SelectLabelProps & { class?: ClassValue }>();
</script>

<template>
  <SelectLabel :class="cn('px-2 py-1.5 text-sm font-semibold', props.class)">
    <slot></slot>
  </SelectLabel>
</template>
