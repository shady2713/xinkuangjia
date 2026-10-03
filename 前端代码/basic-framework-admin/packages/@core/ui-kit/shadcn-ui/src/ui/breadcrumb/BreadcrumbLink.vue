<script lang="ts" setup>
import type { PrimitiveProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

import { Primitive } from 'reka-ui';

const props = withDefaults(
  defineProps<PrimitiveProps & { class?: ClassValue }>(),
  {
    as: 'a',
  },
);
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="cn('transition-colors hover:text-foreground', props.class)"
  >
    <slot></slot>
  </Primitive>
</template>
